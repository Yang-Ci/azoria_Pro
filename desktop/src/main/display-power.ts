import { readFile } from "node:fs/promises"
import path from "node:path"
import type { DisplaySchedule, DisplayScheduleUpdate, ExternalPowerAction, ExternalPowerState, TouchBacklightState } from "../shared/contracts"
import { latestDisplayEndToday, defaultDisplaySchedule, displayScheduleOn, displaySchedulePaused, nextDisplayChange, nextDisplayWake, updateDisplaySchedule, validateDisplaySchedule } from "../shared/display-schedule"
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
  schedule: DisplaySchedule
  manualOverride: { on: boolean; until: number | null } | null
  offSince: number | null
  automaticOffCheck: { periodEnd: number; at: number } | null
}
const defaults: SavedPower = { linked: false, off: false, reason: null, layout: null, targets: [], wakeUntil: 0, schedule: defaultDisplaySchedule(), manualOverride: null, offSince: null, automaticOffCheck: null }

export class DisplayPowerManager {
  private readonly filename: string
  private state: SavedPower = { ...defaults, targets: [] }
  private supported = false
  private layout?: DisplayLayout
  private busy = false
  private error: string | null = null
  private deferredUntil: number | null = null
  private activityAvailable: boolean | null = null
  private timer?: NodeJS.Timeout
  private stopWatching?: () => void
  private topologySync?: Promise<ExternalPowerState>
  private queue: Promise<unknown> = Promise.resolve()
  constructor(directory: string, private readonly sleep: TouchSleepManager, private readonly monitor: MonitorController,
    private readonly backend: DisplayPowerBackend = new GnomeDisplayPowerBackend(),
    private readonly idleSeconds: () => Promise<number | null> = async () => null) { this.filename = path.join(directory, "external-display-power.json") }
  async initialize(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.filename, "utf8")) as SavedPower
      if (typeof data.linked !== "boolean" || typeof data.off !== "boolean" || !Array.isArray(data.targets) || data.off && !data.layout) throw new Error("invalid power settings")
      if (data.manualOverride && (typeof data.manualOverride.on !== "boolean" || data.manualOverride.until !== null && !Number.isFinite(data.manualOverride.until))) throw new Error("invalid manual override")
      if (data.automaticOffCheck && (!Number.isFinite(data.automaticOffCheck.periodEnd) || !Number.isFinite(data.automaticOffCheck.at) || data.automaticOffCheck.at < data.automaticOffCheck.periodEnd)) throw new Error("invalid automatic off check")
      this.state = { ...defaults, ...data, schedule: data.schedule ? validateDisplaySchedule(data.schedule) : defaultDisplaySchedule() }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.error = "外接屏恢复配置读取失败，原文件已保留" }
    this.monitor.setExternalPowerOff?.(this.state.off)
    let capturedLayout: DisplayLayout | undefined
    try { this.layout = await this.backend.capture(); this.supported = true; capturedLayout = this.layout } catch { this.error = "当前桌面不支持外接屏独立息屏" }
    await this.syncNow(new Date(), capturedLayout).catch(() => undefined)
  }
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.sync().catch(() => undefined) }, 10000)
    this.stopWatching = this.backend.watchChanges?.(() => {
      if (!this.state.off || this.topologySync) return
      this.topologySync = this.sync()
      void this.topologySync.catch(() => undefined).finally(() => { this.topologySync = undefined })
    })
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.stopWatching?.(); this.stopWatching = undefined
  }
  snapshot(now = new Date()): ExternalPowerState {
    const layout = this.state.off ? this.state.layout : this.layout
    return { supported: this.supported, off: this.state.off, linked: this.state.linked,
      externalCount: layout?.monitors.filter(item => !item.builtin).length || 0,
      internalAvailable: Boolean(layout?.monitors.some(item => item.builtin)),
      scheduleActive: this.state.schedule.enabled ? !displaySchedulePaused(this.state.schedule, now) && !displayScheduleOn(this.state.schedule, now) : this.sleep.settings(now).active,
      schedule: structuredClone(this.state.schedule), plannedOn: displayScheduleOn(this.state.schedule, now),
      nextChangeAt: !this.state.schedule.enabled ? null : displaySchedulePaused(this.state.schedule, now)
        ? new Date(`${this.state.schedule.resumeDate}T00:00:00`).toISOString() : nextDisplayChange(this.state.schedule, now)?.toISOString() ?? null,
      override: this.state.manualOverride ? { ...this.state.manualOverride } : null,
      deferredUntil: this.deferredUntil === null ? null : new Date(this.deferredUntil).toISOString(), activityAvailable: this.activityAvailable, activityLookbackSeconds: 60,
      touchBacklight: this.touchBacklight(now),
      busy: this.busy, error: this.error }
  }
  private touchBacklight(now: Date): TouchBacklightState | undefined {
    const plan = this.state.schedule
    if (!plan.enabled || !plan.touchFollow) return undefined
    const wake = displaySchedulePaused(plan, now) ? null : nextDisplayWake(plan, now)
    const override = this.state.manualOverride
    const canWake = !override || override.on || override.until !== null && wake !== null && override.until <= +wake
    const wakeAt = wake && canWake ? +wake - (plan.touchWakeLeadMinutes ?? 10) * 60000 : null
    const sleepAt = this.state.off && this.state.offSince !== null ? this.state.offSince + (plan.touchSleepDelayMinutes ?? 10) * 60000 : null
    const scheduledWakePending = !displaySchedulePaused(plan, now) && displayScheduleOn(plan, now) &&
      (!override || override.on || override.until !== null && override.until <= +now)
    const awake = !this.state.off || scheduledWakePending || sleepAt !== null && +now < sleepAt || wakeAt !== null && +now >= wakeAt
    return { awake, sleepAt: sleepAt === null ? null : new Date(sleepAt).toISOString(), wakeAt: wakeAt === null ? null : new Date(wakeAt).toISOString() }
  }
  touchStatus() {
    const state = this.snapshot()
    return { externalPowerSupported: state.supported, externalScreensOff: state.off, externalScreenCount: state.externalCount,
      externalPowerLinked: state.linked, externalPowerBusy: state.busy }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work); this.queue = next.catch(() => undefined); return next
  }
  private async store(next: SavedPower): Promise<void> {
    await writeAtomicJson(this.filename, next)
    this.state = next
    this.monitor.setExternalPowerOff?.(next.off)
  }
  private async maintainOff(current?: DisplayLayout): Promise<void> {
    if (!this.supported || !this.state.layout) return
    const actual = current ?? await this.backend.capture()
    const active = new Set(actual.groups.flatMap(group => group.monitors.map(monitor => monitor.connector)))
    const internalActive = actual.monitors.some(monitor => monitor.builtin && active.has(monitor.connector))
    const externalActive = actual.monitors.some(monitor => !monitor.builtin && active.has(monitor.connector))
    if (internalActive && !externalActive) return
    // Hotplug and desktop reconfiguration can re-enable outputs without a restore
    // command. Keep the original recovery layout and only reapply OS isolation.
    await this.monitor.coordinateBrightness(() => this.backend.isolate(this.state.layout!))
  }
  private async off(reason: "manual" | "schedule", now = new Date()): Promise<void> {
    if (this.state.off) {
      if (reason === "manual" && this.state.reason !== "manual") await this.store({ ...this.state, reason })
      await this.maintainOff()
      return
    }
    if (!this.supported) throw new Error("当前桌面不支持外接屏独立息屏")
    const layout = await this.backend.capture()
    if (!layout.monitors.some(item => item.builtin)) throw new Error("没有可用的笔记本内屏，不能关闭全部外接屏")
    if (!layout.monitors.some(item => !item.builtin)) throw new Error("没有已连接的外接屏")
    const targets = await this.monitor.displayPowerTargets()
    const previous = this.state
    await this.store({ ...this.state, off: true, reason, layout, targets, wakeUntil: 0, offSince: now.getTime(), automaticOffCheck: null })
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
    await this.store({ ...this.state, off: false, reason: null, layout: null, targets: [], wakeUntil, offSince: null })
  }
  private async syncNow(now: Date, capturedLayout?: DisplayLayout): Promise<void> {
    this.deferredUntil = null
    this.activityAvailable = null
    if (!this.state.off && this.supported) this.layout = capturedLayout ?? await this.backend.capture()
    if (this.state.manualOverride && this.state.manualOverride.until !== null && this.state.manualOverride.until <= now.getTime()) {
      await this.store({ ...this.state, manualOverride: null })
    }
    const plan = this.state.schedule
    const periodEnd = latestDisplayEndToday(plan, now)
    const checkActivity = plan.enabled && !displaySchedulePaused(plan, now) && !displayScheduleOn(plan, now) &&
      !this.state.off && !this.state.manualOverride && (plan.activityDelayMinutes ?? 0) > 0 && periodEnd !== null
    if (this.state.automaticOffCheck && (!checkActivity || this.state.automaticOffCheck.periodEnd !== periodEnd)) {
      await this.store({ ...this.state, automaticOffCheck: null })
    }
    if (this.state.schedule.enabled && !displaySchedulePaused(this.state.schedule, now)) {
      const wanted = this.state.manualOverride?.on ?? displayScheduleOn(this.state.schedule, now)
      if (checkActivity) {
        const pending = this.state.automaticOffCheck
        // Only check at the deadline. Input (or inactivity) between deadlines
        // cannot move the next decision forward or backward.
        if (pending && +now < pending.at) {
          this.deferredUntil = pending.at
          return
        }
        const idle = await this.idleSeconds().catch(() => null)
        const delay = this.state.schedule.activityDelayMinutes! * 60000
        this.activityAvailable = idle !== null && Number.isFinite(idle) && idle >= 0
        if (!this.activityAvailable) return
        if (idle! < 60) {
          const at = +now + delay
          await this.store({ ...this.state, automaticOffCheck: { periodEnd: periodEnd!, at } })
          this.deferredUntil = at
          return
        }
      }
      if (!wanted) await this.off(this.state.manualOverride ? "manual" : "schedule", now)
      else if (this.state.off) await this.on(false, now)
      return
    }
    if (this.state.schedule.enabled && this.state.manualOverride) {
      if (!this.state.manualOverride.on) await this.off("manual", now)
      else if (this.state.off) await this.on(false, now)
      return
    }
    const active = this.sleep.settings(now).active
    if (this.state.linked && active && now.getTime() >= this.state.wakeUntil) await this.off("schedule", now)
    else if (this.state.off && this.state.reason === "schedule" && (!active || !this.state.linked)) await this.on(false, now)
    else if (this.state.off) await this.maintainOff(capturedLayout)
  }
  sync(now = new Date()): Promise<ExternalPowerState> { return this.perform(() => this.syncNow(now), now) }
  control(action: ExternalPowerAction, now = new Date(), holdMinutes = 0): Promise<ExternalPowerState> {
    if (!["off", "on", "link-on", "link-off", "auto"].includes(action) || !Number.isInteger(holdMinutes) || holdMinutes < -1 || holdMinutes > 10080) return Promise.reject(new Error("外接屏电源命令无效"))
    return this.perform(async () => {
      if (action === "off" || action === "on") {
        this.deferredUntil = null
        this.activityAvailable = null
        if (action === "off") await this.off("manual", now)
        else await this.on(true, now)
        if (this.state.schedule.enabled) {
          const plan = this.state.schedule
          const automaticHold = action === "on" && !displayScheduleOn(plan, now) && (plan.activityDelayMinutes ?? 0) > 0
            ? +now + plan.activityDelayMinutes! * 60000 : nextDisplayChange(plan, now)?.getTime() ?? null
          const until = holdMinutes === -1 ? null : holdMinutes > 0 ? now.getTime() + holdMinutes * 60000 : automaticHold
          await this.store({ ...this.state, manualOverride: { on: action === "on", until }, automaticOffCheck: null })
        }
      } else if (action === "auto") {
        await this.store({ ...this.state, manualOverride: null, wakeUntil: 0, automaticOffCheck: null })
        await this.syncNow(now)
      } else {
        await this.store({ ...this.state, linked: action === "link-on", wakeUntil: 0, manualOverride: null, automaticOffCheck: null,
          schedule: action === "link-on" ? { ...this.state.schedule, enabled: false, revision: this.state.schedule.revision + 1 } : this.state.schedule })
        await this.syncNow(now)
      }
    }, now)
  }
  updateSchedule(input: DisplayScheduleUpdate, now = new Date()): Promise<ExternalPowerState> {
    return this.perform(async () => {
      const schedule = updateDisplaySchedule(this.state.schedule, input, now)
      await this.store({ ...this.state, schedule, linked: schedule.enabled ? false : this.state.linked,
        manualOverride: null, wakeUntil: 0, automaticOffCheck: null })
      try { await this.syncNow(now) }
      catch (error) { throw new Error(`计划已保存，但应用屏幕状态失败：${error instanceof Error ? error.message : "请重试"}`) }
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
