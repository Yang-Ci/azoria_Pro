import { execFile } from "node:child_process"
import { cpus, freemem, totalmem, networkInterfaces } from "node:os"
import { promisify } from "node:util"
import type { ComputerSample, ComputerSnapshot } from "../shared/contracts"
import { computerTouchStatus } from "../shared/computer"

const run = promisify(execFile)
export interface CpuCounters { idle: number; total: number }
export interface NetworkCounter { id: string; name: string; receivedBytes: string; sentBytes: string }
export function cpuUsage(previous: CpuCounters | null, current: CpuCounters): number | null {
  if (!previous || current.total <= previous.total || current.idle < previous.idle) return null
  return Math.max(0, Math.min(100, (1 - (current.idle - previous.idle) / (current.total - previous.total)) * 100))
}
export function networkRates(previous: NetworkCounter[] | null, current: NetworkCounter[], seconds: number): { rx: number; tx: number } | null {
  if (!previous || !Number.isFinite(seconds) || seconds <= 0 || seconds > 15) return null
  const old = new Map(previous.map(item => [item.id, item]))
  let rx = 0n, tx = 0n, matched = false
  for (const item of current) {
    const before = old.get(item.id)
    if (!before) continue
    const received = BigInt(item.receivedBytes) - BigInt(before.receivedBytes)
    const sent = BigInt(item.sentBytes) - BigInt(before.sentBytes)
    if (received < 0n || sent < 0n) continue
    matched = true; rx += received; tx += sent
  }
  return matched || !current.length && !previous.length ? { rx: Number(rx) / seconds, tx: Number(tx) / seconds } : null
}

export class ComputerStatsService {
  private previousCpu: CpuCounters | null = null
  private previousNetwork: NetworkCounter[] | null = null
  private previousNetworkAt = 0
  private timer?: NodeJS.Timeout
  private pending: Promise<void> | null = null
  private history: ComputerSample[] = []
  private last: ComputerSnapshot = { available: false, networkAvailable: false, sampledAt: 0, cpuPercent: null, memoryPercent: 0, memoryUsedBytes: 0, memoryTotalBytes: 0, networkRxBps: null, networkTxBps: null, history: [] }
  constructor(private readonly sidecarBinary: string, private readonly collectNetwork?: () => Promise<NetworkCounter[]>) {}
  start(): void { if (this.timer) return; void this.sample(); this.timer = setInterval(() => void this.sample(), 2000); this.timer.unref() }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined }
  snapshot(): ComputerSnapshot { return structuredClone({ ...this.last, available: this.last.available && Date.now() - this.last.sampledAt < 10_000, history: this.history }) }
  touchStatus(): Record<string, string | number | boolean> { return computerTouchStatus(this.snapshot()) }
  private async network(): Promise<NetworkCounter[]> {
    if (this.collectNetwork) return this.collectNetwork()
    const { stdout } = await run(this.sidecarBinary, [JSON.stringify({ operation: "network_stats" })], { timeout: 1500, maxBuffer: 128 * 1024, windowsHide: true })
    const response = JSON.parse(stdout)
    if (!response.ok || !Array.isArray(response.result?.interfaces)) throw new Error("网络计数器不可用")
    const activeNames = new Set(Object.entries(networkInterfaces()).filter(([, addresses]) => addresses?.some(item => !item.internal)).map(([name]) => name))
    return response.result.interfaces.filter((item: NetworkCounter) => item && typeof item.id === "string" && typeof item.name === "string"
      && /^\d{1,20}$/.test(item.receivedBytes) && /^\d{1,20}$/.test(item.sentBytes) && activeNames.has(item.name))
  }
  sample(): Promise<void> {
    if (this.pending) return this.pending
    this.pending = this.collect().finally(() => { this.pending = null })
    return this.pending
  }
  private async collect(): Promise<void> {
    const processors = cpus()
    const current = processors.reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 })
    const cpuPercent = cpuUsage(this.previousCpu, current)
    this.previousCpu = current
    const memoryTotalBytes = totalmem(), memoryUsedBytes = Math.max(0, memoryTotalBytes - freemem())
    let networkAvailable = false, networkRxBps: number | null = null, networkTxBps: number | null = null
    try {
      const counters = await this.network()
      const at = performance.now()
      const rate = networkRates(this.previousNetwork, counters, (at - this.previousNetworkAt) / 1000)
      this.previousNetwork = counters; this.previousNetworkAt = at
      networkRxBps = rate?.rx ?? null; networkTxBps = rate?.tx ?? null
      networkAvailable = rate !== null
    } catch { this.previousNetwork = null; this.previousNetworkAt = 0 }
    const sample: ComputerSample = { sampledAt: Date.now(), cpuPercent, memoryPercent: memoryTotalBytes ? memoryUsedBytes / memoryTotalBytes * 100 : 0, memoryUsedBytes, memoryTotalBytes, networkRxBps, networkTxBps }
    // A suspended machine starts a new one-minute timeline on wake.
    if (this.history.length && sample.sampledAt - this.history.at(-1)!.sampledAt > 10_000) { this.history = []; sample.cpuPercent = null }
    this.history.push(sample); this.history = this.history.slice(-30)
    this.last = { ...sample, available: processors.length > 0 && memoryTotalBytes > 0, networkAvailable, history: [] }
  }
}
