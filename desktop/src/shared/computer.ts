import type { ComputerSnapshot } from "./contracts"

export function computerTouchStatus(snapshot: ComputerSnapshot): Record<string, string | number | boolean> {
  const rounded = (value: number | null) => value === null ? -1 : Math.round(value)
  const trend = (values: Array<number | null>, scale = 100) => values.slice(-30).map(value => value === null ? -1 : Math.max(0, Math.min(100, Math.round(value / Math.max(1, scale) * 100)))).join(",")
  const rates = snapshot.history.flatMap(item => [item.networkRxBps ?? 0, item.networkTxBps ?? 0])
  const networkScale = Math.max(1024, ...rates)
  const recent = snapshot.available && Date.now() - snapshot.sampledAt < 10_000
  return {
    statsSupported: true, statsAvailable: recent,
    statsCpuPercent: rounded(snapshot.cpuPercent), statsMemoryPercent: rounded(snapshot.memoryPercent),
    statsMemoryUsedMb: Math.round(snapshot.memoryUsedBytes / 1048576), statsMemoryTotalMb: Math.round(snapshot.memoryTotalBytes / 1048576),
    statsNetworkAvailable: recent && snapshot.networkAvailable,
    statsRxBps: Math.min(2147483647, Math.round(snapshot.networkRxBps ?? 0)), statsTxBps: Math.min(2147483647, Math.round(snapshot.networkTxBps ?? 0)),
    statsCpuTrend: trend(snapshot.history.map(item => item.cpuPercent)), statsMemoryTrend: trend(snapshot.history.map(item => item.memoryPercent)),
    statsRxTrend: trend(snapshot.history.map(item => item.networkRxBps), networkScale), statsTxTrend: trend(snapshot.history.map(item => item.networkTxBps), networkScale),
  }
}

export function computerBlePage(status: Record<string, string | number | boolean>, page: number): string {
  if (page === 0) return `P|0|${status.statsAvailable ? 1 : 0}|${status.statsCpuPercent}|${status.statsMemoryPercent}|${status.statsMemoryUsedMb}|${status.statsMemoryTotalMb}|${status.statsNetworkAvailable ? 1 : 0}|${status.statsRxBps}|${status.statsTxBps}`
  if (page === 1) return `P|1|${status.statsCpuTrend}|${status.statsMemoryTrend}`
  if (page === 2) return `P|2|${status.statsRxTrend}|${status.statsTxTrend}`
  throw new Error("电脑状态分页无效")
}
