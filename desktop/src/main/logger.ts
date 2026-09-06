import { appendFile, mkdir, readFile, rename, stat, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import type { DiagnosticRecord } from "../shared/contracts"

const maxFileBytes = 2 * 1024 * 1024
const retainedFiles = 3

export type LogFields = Record<string, string | number | boolean | null | undefined>
type LogLevel = "info" | "warn" | "error"

export class LocalLogger {
  private readonly file: string
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string) {
    this.file = path.join(directory, "azoria-desktop.jsonl")
  }

  get path(): string {
    return this.file
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.rotateIfNeeded(0)
  }

  info(event: string, fields: LogFields = {}): void {
    this.write("info", event, fields)
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write("warn", event, fields)
  }

  error(event: string, fields: LogFields = {}): void {
    this.write("error", event, fields)
  }

  async readRecent(limit = 200): Promise<DiagnosticRecord[]> {
    await this.queue
    let content = ""
    try { content = await readFile(this.file, { encoding: "utf8" }) }
    catch { return [] }
    const lines = content.split("\n").filter(Boolean).slice(-limit)
    return lines.flatMap((line): DiagnosticRecord[] => {
      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(line) as Record<string, unknown> }
      catch { return [] }
      const level = parsed.level
      const record: DiagnosticRecord = {
        timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
        level: level === "warn" || level === "error" ? level : "info",
        event: typeof parsed.event === "string" ? parsed.event : "",
        message: typeof parsed.error === "string" ? parsed.error : "",
        control: typeof parsed.control === "string" ? parsed.control : undefined,
        source: typeof parsed.source === "string" ? parsed.source : undefined,
        transport: typeof parsed.transport === "string" ? parsed.transport : undefined,
        profile: typeof parsed.profile === "string" ? parsed.profile : undefined,
        durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : undefined,
        routeDurationMs: typeof parsed.routeDurationMs === "number" ? parsed.routeDurationMs : undefined,
        verification: typeof parsed.verification === "string" ? parsed.verification : undefined,
        reusedPreview: typeof parsed.reusedPreview === "boolean" ? parsed.reusedPreview : undefined,
        error: typeof parsed.error === "string" ? parsed.error : undefined,
      }
      return [record]
    })
  }

  private write(level: LogLevel, event: string, fields: LogFields): void {
    const record: Record<string, string | number | boolean | null> = {
      timestamp: new Date().toISOString(),
      level,
      event,
    }
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue
      record[key] = typeof value === "string" ? this.sanitize(value) : value
    }
    const line = `${JSON.stringify(record)}\n`
    this.queue = this.queue.then(async () => {
      await this.rotateIfNeeded(Buffer.byteLength(line))
      await appendFile(this.file, line, { encoding: "utf8", mode: 0o600 })
    }).catch(() => undefined)
  }

  private sanitize(value: string): string {
    const home = homedir()
    const withoutHome = home && value.includes(home) ? value.split(home).join("<home>") : value
    return withoutHome.replace(/[\r\n\t]+/g, " ").slice(0, 320)
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    let size = 0
    try { size = (await stat(this.file)).size }
    catch { return }
    if (size + incomingBytes <= maxFileBytes) return
    for (let index = retainedFiles; index >= 1; index--) {
      const destination = `${this.file}.${index}`
      const source = index === 1 ? this.file : `${this.file}.${index - 1}`
      try { await unlink(destination) } catch { /* Missing rotations are expected. */ }
      try { await rename(source, destination) } catch { /* Missing rotations are expected. */ }
    }
  }
}
