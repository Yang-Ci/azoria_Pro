import type { ApiProviderConfig, ApiProviderInput, ApiProviderState, ApiUsageSnapshot } from "../shared/usage"
import { UsageProviderStore, validateProvider } from "./usage-provider-store"

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject => typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : {}

function number(value: unknown, field: string): number {
  if ((typeof value !== "number" && typeof value !== "string") || typeof value === "string" && !value.trim() || !Number.isFinite(Number(value))) throw new Error(`响应字段 ${field} 缺失或不是有效数字`)
  return Number(value)
}

export function jsonPointer(value: unknown, pointer: string): unknown {
  return pointer.split("/").slice(1).reduce<unknown>((current, key) => {
    if (typeof current !== "object" || current === null) return undefined
    const decoded = key.replace(/~1/g, "/").replace(/~0/g, "~")
    return Object.hasOwn(current, decoded) ? (current as JsonObject)[decoded] : undefined
  }, value)
}

function emptySnapshot(unit: string): ApiUsageSnapshot {
  return {
    sampledAt: new Date().toISOString(), unit, remaining: 0, used: null, total: null,
    granted: null, toppedUp: null, recentUsage: null, requestCount: null,
    breakdown: [], history: [], detailError: null,
  }
}

export function parseDeepSeekBalance(value: unknown): ApiUsageSnapshot {
  const data = object(value)
  if (!Array.isArray(data.balance_infos) || !data.balance_infos.length) throw new Error("响应缺少 balance_infos 余额字段")
  const balance = object(data.balance_infos.find((item) => object(item).currency === "CNY") ?? data.balance_infos[0])
  return {
    ...emptySnapshot(typeof balance.currency === "string" ? balance.currency : "CNY"),
    remaining: number(balance.total_balance, "total_balance"),
    granted: number(balance.granted_balance, "granted_balance"),
    toppedUp: number(balance.topped_up_balance, "topped_up_balance"),
  }
}

export function parseCustomUsage(value: unknown, config: ApiProviderConfig): ApiUsageSnapshot {
  const used = number(jsonPointer(value, config.usedPath), config.usedPath)
  const total = number(jsonPointer(value, config.totalPath), config.totalPath)
  if (used < 0 || total < 0) throw new Error("已用量和总额度应为非负数")
  const breakdownValue = config.breakdownPath ? jsonPointer(value, config.breakdownPath) : undefined
  if (config.breakdownPath && !Array.isArray(breakdownValue)) throw new Error("明细字段未匹配到数组")
  const breakdown = Array.isArray(breakdownValue) ? breakdownValue.slice(0, 100).map((item) => {
    const row = object(item)
    const tokens = number(row.tokens, "明细 tokens")
    if (typeof row.label !== "string" || tokens < 0) throw new Error("明细数组需要 label 文本和非负 tokens 字段")
    return { label: row.label.slice(0, 100), tokens }
  }) : []
  return { ...emptySnapshot(config.unit), used, total, remaining: Math.max(0, total - used), breakdown }
}

function successfulData(value: unknown): JsonObject {
  const result = object(value)
  // Do not echo arbitrary server text: an error response may contain credentials.
  if (result.success === false) throw new Error("服务拒绝查询，请检查凭据、用户 ID 和接口权限。")
  return result.data === undefined ? result : object(result.data)
}

function newApiConversion(status: unknown): { unit: string; multiplier: number } {
  const settings = successfulData(status)
  const perUnit = typeof settings.quota_per_unit === "number" && settings.quota_per_unit > 0 ? settings.quota_per_unit : null
  const display = settings.quota_display_type
  let unit = "额度"
  let multiplier = 1
  // A missing site conversion must stay in raw quota units, not become an invented balance.
  if (display === "TOKENS") unit = "tokens"
  else if (perUnit && (display === "USD" || (display === undefined && settings.display_in_currency === true))) {
    unit = "USD"; multiplier = 1 / perUnit
  } else if (perUnit && display === "CNY" && typeof settings.usd_exchange_rate === "number" && settings.usd_exchange_rate > 0) {
    unit = "CNY"; multiplier = settings.usd_exchange_rate / perUnit
  } else if (perUnit && display === "CUSTOM" && typeof settings.custom_currency_exchange_rate === "number" && settings.custom_currency_exchange_rate > 0) {
    unit = typeof settings.custom_currency_symbol === "string" ? settings.custom_currency_symbol.slice(0, 24) : "自定义单位"
    multiplier = settings.custom_currency_exchange_rate / perUnit
  }
  return { unit, multiplier }
}

export function parseNewApiBalance(account: unknown, status: unknown): ApiUsageSnapshot {
  const data = successfulData(account)
  const { unit, multiplier } = newApiConversion(status)
  const remaining = number(data.quota, "data.quota") * multiplier
  const used = data.used_quota === undefined ? null : number(data.used_quota, "data.used_quota") * multiplier
  return {
    ...emptySnapshot(unit), remaining, used, total: used === null ? null : remaining + used,
    requestCount: data.request_count === undefined ? null : number(data.request_count, "data.request_count"),
  }
}

export function withNewApiHistory(snapshot: ApiUsageSnapshot, value: unknown, status: unknown, start: number, end: number): ApiUsageSnapshot {
  const result = object(value)
  if (result.success === false || !Array.isArray(result.data)) throw new Error("近 24 小时用量接口不可用，请检查账户 PAT 权限。")
  const { multiplier } = newApiConversion(status)
  const buckets = new Map<number, { usage: number; requests: number }>()
  for (const row of result.data) {
    const item = object(row)
    const timestamp = number(item.created_at, "created_at")
    if (timestamp < start || timestamp > end) continue
    const bucket = buckets.get(timestamp) ?? { usage: 0, requests: 0 }
    bucket.usage += number(item.quota, "quota") * multiplier
    bucket.requests += number(item.count, "count")
    buckets.set(timestamp, bucket)
  }
  const history = [...buckets].sort(([left], [right]) => left - right).map(([timestamp, bucket]) => ({ timestamp, ...bucket }))
  return { ...snapshot, history, recentUsage: history.reduce((sum, point) => sum + point.usage, 0) }
}

async function requestJson(url: string, credential: string | undefined, config: ApiProviderConfig, signal: AbortSignal, custom = false): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" }
  if (credential) headers.Authorization = custom ? credential : /^Bearer\s/i.test(credential) ? credential : `Bearer ${credential}`
  if (config.kind === "new-api" && config.accountUserId) headers["New-Api-User"] = config.accountUserId
  const method = custom ? config.method : "GET"
  if (method === "POST") headers["Content-Type"] = "application/json"
  let response: Response
  try {
    response = await fetch(url, { method, headers, body: method === "POST" && config.body ? config.body : undefined, redirect: "error", signal })
  } catch {
    if (signal.aborted) throw new Error("查询超时，请稍后重试。")
    throw new Error("无法连接服务，请检查接口地址、网络或重定向配置。")
  }
  if (!response.ok) {
    await response.body?.cancel()
    if (response.status === 401 || response.status === 403) throw new Error(config.kind === "new-api"
      ? "凭据失效或权限不足，请检查账户 PAT；旧版 New API 还需数字用户 ID。" : "凭据失效或权限不足，请检查 API Key / Authorization。")
    if (response.status === 429) throw new Error("请求过于频繁，请稍后重试或增加刷新间隔。")
    throw new Error(`查询失败（HTTP ${response.status}）`)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("接口返回了空响应")
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("接口响应超过 2 MB，请使用精简的查询接口。") }
      chunks.push(value)
    }
  } catch (error) {
    if (signal.aborted) throw new Error("查询超时，请稍后重试。")
    throw error
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) }
  catch { throw new Error("接口未返回有效 JSON，请检查查询地址。") }
}

export class ApiUsageService {
  private pending = new Map<string, Promise<ApiProviderState>>()
  constructor(private readonly store: UsageProviderStore) {}

  private async fetchSnapshot(config: ApiProviderConfig, credential: string | undefined): Promise<ApiUsageSnapshot> {
    if (config.kind !== "custom" && !credential) throw new Error(config.kind === "new-api" ? "请配置账户访问令牌 PAT" : "请配置 API Key")
    const signal = AbortSignal.timeout(15_000)
    if (config.kind === "deepseek") return parseDeepSeekBalance(await requestJson("https://api.deepseek.com/user/balance", credential, config, signal))
    if (config.kind === "custom") return parseCustomUsage(await requestJson(config.baseUrl, credential, config, signal, true), config)
    const base = config.baseUrl
    const [account, status] = await Promise.all([
      requestJson(`${base}/api/user/self`, credential, config, signal),
      requestJson(`${base}/api/status`, undefined, config, signal).catch(() => null),
    ])
    const snapshot = parseNewApiBalance(account, status)
    const end = Math.floor(Date.now() / 1000)
    const start = end - 86_400
    try {
      const history = await requestJson(`${base}/api/data/self?start_timestamp=${start}&end_timestamp=${end}&default_time=hour`, credential, config, signal)
      return withNewApiHistory(snapshot, history, status, start, end)
    } catch (error) {
      return { ...snapshot, detailError: error instanceof Error ? error.message : "近 24 小时用量不可用" }
    }
  }

  async test(input: ApiProviderInput): Promise<ApiUsageSnapshot> {
    const config = validateProvider(input?.config)
    if (input.credential !== undefined && (typeof input.credential !== "string" || input.credential.length > 8192 || /[\r\n]/.test(input.credential))) throw new Error("凭据格式无效")
    const stored = config.id ? await this.store.get(config.id) : null
    const credential = input.credential !== undefined ? input.credential.trim()
      : stored?.config.kind === config.kind ? await this.store.credential(config.id) : undefined
    return this.fetchSnapshot(config, credential)
  }

  refresh(id: string): Promise<ApiProviderState> {
    const existing = this.pending.get(id)
    if (existing) return existing
    const task = (async () => {
      const current = await this.store.get(id)
      if (!current.config.enabled) return current
      try {
        const snapshot = await this.fetchSnapshot(current.config, await this.store.credential(id))
        return await this.store.updateSnapshot(current.config, current.revision, snapshot, null)
      } catch (error) {
        return this.store.updateSnapshot(current.config, current.revision, null, error instanceof Error ? error.message : "API 查询失败")
      }
    })().finally(() => { this.pending.delete(id) })
    this.pending.set(id, task)
    return task
  }
}
