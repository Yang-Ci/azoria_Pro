import type { ApiProviderState, CodexQuotaData } from "./usage"

/** A bounded, credential-free snapshot shared by LAN and paged BLE. */
export interface TouchUsageStatus {
  usageSupported: boolean
  usageCodexAvailable: boolean
  usageCodexPlan: string
  usageCodexStale: boolean
  usagePrimaryMinutes: number
  usagePrimaryRemaining: number
  usagePrimaryResetsAt: number
  usageSecondaryMinutes: number
  usageSecondaryRemaining: number
  usageSecondaryResetsAt: number
  usageCodexSampledAt: number
  usageProviderCount: number
  usageProviderIndex: number
  usageApiName: string
  usageApiAvailable: boolean
  usageApiStale: boolean
  usageApiPaused: boolean
  usageApiError: boolean
  usageApiUnit: string
  usageApiRemaining: string
  usageApiCompact: string
  usageApiScale: string
  usageApiUsed: string
  usageApiRecent: string
  usageApiRequests: string
  usageApiSampledAt: number
}

export function touchUsageText(value: string, maxBytes: number): string {
  let result = ""
  for (const char of value.replace(/[\\"|\r\n\u0000-\u001f]/g, " ").trim()) {
    if (new TextEncoder().encode(result + char).length > maxBytes) break
    result += char
  }
  return result
}

export function compactTouchAmount(value: number | null): { amount: string; scale: string } {
  if (value === null || !Number.isFinite(value)) return { amount: "--", scale: "" }
  const magnitude = Math.abs(value)
  // Retain the actual sign; shrinking a value never changes the underlying amount.
  const scales: [number, string][] = [[1e12, "T"], [1e8, "亿"], [1e4, "万"]]
  for (const [divisor, scale] of scales) {
    if (magnitude >= divisor) return { amount: (value / divisor).toFixed(2), scale }
  }
  return { amount: value.toFixed(2), scale: "" }
}

function fullAmount(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return "--"
  return Math.abs(value) >= 1e16 ? value.toExponential(6) : value.toFixed(decimals)
}

const epoch = (value?: string): number => value && Number.isFinite(Date.parse(value)) ? Math.floor(Date.parse(value) / 1000) : 0

export function makeTouchUsage(quota: CodexQuotaData | null, providers: ApiProviderState[], index = 0, now = Date.now()): TouchUsageStatus {
  const codex = quota?.snapshots.find(item => item.limitId === "codex") ?? quota?.snapshots[0]
  const selected = providers.length ? Math.min(Math.max(0, Math.trunc(index) || 0), providers.length - 1) : 0
  const provider = providers[selected]
  const snapshot = provider?.snapshot
  const compact = compactTouchAmount(snapshot?.remaining ?? null)
  const elapsed = now / 1000
  return {
    usageSupported: true, usageCodexAvailable: !!codex, usageCodexPlan: touchUsageText(codex?.planType ?? "", 16),
    usageCodexStale: !!codex && (codex.stale || now - Date.parse(codex.sampledAt) > 6 * 3600_000),
    usagePrimaryMinutes: codex?.primary?.windowMinutes ?? 0,
    usagePrimaryRemaining: codex?.primary ? Math.round(codex.primary.remainingPercent * 10) : -1,
    usagePrimaryResetsAt: codex?.primary?.resetsAt ?? 0,
    usageSecondaryMinutes: codex?.secondary?.windowMinutes ?? 0,
    usageSecondaryRemaining: codex?.secondary ? Math.round(codex.secondary.remainingPercent * 10) : -1,
    usageSecondaryResetsAt: codex?.secondary?.resetsAt ?? 0,
    usageCodexSampledAt: epoch(codex?.sampledAt),
    usageProviderCount: providers.length, usageProviderIndex: selected,
    usageApiName: touchUsageText(provider?.config.name ?? "", 48), usageApiAvailable: !!snapshot,
    usageApiStale: !!snapshot && elapsed - epoch(snapshot.sampledAt) > (provider?.config.refreshMinutes ?? 30) * 120,
    usageApiPaused: !!provider && !provider.config.enabled, usageApiError: !!provider?.error,
    usageApiUnit: touchUsageText(snapshot?.unit ?? provider?.config.unit ?? "", 12),
    usageApiRemaining: fullAmount(snapshot?.remaining ?? null), usageApiCompact: compact.amount, usageApiScale: compact.scale,
    usageApiUsed: fullAmount(snapshot?.used ?? null), usageApiRecent: fullAmount(snapshot?.recentUsage ?? null),
    usageApiRequests: fullAmount(snapshot?.requestCount ?? null, 0), usageApiSampledAt: epoch(snapshot?.sampledAt),
  }
}

/** Three pages keep each authenticated notification below the 256-byte BLE MTU. */
export function touchUsageBlePage(status: TouchUsageStatus, page: number): string {
  const bit = (value: boolean) => value ? 1 : 0
  if (page === 0) return `V|0|${bit(status.usageSupported)}|${bit(status.usageCodexAvailable)}|${status.usageCodexPlan}|${bit(status.usageCodexStale)}|${status.usagePrimaryMinutes}|${status.usagePrimaryRemaining}|${status.usagePrimaryResetsAt}|${status.usageSecondaryMinutes}|${status.usageSecondaryRemaining}|${status.usageSecondaryResetsAt}|${status.usageCodexSampledAt}`
  if (page === 1) return `V|1|${status.usageProviderCount}|${status.usageProviderIndex}|${status.usageApiName}|${bit(status.usageApiAvailable)}|${bit(status.usageApiStale)}|${bit(status.usageApiPaused)}|${bit(status.usageApiError)}|${status.usageApiUnit}|${status.usageApiCompact}|${status.usageApiScale}|${status.usageApiSampledAt}`
  if (page === 2) return `V|2|${status.usageApiRemaining}|${status.usageApiUsed}|${status.usageApiRecent}|${status.usageApiRequests}`
  throw new Error("Invalid Touch usage page")
}
