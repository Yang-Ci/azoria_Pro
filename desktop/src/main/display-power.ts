import { readFile } from "node:fs/promises"
import path from "node:path"
import type { ExternalPowerAction, ExternalPowerState } from "../shared/contracts"
import { writeAtomicJson } from "./atomic-json"
import { GnomeDisplayPowerBackend, type DisplayLayout, type DisplayPowerBackend } from "./external-displays"
import type { TouchSleepManager } from "./touch-sleep"
import type { MonitorController, DisplayPowerTarget } from "./monitor"

interface SavedPower {
  linked: boolean
  off: boolean
  reason: "manual" | "schedule" | null
  layout: DisplayLayout | null
  targets: DisplayPowerTarget[]
  wakeUntil: number
}
const defaults: SavedPower = { linked: false, off: false, reason: null, layout: null, targets: [], wakeUntil: 0 }

export class DisplayPowerManager {
  private readonly filename: string
  private state: SavedPower = { ...defaults, targets: [] }
  private supported = false
  private layout?: DisplayLayout
  private busy = false
  private error: string | null = null
  private timer?: NodeJS.Timeout
  private queue: Promise<unknown> = Promise.resolve()
  constructor(directory: string, private readonly sleep: TouchSleepManager, private readonly monitor: MonitorController,
    private readonly backend: DisplayPowerBackend = new GnomeDisplayPowerBackend()) { this.filename = path.join(directory, "external-display-power.json") }
  async initialize(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.filename, "utf8")) as SavedPower
      if (typeof data.linked !== "boolean" || typeof data.off !== "boolean" || !Array.isArray(data.targets) || data.off && !data.layout) throw new Error("invalid power settings")
      this.state = { ...defaults, ...data }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.error = "外接屏恢复配置读取失败，原文件已保留" }
    let capturedLayout: DisplayLayout | undefined
    try { this.layout = await this.backend.capture(); this.supported = true; capturedLayout = this.layout } catch { this.error = "当前桌面不支持外接屏独立息屏" }
    await this.syncNow(new Date(), capturedLayout).catch(() => undefined)
  }
  start(): void { this.timer ??= setInterval(() => { void this.sync().catch(() => undefined) }, 10000) }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined }
  snapshot(now = new Date()): ExternalPowerState {
    const layout = this.state.off ? this.state.layout : this.layout
    return { supported: this.supported, off: this.state.off, linked: this.state.linked,
      externalCount: layout?.monitors.filter(item => !item.builtin).length || 0,
      internalAvailable: Boolean(layout?.monitors.some(item => item.builtin)),
      scheduleActive: this.sleep.settings(now).active, busy: this.busy, error: this.error }
  }
  touchStatus() {
    const state = this.snapshot()
    return { externalPowerSupported: state.supported, externalScreensOff: state.off, externalScreenCount: state.externalCount,
      externalPowerLinked: state.linked, externalPowerBusy: state.busy }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work); this.queue = next.catch(() => undefined); return next
  }
  private async store(next: SavedPower): Promise<void> { await writeAtomicJson(this.filename, next); this.state = next }
  private async off(reason: "manual" | "schedule"): Promise<void> {
    if (this.state.off) {
      if (reason === "manual" && this.state.reason !== "manual") await this.store({ ...this.state, reason })
      return
    }
    if (!this.supported) throw new Error("当前桌面不支持外接屏独立息屏")
    const layout = await this.backend.capture()
    if (!layout.monitors.some(item => item.builtin)) throw new Error("没有可用的笔记本内屏，不能关闭全部外接屏")
    if (!layout.monitors.some(item => !item.builtin)) throw new Error("没有已连接的外接屏")
    const targets = await this.monitor.displayPowerTargets()
    const previous = this.state
    await this.store({ ...this.state, off: true, reason, layout, targets, wakeUntil: 0 })
    try {
      await this.monitor.coordinateBrightness(async () => {
        for (const target of targets) await this.monitor.setDisplayPower(target, target.offValue)
        await this.backend.isolate(layout)
      })
      this.layout = layout
    } catch (error) {
      const rollbackFailures: unknown[] = []
      for (const target of targets) await this.monitor.setDisplayPower(target, target.originalValue).catch(failure => { rollbackFailures.push(failure) })
      await this.backend.restore(layout).catch(failure => { rollbackFailures.push(failure) })
      if (!rollbackFailures.length) await this.store(previous)
      else throw new Error("息屏失败，部分屏幕尚未恢复；恢复布局已保留，请点击恢复外接屏重试")
      throw error
    }
  }
  private async on(manual: boolean, now: Date): Promise<void> {
    let wakeUntil = 0
    if (manual && this.sleep.settings(now).active) {
      const settings = this.sleep.settings(now); const end = new Date(now)
      end.setHours(Math.floor(settings.endMinutes / 60), settings.endMinutes % 60, 0, 0)
      if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1)
      wakeUntil = end.getTime()
    }
    if (this.state.off && this.state.layout) {
      await this.monitor.coordinateBrightness(async () => {
        const wakeFailures: unknown[] = []
        for (const target of this.state.targets) await this.monitor.setDisplayPower(target, target.originalValue).catch(error => { wakeFailures.push(error) })
        await this.backend.restore(this.state.layout!)
        if (wakeFailures.length) throw new Error("显示输出已恢复，部分屏幕未响应唤醒；恢复布局已保留，请重试")
      })
      this.layout = await this.backend.capture()
    }
    await this.store({ ...this.state, off: false, reason: null, layout: null, targets: [], wakeUntil })
  }
  private async syncNow(now: Date, capturedLayout?: DisplayLayout): Promise<void> {
    if (!this.state.off && this.supported) this.layout = capturedLayout ?? await this.backend.capture()
    const active = this.sleep.settings(now).active
    if (this.state.linked && active && now.getTime() >= this.state.wakeUntil) await this.off("schedule")
    else if (this.state.off && this.state.reason === "schedule" && (!active || !this.state.linked)) await this.on(false, now)
  }
  sync(now = new Date()): Promise<ExternalPowerState> { return this.perform(() => this.syncNow(now), now) }
  control(action: ExternalPowerAction, now = new Date()): Promise<ExternalPowerState> {
    if (!["off", "on", "link-on", "link-off"].includes(action)) return Promise.reject(new Error("外接屏电源命令无效"))
    return this.perform(async () => {
      if (action === "off") await this.off("manual")
      else if (action === "on") await this.on(true, now)
      else { await this.store({ ...this.state, linked: action === "link-on", wakeUntil: 0 }); await this.syncNow(now) }
    }, now)
  }
  private perform(work: () => Promise<void>, now: Date): Promise<ExternalPowerState> {
    return this.serial(async () => {
      this.busy = true; this.error = null
      try { await work(); return this.snapshot(now) }
      catch (error) { this.error = error instanceof Error ? error.message : "外接屏电源控制失败"; throw error }
      finally { this.busy = false }
    }).then(() => this.snapshot(now))
  }
}
