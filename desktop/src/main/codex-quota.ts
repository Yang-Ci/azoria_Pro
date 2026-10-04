import { homedir } from "node:os"
import path from "node:path"
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import type { CodexQuotaData, CodexQuotaSnapshot, QuotaHistoryPoint, QuotaWindow } from "../shared/usage"
import { RESET_TOLERANCE_SECONDS } from "../shared/quota-history"

const MAX_FILES = 50
const MAX_TAIL_BYTES = 2 * 1024 * 1024
const MAX_HISTORY_POINTS = 10_000

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function parseWindow(value: unknown): QuotaWindow | null {
  const data = record(value)
  if (!data || typeof data.used_percent !== "number" || !Number.isFinite(data.used_percent)
    || typeof data.window_minutes !== "number" || !Number.isFinite(data.window_minutes) || data.window_minutes <= 0
    || typeof data.resets_at !== "number" || !Number.isFinite(data.resets_at) || data.resets_at <= 0) return null
  const usedPercent = Math.min(100, Math.max(0, data.used_percent))
  return { usedPercent, remainingPercent: 100 - usedPercent, windowMinutes: data.window_minutes, resetsAt: data.resets_at }
}

export function parseQuotaEvent(line: string, now = Date.now()): CodexQuotaSnapshot[] {
  try {
    const event = record(JSON.parse(line))
    const payload = record(event?.payload)
    if (event?.type !== "event_msg" || payload?.type !== "token_count" || typeof event.timestamp !== "string"
      || !Number.isFinite(Date.parse(event.timestamp))) return []
    const limits = payload.rate_limits
    const entries = Array.isArray(limits) ? limits : [limits]
    return entries.flatMap((value): CodexQuotaSnapshot[] => {
      const data = record(value)
      if (!data) return []
      const primary = parseWindow(data.primary)
      const secondary = parseWindow(data.secondary)
      if (!primary && !secondary) return []
      const credits = record(data.credits)
      const sampledAt = new Date(event.timestamp as string).toISOString()
      return [{
        limitId: typeof data.limit_id === "string" ? data.limit_id : "codex",
        limitName: typeof data.limit_name === "string" ? data.limit_name : "Codex",
        planType: typeof data.plan_type === "string" ? data.plan_type : "unknown",
        sampledAt, primary, secondary,
        credits: credits ? {
          unlimited: credits.unlimited === true,
          balance: typeof credits.balance === "string" || typeof credits.balance === "number" ? String(credits.balance) : null,
        } : null,
        stale: now - Date.parse(sampledAt) >= 6 * 3600_000,
      }]
    })
  } catch { return [] }
}

export function mergeQuotaHistory(history: QuotaHistoryPoint[], snapshots: CodexQuotaSnapshot[], now = Date.now() / 1000): QuotaHistoryPoint[] {
  const next = history.filter((point) => point.sampledAt >= now - 45 * 86_400)
  for (const snapshot of snapshots) {
    for (const window of ["primary", "secondary"] as const) {
      const rate = snapshot[window]
      if (!rate) continue
      const sampledAt = Date.parse(snapshot.sampledAt) / 1000
      const previous = next.filter((point) => point.limitId === snapshot.limitId && point.window === window).at(-1)
      if (previous && (sampledAt <= previous.sampledAt
        || (rate.windowMinutes === previous.windowMinutes && rate.resetsAt < previous.resetsAt - RESET_TOLERANCE_SECONDS))) continue
      next.push({ limitId: snapshot.limitId, window, sampledAt, usedPercent: rate.usedPercent, windowMinutes: rate.windowMinutes, resetsAt: rate.resetsAt })
    }
  }
  return next.sort((left, right) => left.sampledAt - right.sampledAt).slice(-MAX_HISTORY_POINTS)
}

function validHistory(value: unknown): value is QuotaHistoryPoint {
  const data = record(value)
  return !!data && typeof data.limitId === "string" && (data.window === "primary" || data.window === "secondary")
    && [data.sampledAt, data.usedPercent, data.windowMinutes, data.resetsAt].every((value) => typeof value === "number" && Number.isFinite(value))
    && Number(data.usedPercent) >= 0 && Number(data.usedPercent) <= 100 && Number(data.windowMinutes) > 0
}

export class CodexQuotaService {
  private pending: Promise<CodexQuotaData> | null = null
  constructor(private readonly userData: string, private readonly root = process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex")) {}

  collect(): Promise<CodexQuotaData> {
    if (this.pending) return this.pending
    this.pending = this.collectData().finally(() => { this.pending = null })
    return this.pending
  }

  private async collectData(): Promise<CodexQuotaData> {
    const warnings: string[] = []
    const candidates: { file: string; modified: number }[] = []
    const walk = async (folder: string): Promise<void> => {
      let entries
      try { entries = await readdir(folder, { withFileTypes: true }) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") warnings.push("部分 Codex 会话目录无法读取，请检查目录权限。")
        return
      }
      for (const entry of entries) {
        const file = path.join(folder, entry.name)
        if (entry.isDirectory()) await walk(file)
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          try { candidates.push({ file, modified: (await stat(file)).mtimeMs }) } catch { /* A session may be moved while scanning. */ }
        }
      }
    }
    await Promise.all([walk(path.join(this.root, "sessions")), walk(path.join(this.root, "archived_sessions"))])
    candidates.sort((left, right) => right.modified - left.modified)
    const latest = new Map<string, CodexQuotaSnapshot>()
    for (const { file } of candidates.slice(0, MAX_FILES)) {
      try {
        const handle = await open(file, "r")
        try {
          const size = (await handle.stat()).size
          const start = Math.max(0, size - MAX_TAIL_BYTES)
          const buffer = Buffer.alloc(Math.min(size, MAX_TAIL_BYTES))
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
          const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n")
          if (start > 0) lines.shift()
          for (const line of lines) {
            if (!line.includes('"rate_limits"') || !line.includes('"token_count"')) continue
            for (const snapshot of parseQuotaEvent(line)) {
              const previous = latest.get(snapshot.limitId)
              if (!previous || snapshot.sampledAt > previous.sampledAt) latest.set(snapshot.limitId, snapshot)
            }
          }
        } finally { await handle.close() }
      } catch { warnings.push("部分会话文件无法读取，已使用其他可读文件。") }
    }
    const snapshots = [...latest.values()].sort((left, right) => right.sampledAt.localeCompare(left.sampledAt))
    const historyPath = path.join(this.userData, "codex-quota-history.json")
    let history: QuotaHistoryPoint[] = []
    let canSave = true
    try {
      const value: unknown = JSON.parse(await readFile(historyPath, "utf8"))
      if (Array.isArray(value)) history = value.filter(validHistory).sort((left, right) => left.sampledAt - right.sampledAt)
      else throw new Error("invalid history")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        warnings.push("历史采样文件无法读取，本次仍显示最新额度。")
        canSave = false
      }
    }
    const merged = mergeQuotaHistory(history, snapshots)
    if (canSave && JSON.stringify(merged) !== JSON.stringify(history)) {
      try {
        await mkdir(this.userData, { recursive: true })
        await writeFile(`${historyPath}.tmp`, JSON.stringify(merged), { mode: 0o600 })
        await rename(`${historyPath}.tmp`, historyPath)
      } catch { warnings.push("无法保存历史采样，本次仍显示最新额度。") }
    }
    return { snapshots, history: merged, codexHome: this.root, checkedAt: new Date().toISOString(), warnings: [...new Set(warnings)] }
  }
}
