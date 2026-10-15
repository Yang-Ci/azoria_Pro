import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TouchSleepSettings, TouchSleepUpdate } from "../shared/contracts"
import { allSleepWeekdays, isTouchSleepActive, sleepResumeDate, validSleepWeekdays } from "../shared/touch-sleep"

export { isTouchSleepActive } from "../shared/touch-sleep"

const defaultSettings: TouchSleepUpdate = {
  enabled: false,
  startMinutes: 23 * 60,
  endMinutes: 7 * 60,
  weekdays: [...allSleepWeekdays],
  resumeDate: null,
}

function validMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 24 * 60
}

export class TouchSleepManager {
  private readonly settingsPath: string
  private current: TouchSleepUpdate = { ...defaultSettings }

  constructor(private readonly directory: string) {
    this.settingsPath = path.join(directory, "touch-sleep.json")
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.settingsPath, "utf8")) as Partial<TouchSleepUpdate>
      if (typeof parsed.enabled !== "boolean" || !validMinutes(parsed.startMinutes) ||
          !validMinutes(parsed.endMinutes) || parsed.startMinutes === parsed.endMinutes) {
        throw new Error("Touch 息屏设置无效")
      }
      this.current = {
        enabled: parsed.enabled,
        startMinutes: parsed.startMinutes,
        endMinutes: parsed.endMinutes,
        weekdays: parsed.weekdays === undefined ? [...allSleepWeekdays] : this.validateWeekdays(parsed.weekdays),
        resumeDate: this.validateResumeDate(parsed.resumeDate ?? null),
      }
    } catch {
      this.current = { ...defaultSettings }
    }
  }

  settings(now = new Date()): TouchSleepSettings {
    const resume = sleepResumeDate(this.current.resumeDate)
    return { ...this.current, weekdays: [...this.current.weekdays],
      resumeDate: resume && resume > now ? this.current.resumeDate : null,
      active: isTouchSleepActive(this.current, now) }
  }

  private validateWeekdays(value: unknown): number[] {
    if (!validSleepWeekdays(value)) throw new Error("请至少选择一天，星期不能重复")
    return [...value].sort((a, b) => a - b)
  }

  private validateResumeDate(value: unknown): string | null {
    if (value !== null && !sleepResumeDate(value)) throw new Error("假期恢复日期无效")
    return value as string | null
  }

  async update(input: TouchSleepUpdate, now = new Date()): Promise<TouchSleepSettings> {
    if (!input || typeof input.enabled !== "boolean" || !validMinutes(input.startMinutes) ||
        !validMinutes(input.endMinutes) || input.startMinutes === input.endMinutes) {
      throw new Error("开始和结束时间必须是不同的有效时间")
    }
    const next: TouchSleepUpdate = {
      enabled: input.enabled,
      startMinutes: input.startMinutes,
      endMinutes: input.endMinutes,
      weekdays: this.validateWeekdays(input.weekdays === undefined ? this.current.weekdays : input.weekdays),
      resumeDate: this.validateResumeDate(input.resumeDate === undefined ? this.current.resumeDate : input.resumeDate),
    }
    if (next.resumeDate && next.resumeDate !== this.current.resumeDate && sleepResumeDate(next.resumeDate)! <= now) {
      throw new Error("恢复日期请选择明天或以后的日期")
    }
    const temporaryPath = `${this.settingsPath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(next, null, 2), { mode: 0o600 })
    await rename(temporaryPath, this.settingsPath)
    this.current = next
    return this.settings(now)
  }
}
