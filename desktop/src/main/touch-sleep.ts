import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TouchSleepSettings, TouchSleepUpdate } from "../shared/contracts"

const defaultSettings: TouchSleepUpdate = {
  enabled: false,
  startMinutes: 23 * 60,
  endMinutes: 7 * 60,
}

function validMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 24 * 60
}

export function isTouchSleepActive(settings: TouchSleepUpdate, now = new Date()): boolean {
  if (!settings.enabled || settings.startMinutes === settings.endMinutes) return false
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  return settings.startMinutes < settings.endMinutes
    ? currentMinutes >= settings.startMinutes && currentMinutes < settings.endMinutes
    : currentMinutes >= settings.startMinutes || currentMinutes < settings.endMinutes
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
      }
    } catch {
      this.current = { ...defaultSettings }
    }
  }

  settings(now = new Date()): TouchSleepSettings {
    return { ...this.current, active: isTouchSleepActive(this.current, now) }
  }

  async update(input: TouchSleepUpdate): Promise<TouchSleepSettings> {
    if (!input || typeof input.enabled !== "boolean" || !validMinutes(input.startMinutes) ||
        !validMinutes(input.endMinutes) || input.startMinutes === input.endMinutes) {
      throw new Error("开始和结束时间必须是不同的有效时间")
    }
    const next: TouchSleepUpdate = {
      enabled: input.enabled,
      startMinutes: input.startMinutes,
      endMinutes: input.endMinutes,
    }
    const temporaryPath = `${this.settingsPath}.tmp`
    await writeFile(temporaryPath, JSON.stringify(next, null, 2), { mode: 0o600 })
    await rename(temporaryPath, this.settingsPath)
    this.current = next
    return this.settings()
  }
}
