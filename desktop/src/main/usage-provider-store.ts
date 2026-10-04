import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ApiProviderConfig, ApiProviderInput, ApiProviderState, ApiUsageSnapshot } from "../shared/usage"

export interface CredentialCipher {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

interface StoredProvider extends ApiProviderState { encryptedCredential: string | null }

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateProvider(config: ApiProviderConfig): ApiProviderConfig {
  if (!config || typeof config !== "object" || !["deepseek", "new-api", "custom"].includes(config.kind)) throw new Error("API 服务类型无效")
  const text = (value: unknown, label: string, max = 512): string => {
    if (typeof value !== "string" || value.length > max) throw new Error(`${label}无效`)
    return value.trim()
  }
  const id = text(config.id, "服务 ID")
  if (id && !ID_PATTERN.test(id)) throw new Error("服务 ID 无效")
  const name = text(config.name, "服务名称", 80)
  if (!name) throw new Error("请填写服务名称")
  let baseUrl = config.kind === "deepseek" ? "https://api.deepseek.com" : text(config.baseUrl, "接口地址", 2048)
  try {
    const url = new URL(baseUrl)
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error("invalid URL")
    if (config.kind === "new-api" && url.search) throw new Error("invalid base URL")
    baseUrl = config.kind === "custom" ? url.toString() : url.toString().replace(/\/+$/, "")
  } catch { throw new Error("请填写有效的 HTTP(S) 接口地址（不含用户名、密码或片段）") }
  const accountUserId = text(config.accountUserId, "用户 ID", 32)
  if (accountUserId && !/^\d+$/.test(accountUserId)) throw new Error("New API 用户 ID 应为数字")
  if (!Number.isInteger(config.refreshMinutes) || config.refreshMinutes < 1 || config.refreshMinutes > 1440) throw new Error("刷新间隔应为 1–1440 分钟")
  if (typeof config.enabled !== "boolean") throw new Error("启用状态无效")
  if (config.method !== "GET" && config.method !== "POST") throw new Error("仅支持 GET / POST 查询")
  const body = text(config.body, "请求体", 65_536)
  if (config.kind === "custom" && config.method === "POST" && body) {
    try { JSON.parse(body) } catch { throw new Error("POST 请求体应为有效 JSON") }
  }
  const pointer = (value: unknown, label: string, required: boolean): string => {
    const result = text(value, label)
    if (!result && !required) return ""
    if (!result.startsWith("/") || /~(?![01])/u.test(result)) throw new Error(`${label}应为 JSON Pointer，例如 /data/used`)
    return result
  }
  return {
    id, kind: config.kind, name, enabled: config.enabled, baseUrl, accountUserId,
    refreshMinutes: config.refreshMinutes, method: config.method, body,
    usedPath: config.kind === "custom" ? pointer(config.usedPath, "已用量字段", true) : "/used",
    totalPath: config.kind === "custom" ? pointer(config.totalPath, "总额度字段", true) : "/total",
    breakdownPath: config.kind === "custom" ? pointer(config.breakdownPath, "明细字段", false) : "",
    unit: text(config.unit, "单位", 24) || "tokens", hasCredential: false,
  }
}

function publicState(provider: StoredProvider): ApiProviderState {
  return structuredClone({
    revision: provider.revision,
    config: { ...provider.config, hasCredential: !!provider.encryptedCredential },
    snapshot: provider.snapshot, error: provider.error, checkedAt: provider.checkedAt,
  })
}

export class UsageProviderStore {
  private data: StoredProvider[] = []
  private loaded: Promise<void> | null = null
  private mutations: Promise<unknown> = Promise.resolve()
  private readonly file: string

  constructor(private readonly userData: string, private readonly cipher: CredentialCipher) {
    this.file = path.join(userData, "api-usage-providers.json")
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"))
        if (!Array.isArray(parsed) || parsed.length > 20) throw new Error("invalid config")
        this.data = parsed.map((provider: StoredProvider) => {
          const config = validateProvider(provider.config)
          if (!config.id || (provider.encryptedCredential !== null && typeof provider.encryptedCredential !== "string")) throw new Error("invalid config")
          return { ...provider, revision: Number.isInteger(provider.revision) ? provider.revision : 1, config }
        })
        if (new Set(this.data.map((provider) => provider.config.id)).size !== this.data.length) throw new Error("duplicate IDs")
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("API 配置文件无法读取，请检查应用数据目录。")
      }
    })()
    return this.loaded
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.mutations.then(operation, operation)
    this.mutations = task.catch(() => undefined)
    return task
  }

  private async commit(next: StoredProvider[]): Promise<void> {
    await mkdir(this.userData, { recursive: true })
    await writeFile(`${this.file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 })
    await rename(`${this.file}.tmp`, this.file)
    this.data = next
  }

  async list(): Promise<ApiProviderState[]> {
    await this.load()
    await this.mutations
    return this.data.map(publicState)
  }

  async get(id: string): Promise<ApiProviderState> {
    const provider = (await this.list()).find((provider) => provider.config.id === id)
    if (!provider) throw new Error("API 服务不存在或已删除")
    return provider
  }

  async credential(id: string): Promise<string | undefined> {
    await this.load()
    await this.mutations
    const provider = this.data.find((provider) => provider.config.id === id)
    if (!provider?.encryptedCredential) return undefined
    if (!this.cipher.available()) throw new Error("系统安全存储不可用，无法读取已保存凭据。")
    try { return this.cipher.decrypt(Buffer.from(provider.encryptedCredential, "base64")) }
    catch { throw new Error("已保存凭据无法解密，请重新填写并保存。") }
  }

  save(input: ApiProviderInput): Promise<ApiProviderState> {
    return this.mutate(async () => {
      await this.load()
      const config = validateProvider(input?.config)
      const current = this.data.find((provider) => provider.config.id === config.id)
      if (config.id && !current) throw new Error("API 服务不存在或已删除")
      if (!current && this.data.length >= 20) throw new Error("最多配置 20 个 API 服务")
      config.id ||= randomUUID()
      let encryptedCredential = current?.encryptedCredential ?? null
      if (current && current.config.kind !== config.kind) encryptedCredential = null
      if (input.credential !== undefined) {
        if (typeof input.credential !== "string" || input.credential.length > 8192 || /[\r\n]/.test(input.credential)) throw new Error("凭据格式无效")
        const credential = input.credential.trim()
        if (credential) {
          if (!this.cipher.available()) throw new Error("系统安全存储不可用，无法安全保存凭据。")
          encryptedCredential = this.cipher.encrypt(credential).toString("base64")
        } else encryptedCredential = null
      }
      const unchanged = current && JSON.stringify(config) === JSON.stringify(current.config)
      const next: StoredProvider = {
        revision: (current?.revision ?? 0) + 1,
        config, encryptedCredential, snapshot: unchanged ? current.snapshot : null,
        error: null, checkedAt: unchanged ? current.checkedAt : null,
      }
      await this.commit([...this.data.filter((provider) => provider.config.id !== config.id), next])
      return publicState(next)
    })
  }

  delete(id: string): Promise<void> {
    return this.mutate(async () => {
      await this.load()
      if (typeof id !== "string" || !ID_PATTERN.test(id)) throw new Error("服务 ID 无效")
      await this.commit(this.data.filter((provider) => provider.config.id !== id))
    })
  }

  updateSnapshot(config: ApiProviderConfig, revision: number, snapshot: ApiUsageSnapshot | null, error: string | null): Promise<ApiProviderState> {
    return this.mutate(async () => {
      await this.load()
      const current = this.data.find((provider) => provider.config.id === config.id)
      if (!current) throw new Error("API 服务不存在或已删除")
      if (current.revision !== revision || JSON.stringify(publicState(current).config) !== JSON.stringify(config)) return publicState(current)
      const next: StoredProvider = { ...current, snapshot: snapshot ?? current.snapshot, error, checkedAt: new Date().toISOString() }
      await this.commit(this.data.map((provider) => provider === current ? next : provider))
      return publicState(next)
    })
  }
}
