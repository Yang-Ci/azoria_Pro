export function usageError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
}

export function formatAmount(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return "—"
  return value.toLocaleString("zh-CN", { maximumFractionDigits: unit === "CNY" || unit === "USD" ? 2 : 3, minimumFractionDigits: unit === "CNY" || unit === "USD" ? 2 : 0 })
}

export function formatPeriod(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`
  if (minutes % 60 === 0) return `${minutes / 60} 小时`
  return `${minutes} 分钟`
}

export function formatSample(value: string | null | undefined): string {
  if (!value) return "等待采样"
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

export function formatReset(timestamp: number, now: number): string {
  const remaining = Math.ceil(timestamp - now / 1000)
  if (remaining <= 0) return "周期已结束，等待新采样"
  const days = Math.floor(remaining / 86_400)
  const hours = Math.floor(remaining % 86_400 / 3600)
  const minutes = Math.ceil(remaining % 3600 / 60)
  return `${days > 0 ? `${days} 天 ` : ""}${hours > 0 ? `${hours} 小时 ` : ""}${minutes} 分钟后重置`
}
