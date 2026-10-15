import type { TouchSleepUpdate } from "./contracts"

export const allSleepWeekdays = [0, 1, 2, 3, 4, 5, 6]
export const sleepWeekdays = [1, 2, 3, 4, 5]
export const sleepWeekend = [0, 6]
export const sleepDayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]

export function validSleepWeekdays(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 7 &&
    value.every(day => Number.isInteger(day) && day >= 0 && day <= 6) && new Set(value).size === value.length
}

export function localSleepDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function sleepResumeDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  if (year! < 2000 || year! > 2099) return null
  const date = new Date(year!, month! - 1, day!)
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day ? date : null
}

export function isTouchSleepPaused(settings: Pick<TouchSleepUpdate, "resumeDate">, now = new Date()): boolean {
  const resume = sleepResumeDate(settings.resumeDate)
  return resume !== null && now < resume
}

// A cross-midnight interval belongs to the date on which it starts.
export function touchSleepDayEnabled(settings: TouchSleepUpdate, now = new Date()): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes()
  const previousDay = settings.startMinutes > settings.endMinutes && minutes < settings.endMinutes
  return (settings.weekdays ?? allSleepWeekdays).includes((now.getDay() + (previousDay ? 6 : 0)) % 7)
}

export function isTouchSleepActive(settings: TouchSleepUpdate, now = new Date()): boolean {
  if (!settings.enabled || settings.startMinutes === settings.endMinutes ||
      isTouchSleepPaused(settings, now) || !touchSleepDayEnabled(settings, now)) return false
  const minutes = now.getHours() * 60 + now.getMinutes()
  return settings.startMinutes < settings.endMinutes
    ? minutes >= settings.startMinutes && minutes < settings.endMinutes
    : minutes >= settings.startMinutes || minutes < settings.endMinutes
}

// Existing Touch firmware evaluates the time window locally. Gate its enable
// flag by the scheduled day and holiday pause, so it honors the new plan too.
export function touchSleepDeviceEnabled(settings: TouchSleepUpdate, now = new Date()): boolean {
  return settings.enabled && !isTouchSleepPaused(settings, now) && touchSleepDayEnabled(settings, now)
}

export function sleepWeekdaysText(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  const same = (target: number[]) => sorted.length === target.length && sorted.every((day, index) => day === target[index])
  if (same(allSleepWeekdays)) return "每天"
  if (same(sleepWeekdays)) return "周一至周五"
  if (same(sleepWeekend)) return "周六、周日"
  return [1, 2, 3, 4, 5, 6, 0].filter(day => days.includes(day)).map(day => sleepDayLabels[day]).join("、")
}
