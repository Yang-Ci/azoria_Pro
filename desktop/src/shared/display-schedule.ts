import type { DisplaySchedule, DisplayScheduleUpdate, DisplayTimeRange } from "./contracts"
import { isTouchSleepPaused, sleepResumeDate } from "./touch-sleep"

export const maxDisplayPeriods = 8
export const officeDisplayWeek = (): DisplayTimeRange[][] => Array.from({ length: 7 }, (_, day) =>
  day > 0 && day < 6 ? [{ startMinutes: 530, endMinutes: 1090 }] : [])
export const defaultDisplaySchedule = (): DisplaySchedule => ({ revision: 0, enabled: false, week: officeDisplayWeek(), resumeDate: null })
export const displayTime = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
export function validateDisplayPeriods(value: unknown): DisplayTimeRange[] {
  if (!Array.isArray(value) || value.length > maxDisplayPeriods) throw new Error("每天最多设置 8 段亮屏时间")
  const periods = value.map(p => {
    if (!p || !Number.isInteger(p.startMinutes) || !Number.isInteger(p.endMinutes) ||
      p.startMinutes < 0 || p.endMinutes > 1440 || p.startMinutes >= p.endMinutes) throw new Error("亮屏时段无效，结束时间须晚于开始时间")
    return { startMinutes: p.startMinutes as number, endMinutes: p.endMinutes as number }
  }).sort((a, b) => a.startMinutes - b.startMinutes)
  if (periods.some((p, i) => i > 0 && p.startMinutes < periods[i - 1]!.endMinutes)) throw new Error("亮屏时段不能重叠")
  return periods
}
export function validateDisplaySchedule(input: DisplaySchedule): DisplaySchedule {
  if (!input || typeof input.enabled !== "boolean" || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
      !Array.isArray(input.week) || input.week.length !== 7 || input.resumeDate !== null && !sleepResumeDate(input.resumeDate)) throw new Error("外接屏计划无效")
  for (const value of [input.activityDelayMinutes ?? 0, input.touchWakeLeadMinutes ?? 10, input.touchSleepDelayMinutes ?? 10]) {
    if (!Number.isInteger(value) || value < 0 || value > 120) throw new Error("联动与延后时间须为 0–120 分钟")
  }
  if (input.touchFollow !== undefined && typeof input.touchFollow !== "boolean") throw new Error("Touch 联动开关无效")
  return { revision: input.revision, enabled: input.enabled, week: input.week.map(validateDisplayPeriods), resumeDate: input.resumeDate,
    activityDelayMinutes: input.activityDelayMinutes ?? 0, touchFollow: input.touchFollow ?? false,
    touchWakeLeadMinutes: input.touchWakeLeadMinutes ?? 10, touchSleepDelayMinutes: input.touchSleepDelayMinutes ?? 10 }
}
export function updateDisplaySchedule(current: DisplaySchedule, input: DisplayScheduleUpdate, now: Date): DisplaySchedule {
  if (!input || input.revision !== current.revision) throw new Error("计划已在其他设备修改，请重新读取后保存")
  let week = current.week.map(day => day.map(p => ({ ...p })))
  if (input.week !== undefined) week = input.week
  if (input.day !== undefined) {
    if (!Number.isInteger(input.day) || input.day < 0 || input.day > 6) throw new Error("星期无效")
    const days = input.copyTo ?? [input.day]
    if (!Array.isArray(days) || !days.length || days.length > 7 || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("复制日期无效")
    const periods = validateDisplayPeriods(input.periods)
    week = week.map((p, day) => days.includes(day) ? periods : p)
  }
  const next = validateDisplaySchedule({ revision: current.revision + 1, enabled: input.enabled ?? current.enabled,
    week, resumeDate: input.resumeDate === undefined ? current.resumeDate : input.resumeDate,
    activityDelayMinutes: input.activityDelayMinutes ?? current.activityDelayMinutes,
    touchFollow: input.touchFollow ?? current.touchFollow,
    touchWakeLeadMinutes: input.touchWakeLeadMinutes ?? current.touchWakeLeadMinutes,
    touchSleepDelayMinutes: input.touchSleepDelayMinutes ?? current.touchSleepDelayMinutes })
  if (next.resumeDate && next.resumeDate !== current.resumeDate && sleepResumeDate(next.resumeDate)! <= now) throw new Error("恢复日期请选择明天或以后的日期")
  return next
}

export function nextDisplayWake(plan: DisplaySchedule, now = new Date()): Date | null {
  const candidates: Date[] = []
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    for (const minute of plan.week[date.getDay()]!.map(p => p.startMinutes)) {
      const at = new Date(date); at.setMinutes(minute)
      if (at > now && !displayScheduleOn(plan, new Date(+at - 1))) candidates.push(at)
    }
  }
  return candidates.sort((a, b) => +a - +b)[0] ?? null
}

export function latestDisplayEndToday(plan: DisplaySchedule, now: Date): number | null {
  const ends = plan.week[now.getDay()]!.flatMap(p => {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, p.endMinutes)
    return +at <= +now && !displayScheduleOn(plan, at) ? [+at] : []
  })
  return ends.length ? Math.max(...ends) : null
}
export function displayScheduleOn(plan: DisplaySchedule, now = new Date()): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes()
  return plan.week[now.getDay()]!.some(p => minutes >= p.startMinutes && minutes < p.endMinutes)
}
export const displaySchedulePaused = (plan: DisplaySchedule, now = new Date()): boolean => isTouchSleepPaused(plan, now)
export function nextDisplayChange(plan: DisplaySchedule, now = new Date()): Date | null {
  const current = displayScheduleOn(plan, now)
  const candidates: Date[] = []
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    for (const minute of [0, ...plan.week[date.getDay()]!.flatMap(p => [p.startMinutes, p.endMinutes])]) {
      const at = new Date(date); at.setMinutes(minute)
      if (at > now) candidates.push(at)
    }
  }
  return candidates.sort((a, b) => +a - +b).find(at => displayScheduleOn(plan, at) !== current) ?? null
}
