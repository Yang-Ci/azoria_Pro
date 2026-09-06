import { app } from "electron"
import type { DiagnosticRecord, DiagnosticsReport, DiagnosticsSummary } from "../shared/contracts"
import type { LanController } from "./lan"
import type { LocalLogger } from "./logger"
import type { MonitorController } from "./monitor"

function average(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((total, value) => total + value, 0) / values.length
}

function percentile(values: number[], percentileValue: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1),
  )
  return sorted[index] ?? null
}

function summarize(records: DiagnosticRecord[]): DiagnosticsSummary {
  const successes = records.filter((record) => record.event === "control.success")
  const failures = records.filter((record) => record.event === "control.failed")
  const requests = records.filter((record) => record.event === "control.request")
  const successDurations = successes
    .map((record) => record.durationMs)
    .filter((value): value is number => typeof value === "number")
  const routeDurations = successes
    .map((record) => record.routeDurationMs)
    .filter((value): value is number => typeof value === "number")
  const completed = successes.length + failures.length
  return {
    generatedAt: new Date().toISOString(),
    recordCount: records.length,
    control: {
      requests: requests.length,
      successes: successes.length,
      failures: failures.length,
      successRate: completed ? (successes.length / completed) * 100 : null,
      averageDurationMs: average(successDurations),
      p95DurationMs: percentile(successDurations, 0.95),
      averageRouteDurationMs: average(routeDurations),
      reusedPreviews: successes.filter((record) => record.reusedPreview === true).length,
      routeFailures: records.filter((record) => record.event === "control.route_failed").length,
      readbackMismatches: records.filter((record) => record.event === "control.readback_mismatch").length,
    },
  }
}

export class DiagnosticsController {
  constructor(
    private readonly logger: LocalLogger,
    private readonly monitor: MonitorController,
    private readonly lan: LanController,
  ) {}

  async report(): Promise<DiagnosticsReport> {
    const records = await this.logger.readRecent(200)
    return {
      summary: summarize(records),
      records,
      connection: this.monitor.connectionSnapshot(),
      status: this.monitor.statusSnapshot(),
      lanDevices: this.lan.devices(),
      system: {
        appVersion: app.getVersion(),
        platform: process.platform,
        electronVersion: process.versions.electron,
      },
      logPath: this.logger.path,
    }
  }
}
