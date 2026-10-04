export interface QuotaWindow {
  usedPercent: number
  remainingPercent: number
  windowMinutes: number
  resetsAt: number
}

export interface CodexQuotaSnapshot {
  limitId: string
  limitName: string
  planType: string
  sampledAt: string
  primary: QuotaWindow | null
  secondary: QuotaWindow | null
  credits: { unlimited: boolean; balance: string | null } | null
  stale: boolean
}

export interface QuotaHistoryPoint {
  limitId: string
  window: "primary" | "secondary"
  sampledAt: number
  usedPercent: number
  windowMinutes: number
  resetsAt: number
}

export interface CodexQuotaData {
  snapshots: CodexQuotaSnapshot[]
  history: QuotaHistoryPoint[]
  codexHome: string
  checkedAt: string
  warnings: string[]
}

export type ApiProviderKind = "deepseek" | "new-api" | "custom"

export interface ApiProviderConfig {
  id: string
  kind: ApiProviderKind
  name: string
  enabled: boolean
  baseUrl: string
  accountUserId: string
  refreshMinutes: number
  method: "GET" | "POST"
  body: string
  usedPath: string
  totalPath: string
  breakdownPath: string
  unit: string
  hasCredential: boolean
}

export interface ApiProviderInput {
  config: ApiProviderConfig
  // Undefined preserves the stored credential; an empty string clears it.
  credential?: string
}

export interface ApiUsageHistoryPoint {
  timestamp: number
  usage: number
  requests: number
}

export interface ApiUsageSnapshot {
  sampledAt: string
  unit: string
  remaining: number
  used: number | null
  total: number | null
  granted: number | null
  toppedUp: number | null
  recentUsage: number | null
  requestCount: number | null
  breakdown: { label: string; tokens: number }[]
  history: ApiUsageHistoryPoint[]
  detailError: string | null
}

export interface ApiProviderState {
  revision: number
  config: ApiProviderConfig
  snapshot: ApiUsageSnapshot | null
  error: string | null
  checkedAt: string | null
}

export interface UsageApi {
  touch(index?: number): Promise<import("./touch-usage").TouchUsageStatus>
  codex(): Promise<CodexQuotaData>
  providers(): Promise<ApiProviderState[]>
  saveProvider(input: ApiProviderInput): Promise<ApiProviderState>
  deleteProvider(id: string): Promise<void>
  refreshProvider(id: string): Promise<ApiProviderState>
  testProvider(input: ApiProviderInput): Promise<ApiUsageSnapshot>
}
