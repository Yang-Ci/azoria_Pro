import assert from "node:assert/strict"
import { test } from "node:test"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { CodexQuotaService, mergeQuotaHistory, parseQuotaEvent } from "../src/main/codex-quota"
import { ApiUsageService, jsonPointer, parseCustomUsage, parseDeepSeekBalance, parseNewApiBalance, withNewApiHistory } from "../src/main/api-usage"
import { UsageProviderStore, validateProvider, type CredentialCipher } from "../src/main/usage-provider-store"
import { currentQuotaCycle, estimateMonthlyQuota } from "../src/shared/quota-history"
import type { ApiProviderConfig, QuotaHistoryPoint } from "../src/shared/usage"
import { compactTouchAmount, makeTouchUsage, touchUsageBlePage } from "../src/shared/touch-usage"
import { TouchUsageService } from "../src/main/touch-usage"

test("Touch compact balance retains full amounts and handles negative and missing values", () => {
  assert.deepEqual(compactTouchAmount(13024.49), { amount: "1.30", scale: "万" })
  assert.deepEqual(compactTouchAmount(160.8), { amount: "160.80", scale: "" })
  assert.deepEqual(compactTouchAmount(-13024.49), { amount: "-1.30", scale: "万" })
  assert.deepEqual(compactTouchAmount(120000000), { amount: "1.20", scale: "亿" })
  assert.deepEqual(compactTouchAmount(null), { amount: "--", scale: "" })
})

test("Touch snapshots select accounts without disclosing URLs, IDs, credentials or server errors", () => {
  const provider = { revision: 1, config: fixtureConfig({ id: "private-id", name: '中转|站"\\\n😀'.repeat(20), baseUrl: "https://private.test", accountUserId: "57" }),
    snapshot: parseCustomUsage({ data: { used: 4, total: 13028.49 } }, fixtureConfig()), error: "private server detail", checkedAt: timestamp }
  const view = makeTouchUsage(null, [provider], 99, NOW)
  assert.equal(view.usageProviderIndex, 0)
  assert.equal(view.usageApiRemaining, "13024.49")
  assert.equal(view.usageApiCompact, "1.30")
  assert.equal(view.usageApiError, true)
  assert(new TextEncoder().encode(view.usageApiName).length <= 48)
  assert(!/["|\\\n]/.test(view.usageApiName))
  assert(!JSON.stringify(view).includes("private"))
  assert.equal(makeTouchUsage(null, [], 0).usageApiAvailable, false)
})

test("Authenticated Touch BLE pages fit the MTU even with long Unicode labels and large amounts", () => {
  const provider = { revision: 1, config: fixtureConfig({ name: "额度查询中转站".repeat(12), unit: "自定义额度" }),
    snapshot: { ...parseCustomUsage({ data: { used: 1e300, total: 1.1e300 } }, fixtureConfig()), requestCount: 1e300 }, error: null, checkedAt: timestamp }
  const quota = { snapshots: parseQuotaEvent(quotaLine(), NOW), history: [], codexHome: "private", checkedAt: timestamp, warnings: [] }
  const view = makeTouchUsage(quota, [provider], 0, NOW)
  for (let page = 0; page < 3; page++) {
    const payload = touchUsageBlePage(view, page)
    const reply = `R|${"a".repeat(16)}|4294967295|${payload}|${"f".repeat(32)}`
    assert(Buffer.byteLength(reply) <= 253, `${page}: ${Buffer.byteLength(reply)} bytes`)
    assert.equal(payload.split("|").length, page === 2 ? 6 : 13)
  }
})

test("Touch preserves observed quota after reset and marks old records instead of inventing 100%", () => {
  const quota = { snapshots: parseQuotaEvent(quotaLine(35, NOW / 1000 - 100), NOW), history: [], codexHome: "private", checkedAt: timestamp, warnings: [] }
  const view = makeTouchUsage(quota, [], 0, NOW + 7 * 3600000)
  assert.equal(view.usagePrimaryRemaining, 650)
  assert.equal(view.usageCodexStale, true)
  assert.equal(view.usageSecondaryRemaining, 780)
})

test("Touch background scheduler refreshes due accounts without requiring the desktop tab", async () => {
  let refreshes = 0
  const providers = [
    { revision: 1, config: fixtureConfig({ id: "due", enabled: true }), checkedAt: null, snapshot: null, error: null },
    { revision: 1, config: fixtureConfig({ id: "paused", enabled: false }), checkedAt: null, snapshot: null, error: null },
    { revision: 1, config: fixtureConfig({ id: "fresh", enabled: true }), checkedAt: new Date().toISOString(), snapshot: null, error: null },
  ]
  const service = new TouchUsageService(
    { collect: async () => ({ snapshots: [], history: [], codexHome: "private", checkedAt: timestamp, warnings: [] }) } as unknown as CodexQuotaService,
    { list: async () => providers } as unknown as UsageProviderStore,
    { refresh: async (id: string) => { assert.equal(id, "due"); refreshes++ } } as unknown as ApiUsageService,
  )
  service.start()
  try {
    await new Promise(resolve => setTimeout(resolve, 15))
    assert.equal(refreshes, 1)
    assert.equal((await service.snapshot()).usageProviderCount, 3)
  } finally { service.stop() }
})

const NOW = Date.parse("2026-10-03T08:00:00Z")
const timestamp = new Date(NOW).toISOString()
const fixtureConfig = (changes: Partial<ApiProviderConfig> = {}): ApiProviderConfig => ({
  id: "", kind: "custom", name: "测试查询", enabled: true, baseUrl: "http://127.0.0.1/usage", accountUserId: "",
  refreshMinutes: 5, method: "GET", body: "", usedPath: "/data/used", totalPath: "/data/total",
  breakdownPath: "", unit: "tokens", hasCredential: false, ...changes,
})
const quotaLine = (used = 35, reset = NOW / 1000 + 3600, sampledAt = timestamp) => JSON.stringify({
  timestamp: sampledAt, type: "event_msg", payload: { type: "token_count", rate_limits: {
    limit_id: "codex", plan_type: "plus", primary: { used_percent: used, window_minutes: 300, resets_at: reset },
    secondary: { used_percent: 22, window_minutes: 10080, resets_at: NOW / 1000 + 86_400 },
  } },
})
const point = (usedPercent: number, sampledAt: number, resetsAt: number): QuotaHistoryPoint => ({
  limitId: "codex", window: "secondary", usedPercent, sampledAt, resetsAt, windowMinutes: 10080,
})

function testCipher(): CredentialCipher {
  const key = randomBytes(32)
  return {
    available: () => true,
    encrypt(value) {
      const iv = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", key, iv)
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    },
    decrypt(value) {
      const cipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString("utf8")
    },
  }
}

async function temporary<T>(run: (folder: string) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(path.join(tmpdir(), "yangci-usage-test-"))
  try { return await run(folder) } finally { await rm(folder, { recursive: true, force: true }) }
}

async function mockServer<T>(handler: (request: IncomingMessage, response: ServerResponse) => void, run: (url: string) => Promise<T>): Promise<T> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert(address && typeof address === "object")
  try { return await run(`http://127.0.0.1:${address.port}`) }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
}

test("Codex extracts both windows and ignores conversation text and malformed events", () => {
  const [snapshot] = parseQuotaEvent(quotaLine(), NOW)
  assert.equal(snapshot?.primary?.remainingPercent, 65)
  assert.equal(snapshot?.secondary?.windowMinutes, 10080)
  assert.equal(snapshot?.planType, "plus")
  assert.equal(snapshot?.stale, false)
  assert.deepEqual(parseQuotaEvent('{"type":"response_item","payload":{"text":"private"}}'), [])
  assert.deepEqual(parseQuotaEvent("truncated JSON"), [])
  assert.deepEqual(parseQuotaEvent(quotaLine().replace(timestamp, "invalid date")), [])
})

test("Codex supports multiple limit groups and clamps out-of-range percentages", () => {
  const event = JSON.parse(quotaLine(110))
  event.payload.rate_limits = [event.payload.rate_limits, { ...event.payload.rate_limits, limit_id: "model-limit", primary: null }]
  const snapshots = parseQuotaEvent(JSON.stringify(event), NOW)
  assert.equal(snapshots.length, 2)
  assert.equal(snapshots[0]?.primary?.remainingPercent, 0)
  assert.equal(snapshots[1]?.primary, null)
})

test("Codex scans archived and active sessions, tolerates corrupt files, and deduplicates history", async () => temporary(async (folder) => {
  const root = path.join(folder, "codex")
  await mkdir(path.join(root, "sessions", "nested"), { recursive: true })
  await mkdir(path.join(root, "archived_sessions"))
  await writeFile(path.join(root, "sessions", "nested", "old.jsonl"), quotaLine(10, NOW / 1000 + 3600, new Date(NOW - 60_000).toISOString()))
  await writeFile(path.join(root, "archived_sessions", "new.jsonl"), `${quotaLine(35)}\n{"truncated":\n`)
  const service = new CodexQuotaService(path.join(folder, "app"), root)
  const result = await service.collect()
  assert.equal(result.snapshots[0]?.primary?.usedPercent, 35)
  assert.equal(result.history.length, 2)
  assert.equal((await service.collect()).history.length, 2)
  assert(!JSON.stringify(result).includes("private"))
}))

test("missing Codex sessions produce an empty state without inventing quota", async () => temporary(async (folder) => {
  const result = await new CodexQuotaService(folder, path.join(folder, "missing")).collect()
  assert.equal(result.snapshots.length, 0)
  assert.equal(result.history.length, 0)
}))

test("history rejects delayed previous-cycle events and duplicate samples", () => {
  const snapshots = parseQuotaEvent(quotaLine(), NOW)
  const history = mergeQuotaHistory([], snapshots, NOW / 1000)
  assert.equal(mergeQuotaHistory(history, snapshots, NOW / 1000).length, 2)
  const outdated = parseQuotaEvent(quotaLine(98, NOW / 1000 - 1000, new Date(NOW + 60_000).toISOString()), NOW)
  const merged = mergeQuotaHistory(history, outdated, NOW / 1000)
  assert.equal(merged.filter((item) => item.window === "primary").length, 1)
})

test("30-day estimate tolerates reset jitter and percentage regressions", () => {
  const base = NOW / 1000 - 3 * 86_400
  const history = [point(40, base, 2e9), point(47, base + 86_400, 2e9 + 60), point(39, base + 2 * 86_400, 2e9 - 60), point(49, base + 3 * 86_400, 2e9 + 30)]
  assert.equal(estimateMonthlyQuota(history, NOW / 1000).percent, 90)
  assert.deepEqual(currentQuotaCycle(history).map((item) => item.usedPercent), [40, 47, 47, 49])
})

test("a genuine reset starts a separate trend and insufficient samples have no estimate", () => {
  const base = NOW / 1000 - 2 * 86_400
  const history = [point(80, base, 2e9), point(85, base + 86_400, 2e9), point(10, base + 2 * 86_400, 2e9 + 604800)]
  assert.equal(estimateMonthlyQuota(history, NOW / 1000).percent, 225)
  assert.equal(currentQuotaCycle(history).length, 1)
  assert.equal(estimateMonthlyQuota(history.slice(-1), NOW / 1000).percent, null)
})

test("DeepSeek parses decimal-string balances and missing balances fail", () => {
  const snapshot = parseDeepSeekBalance({ balance_infos: [{ currency: "CNY", total_balance: "100.50", granted_balance: "50.00", topped_up_balance: "50.50" }] })
  assert.equal(snapshot.remaining, 100.5)
  assert.equal(snapshot.unit, "CNY")
  assert.throws(() => parseDeepSeekBalance({}), /balance_infos/)
})

test("JSON Pointer handles escaped keys, arrays, and excludes inherited properties", () => {
  assert.equal(jsonPointer({ "a/b": { "x~y": [10] } }, "/a~1b/x~0y/0"), 10)
  assert.equal(jsonPointer({}, "/__proto__"), undefined)
})

test("custom usage supports numeric strings, breakdowns, and legitimate zero limits", () => {
  const snapshot = parseCustomUsage({ data: { used: "25", total: 100, breakdown: [{ label: "模型 A", tokens: 25 }] } }, fixtureConfig({ breakdownPath: "/data/breakdown" }))
  assert.equal(snapshot.remaining, 75)
  assert.equal(snapshot.breakdown[0]?.tokens, 25)
  assert.equal(parseCustomUsage({ data: { used: 0, total: 0 } }, fixtureConfig()).remaining, 0)
  assert.throws(() => parseCustomUsage({ data: { used: null, total: 100 } }, fixtureConfig()), /有效数字/)
  assert.throws(() => parseCustomUsage({ data: { used: " ", total: 100 } }, fixtureConfig()), /有效数字/)
})

test("New API uses site conversion settings and unknown conversions stay in quota units", () => {
  const account = { success: true, data: { quota: 1e6, used_quota: 5e5, request_count: 10 } }
  const converted = parseNewApiBalance(account, { data: { quota_per_unit: 5e5, quota_display_type: "CNY", usd_exchange_rate: 6.7 } })
  assert.equal(converted.remaining, 13.4)
  assert.equal(converted.used, 6.7)
  assert.equal(converted.requestCount, 10)
  assert.equal(parseNewApiBalance(account, null).remaining, 1e6)
  assert.equal(parseNewApiBalance(account, null).unit, "额度")
  assert.throws(() => parseNewApiBalance({ success: false, message: "sensitive server text" }, null), (error: Error) => !error.message.includes("sensitive"))
})

test("24-hour history aggregates model rows using currency conversion even for a zero-balance account", () => {
  const status = { data: { quota_per_unit: 500000, quota_display_type: "USD" } }
  const snapshot = parseNewApiBalance({ data: { quota: 0, used_quota: 0 } }, status)
  const details = withNewApiHistory(snapshot, { success: true, data: [
    { created_at: 1000, quota: 250000, count: 1 }, { created_at: 1000, quota: 250000, count: 2 }, { created_at: 10, quota: 500000, count: 9 },
  ] }, status, 500, 2000)
  assert.equal(details.recentUsage, 1)
  assert.equal(details.history.length, 1)
  assert.equal(details.history[0]?.requests, 3)
})

test("provider validation rejects unsupported protocols, invalid pointers, bodies, and intervals", () => {
  assert.throws(() => validateProvider(fixtureConfig({ baseUrl: "file:///C:/secret" })), /接口地址/)
  assert.throws(() => validateProvider(fixtureConfig({ baseUrl: "https://user:password@example.com" })), /接口地址/)
  assert.throws(() => validateProvider(fixtureConfig({ usedPath: "used" })), /JSON Pointer/)
  assert.throws(() => validateProvider(fixtureConfig({ method: "POST", body: "invalid" })), /JSON/)
  assert.throws(() => validateProvider(fixtureConfig({ refreshMinutes: 0 })), /刷新间隔/)
})

test("credentials are encrypted on disk and omitted from public states; clearing and deleting work", async () => temporary(async (folder) => {
  const cipher = testCipher()
  const store = new UsageProviderStore(folder, cipher)
  const saved = await store.save({ config: fixtureConfig(), credential: "test-private-token" })
  assert(saved.config.hasCredential)
  assert(!JSON.stringify(saved).includes("test-private-token"))
  assert(!(await readFile(path.join(folder, "api-usage-providers.json"), "utf8")).includes("test-private-token"))
  assert.equal(await store.credential(saved.config.id), "test-private-token")
  const reloaded = new UsageProviderStore(folder, cipher)
  assert.equal(await reloaded.credential(saved.config.id), "test-private-token")
  await store.save({ config: saved.config })
  assert.equal(await store.credential(saved.config.id), "test-private-token")
  const cleared = await store.save({ config: saved.config, credential: "" })
  assert.equal(cleared.config.hasCredential, false)
  await store.delete(saved.config.id)
  assert.equal((await store.list()).length, 0)
}))

test("unavailable encryption rejects credential persistence and corrupt config is preserved", async () => temporary(async (folder) => {
  const cipher = { ...testCipher(), available: () => false }
  await assert.rejects(new UsageProviderStore(folder, cipher).save({ config: fixtureConfig(), credential: "private" }), /安全存储/)
  await writeFile(path.join(folder, "api-usage-providers.json"), "corrupt config")
  const store = new UsageProviderStore(folder, testCipher())
  await assert.rejects(store.list(), /无法读取/)
  assert.equal(await readFile(path.join(folder, "api-usage-providers.json"), "utf8"), "corrupt config")
}))

test("concurrent saves are serialized and changing provider kind clears old credentials", async () => temporary(async (folder) => {
  const store = new UsageProviderStore(folder, testCipher())
  const saved = await Promise.all(Array.from({ length: 4 }, (_, index) => store.save({ config: fixtureConfig({ name: `服务 ${index}` }), credential: "private" })))
  assert.equal((await store.list()).length, 4)
  const changed = await store.save({ config: { ...saved[0]!.config, kind: "deepseek" } })
  assert.equal(changed.config.hasCredential, false)
}))

test("custom query traverses HTTP, retains cache on authentication failure, and tests never save", async () => temporary(async (folder) => {
  let authorized = true
  let method = ""
  let auth = ""
  let requestBody = ""
  await mockServer((request, response) => {
    method = request.method ?? ""
    auth = request.headers.authorization ?? ""
    request.on("data", (chunk) => { requestBody += chunk })
    request.on("end", () => {
      response.writeHead(authorized ? 200 : 401, { "Content-Type": "application/json" })
      response.end(JSON.stringify(authorized ? { data: { used: 25, total: 100 } } : { message: "private-token" }))
    })
  }, async (url) => {
    const store = new UsageProviderStore(folder, testCipher())
    const service = new ApiUsageService(store)
    const config = fixtureConfig({ baseUrl: `${url}/usage`, method: "POST", body: '{"range":"month"}' })
    const tested = await service.test({ config, credential: "Bearer fake-test-key" })
    assert.equal(tested.remaining, 75)
    assert.equal((await store.list()).length, 0)
    assert.equal(method, "POST")
    assert.equal(auth, "Bearer fake-test-key")
    assert.equal(requestBody, '{"range":"month"}')
    const saved = await store.save({ config, credential: "Bearer fake-test-key" })
    const success = await service.refresh(saved.config.id)
    authorized = false
    const failure = await service.refresh(saved.config.id)
    assert.deepEqual(failure.snapshot, success.snapshot)
    assert.match(failure.error ?? "", /凭据失效/)
    assert(!failure.error?.includes("private-token"))
  })
}))

test("New API HTTP requests use PAT and numeric user ID and degrade gracefully when history fails", async () => temporary(async (folder) => {
  let failHistory = false
  const calls: string[] = []
  await mockServer((request, response) => {
    calls.push(request.url ?? "")
    response.setHeader("Content-Type", "application/json")
    if (request.url === "/api/status") { assert.equal(request.headers.authorization, undefined); response.end(JSON.stringify({ data: { quota_per_unit: 500000, quota_display_type: "USD" } })); return }
    assert.equal(request.headers.authorization, "Bearer fake-pat")
    assert.equal(request.headers["new-api-user"], "123")
    if (request.url === "/api/user/self") { response.end(JSON.stringify({ success: true, data: { quota: 1000000, used_quota: 500000, request_count: 5 } })); return }
    if (failHistory) { response.writeHead(404); response.end(); return }
    response.end(JSON.stringify({ success: true, data: [{ created_at: Math.floor(Date.now() / 1000) - 60, quota: 250000, count: 2 }] }))
  }, async (url) => {
    const store = new UsageProviderStore(folder, testCipher())
    const saved = await store.save({ config: fixtureConfig({ kind: "new-api", baseUrl: url, accountUserId: "123" }), credential: "fake-pat" })
    const service = new ApiUsageService(store)
    const result = await service.refresh(saved.config.id)
    assert.equal(result.snapshot?.remaining, 2)
    assert.equal(result.snapshot?.recentUsage, 0.5)
    assert(calls.some((url) => url.startsWith("/api/data/self?")))
    failHistory = true
    const partial = await service.refresh(saved.config.id)
    assert.equal(partial.error, null)
    assert.equal(partial.snapshot?.remaining, 2)
    assert.match(partial.snapshot?.detailError ?? "", /HTTP 404/)
  })
}))

test("redirects and responses above 2 MB fail without echoing server content", async () => temporary(async (folder) => {
  await mockServer((request, response) => {
    if (request.url === "/redirect") { response.writeHead(302, { Location: "/usage" }); response.end(); return }
    response.end("x".repeat(2 * 1024 * 1024 + 1))
  }, async (url) => {
    const service = new ApiUsageService(new UsageProviderStore(folder, testCipher()))
    await assert.rejects(service.test({ config: fixtureConfig({ baseUrl: `${url}/redirect` }) }), /重定向/)
    await assert.rejects(service.test({ config: fixtureConfig({ baseUrl: `${url}/large` }) }), /2 MB/)
  })
}))

test("in-flight results cannot overwrite a provider edited while the request runs", async () => temporary(async (folder) => {
  let signalRequest!: () => void
  let finishRequest!: () => void
  const received = new Promise<void>((resolve) => { signalRequest = resolve })
  const release = new Promise<void>((resolve) => { finishRequest = resolve })
  await mockServer((_request, response) => {
    signalRequest()
    void release.then(() => response.end(JSON.stringify({ data: { used: 25, total: 100 } })))
  }, async (url) => {
    const store = new UsageProviderStore(folder, testCipher())
    const saved = await store.save({ config: fixtureConfig({ baseUrl: url }), credential: "old-key" })
    const request = new ApiUsageService(store).refresh(saved.config.id)
    await received
    const updated = await store.save({ config: saved.config, credential: "new-key" })
    finishRequest()
    const result = await request
    assert.equal(result.revision, updated.revision)
    assert.equal(result.snapshot, null)
  })
}))
