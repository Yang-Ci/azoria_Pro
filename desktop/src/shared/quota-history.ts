import type { QuotaHistoryPoint } from "./usage"

const DAY = 86_400
export const RESET_TOLERANCE_SECONDS = 300

export function sameQuotaCycle(left: QuotaHistoryPoint, right: QuotaHistoryPoint): boolean {
  return left.limitId === right.limitId && left.window === right.window
    && left.windowMinutes === right.windowMinutes
    && Math.abs(left.resetsAt - right.resetsAt) <= RESET_TOLERANCE_SECONDS
}

export function quotaSeries(history: QuotaHistoryPoint[], limitId: string, window: QuotaHistoryPoint["window"]): QuotaHistoryPoint[] {
  return history.filter((point) => point.limitId === limitId && point.window === window)
    .sort((left, right) => left.sampledAt - right.sampledAt)
}

export function currentQuotaCycle(points: QuotaHistoryPoint[]): QuotaHistoryPoint[] {
  const last = points.at(-1)
  if (!last) return []
  let start = points.length - 1
  while (start > 0 && sameQuotaCycle(points[start - 1]!, last)) start--
  let peak = 0
  return points.slice(start).map((point) => {
    peak = Math.max(peak, point.usedPercent)
    return { ...point, usedPercent: peak }
  })
}

export function estimateMonthlyQuota(points: QuotaHistoryPoint[], now = Date.now() / 1000): { percent: number | null; days: number; confidence: string } {
  const recent = points.filter((point) => point.sampledAt >= now - 30 * DAY && point.windowMinutes === points.at(-1)?.windowMinutes)
  const first = recent[0]
  const last = recent.at(-1)
  if (!first || !last || recent.length < 2 || last.sampledAt - first.sampledAt < 3600) {
    return { percent: null, days: 0, confidence: "数据不足" }
  }
  let consumption = 0
  let peak = first.usedPercent
  let previous = first
  for (const point of recent.slice(1)) {
    if (!sameQuotaCycle(previous, point)) {
      // Older reset times can be delayed samples from the previous cycle.
      if (point.resetsAt < previous.resetsAt - RESET_TOLERANCE_SECONDS) continue
      consumption += point.usedPercent
      peak = point.usedPercent
    } else if (point.usedPercent > peak) {
      consumption += point.usedPercent - peak
      peak = point.usedPercent
    }
    previous = point
  }
  const days = Math.max(1, (last.sampledAt - first.sampledAt) / DAY)
  return {
    percent: consumption / days * 30,
    days,
    confidence: days >= 14 && recent.length >= 20 ? "较高" : days >= 3 && recent.length >= 5 ? "一般" : "较低",
  }
}
