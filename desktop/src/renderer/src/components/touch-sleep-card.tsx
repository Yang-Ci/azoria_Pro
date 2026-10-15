import { useCallback, useEffect, useId, useState } from "react"
import { CalendarDays, Clock3, MoonStar, RotateCw } from "lucide-react"
import type { TouchRotationSettings, TouchSleepSettings, TouchSleepUpdate } from "../../../shared/contracts"
import { allSleepWeekdays, isTouchSleepActive, isTouchSleepPaused, localSleepDate, sleepDayLabels, sleepResumeDate, sleepWeekdays, sleepWeekdaysText, sleepWeekend } from "../../../shared/touch-sleep"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

const defaults: TouchSleepSettings = {
  enabled: false,
  startMinutes: 23 * 60,
  endMinutes: 7 * 60,
  weekdays: [...allSleepWeekdays],
  resumeDate: null,
  active: false,
}

const defaultRotation: TouchRotationSettings = { degrees: 0 }

function timeValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

function parseTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60
    ? hours * 60 + minutes
    : null
}

export function TouchSleepCard({ onMessage, showRotation = true }: { onMessage(message: string): void; showRotation?: boolean }) {
  const id = useId()
  const [settings, setSettings] = useState(defaults)
  const [rotation, setRotation] = useState(defaultRotation)
  const [start, setStart] = useState(timeValue(defaults.startMinutes))
  const [end, setEnd] = useState(timeValue(defaults.endMinutes))
  const [days, setDays] = useState(defaults.weekdays)
  const [holiday, setHoliday] = useState(false)
  const [resumeDate, setResumeDate] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(async () => {
    try {
      const [nextSleep, nextRotation] = await Promise.all([
        window.azoria.touchSleep.settings(),
        showRotation ? window.azoria.touchRotation.settings() : Promise.resolve(defaultRotation),
      ])
      setSettings({ ...nextSleep, weekdays: nextSleep.weekdays ?? [...allSleepWeekdays], resumeDate: nextSleep.resumeDate ?? null })
      setStart(timeValue(nextSleep.startMinutes))
      setEnd(timeValue(nextSleep.endMinutes))
      setDays(nextSleep.weekdays ?? [...allSleepWeekdays])
      setHoliday(Boolean(nextSleep.resumeDate))
      setResumeDate(nextSleep.resumeDate ?? "")
      setRotation(nextRotation)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Touch 设置读取失败")
    } finally {
      setLoading(false)
    }
  }, [onMessage, showRotation])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  const update = async (enabled: boolean) => {
    const startMinutes = parseTime(start)
    const endMinutes = parseTime(end)
    if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
      onMessage("息屏开始和结束时间必须不同")
      return
    }
    if (!days.length) { onMessage("请至少选择一个执行日期"); return }
    const requestDate = holiday && (resumeDate !== settings.resumeDate || isTouchSleepPaused(settings)) ? resumeDate : null
    if (requestDate !== null && (!sleepResumeDate(requestDate) || sleepResumeDate(requestDate)! <= new Date())) {
      onMessage("恢复日期请选择明天或以后的日期")
      return
    }
    const input: TouchSleepUpdate = { enabled, startMinutes, endMinutes, weekdays: days, resumeDate: requestDate }
    setSaving(true)
    try {
      const next = await window.azoria.touchSleep.update(input)
      setSettings(next)
      setStart(timeValue(next.startMinutes))
      setEnd(timeValue(next.endMinutes))
      setDays(next.weekdays)
      setHoliday(Boolean(next.resumeDate))
      setResumeDate(next.resumeDate ?? "")
      setNow(new Date())
      onMessage(enabled ? "定时息屏计划已保存" : "定时息屏已关闭，计划已保存")
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Touch 息屏设置保存失败")
    } finally {
      setSaving(false)
    }
  }

  const rotateClockwise = async () => {
    setRotating(true)
    try {
      const next = await window.azoria.touchRotation.rotateClockwise()
      setRotation(next)
      onMessage(`Touch 屏幕方向已保存为 ${next.degrees}°，连接后自动同步`)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Touch 旋转设置保存失败")
    } finally {
      setRotating(false)
    }
  }

  const active = isTouchSleepActive(settings, now)
  const paused = settings.enabled && isTouchSleepPaused(settings, now)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const blocked = loading || saving
  const resume = sleepResumeDate(resumeDate)
  const selectedResumeDate = holiday && (resumeDate !== settings.resumeDate || isTouchSleepPaused(settings, now)) ? resumeDate : null
  const invalidHoliday = selectedResumeDate !== null && (!resume || resume <= now)
  const dirty = start !== timeValue(settings.startMinutes) || end !== timeValue(settings.endMinutes) ||
    [...days].sort().join() !== [...settings.weekdays].sort().join() ||
    selectedResumeDate !== (isTouchSleepPaused(settings, now) ? settings.resumeDate : null)
  const invalid = !days.length || parseTime(start) === null || parseTime(end) === null || start === end ||
    invalidHoliday
  const toggleDay = (day: number) => setDays(current => current.includes(day) ? current.filter(value => value !== day) : [...current, day])

  return <Card>
    <CardHeader className="flex flex-row items-start justify-between space-y-0">
      <div>
        <CardTitle className="flex items-center gap-2"><MoonStar />{showRotation ? "Touch 设置" : "定时息屏计划"}</CardTitle>
        <CardDescription>{showRotation ? "调整屏幕方向，按星期安排息屏，放假时可暂停计划。" : "Touch 按此计划息屏；外接屏需开启上方的定时联动。"}</CardDescription>
      </div>
      <Badge variant="outline" className="shrink-0 border-white/10">
        <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-amber-400" : active ? "bg-blue-400" : "bg-zinc-600"}`} />
        {!settings.enabled ? "未启用" : paused ? "假期暂停" : active ? "当前息屏" : "当前亮屏"}
      </Badge>
    </CardHeader>
    <CardContent className="space-y-5">
      {showRotation && <div className="flex items-center justify-between gap-4 rounded-lg border border-white/10 p-4">
        <div>
          <p className="text-sm font-medium leading-none">屏幕方向</p>
          <p className="mt-1 text-sm text-zinc-500">当前顺时针旋转 {rotation.degrees}°，画面与触摸坐标会一起调整。</p>
        </div>
        <Button variant="outline" disabled={loading || rotating} onClick={() => void rotateClockwise()}>
          <RotateCw />{rotating ? "正在保存…" : "旋转 90°"}
        </Button>
      </div>}
      <div className="flex items-center justify-between rounded-lg border border-white/10 p-4">
        <div>
          <Label htmlFor={`${id}-enabled`}>启用定时息屏</Label>
          <p className="mt-1 text-sm text-zinc-500">在选中的日期开始息屏，结束后自动恢复。</p>
        </div>
        <Switch id={`${id}-enabled`} checked={settings.enabled} disabled={loading || saving} onCheckedChange={(checked) => void update(checked)} />
      </div>
      <fieldset disabled={blocked} className="space-y-3">
        <legend className="mb-3 text-sm font-medium">重复日期</legend>
        <div className="flex flex-wrap gap-2">
          {[{ label: "每天", value: allSleepWeekdays }, { label: "周一至周五", value: sleepWeekdays }, { label: "周末", value: sleepWeekend }].map(preset =>
            <Button key={preset.label} type="button" size="sm" variant="outline" aria-pressed={[...days].sort().join() === preset.value.join()} onClick={() => setDays([...preset.value])}>{preset.label}</Button>)}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {[1, 2, 3, 4, 5, 6, 0].map(day => <Button key={day} type="button" variant={days.includes(day) ? "default" : "outline"} aria-label={`星期${["日", "一", "二", "三", "四", "五", "六"][day]}`} aria-pressed={days.includes(day)} className="h-11 px-0" onClick={() => toggleDay(day)}>{sleepDayLabels[day]}</Button>)}
        </div>
        {!days.length && <p role="alert" className="text-sm text-red-400">请至少选择一天。</p>}
        <p className="text-xs leading-relaxed text-zinc-500">跨午夜按开始日期计算，例如选周五，23:00 开始后持续至周六 07:00。星期选择不会自动匹配法定节假日或调休。</p>
      </fieldset>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor={`${id}-start`}>开始时间</Label>
          <input id={`${id}-start`} type="time" value={start} disabled={loading || saving} onChange={(event) => setStart(event.target.value)} className="h-10 w-full rounded-md border border-white/10 bg-black px-3 text-sm outline-none focus:border-white/30" />
        </div>
        <span className="pb-2 text-sm text-zinc-600">至</span>
        <div className="space-y-2">
          <Label htmlFor={`${id}-end`}>结束时间</Label>
          <input id={`${id}-end`} type="time" value={end} disabled={loading || saving} onChange={(event) => setEnd(event.target.value)} className="h-10 w-full rounded-md border border-white/10 bg-black px-3 text-sm outline-none focus:border-white/30" />
        </div>
      </div>
      {(start === end || parseTime(start) === null || parseTime(end) === null) && <p role="alert" className="text-sm text-red-400">请选择不同的有效开始和结束时间。</p>}
      <div className="space-y-4 rounded-lg border border-white/10 p-4">
        <div className="flex items-center justify-between gap-4">
          <div><Label htmlFor={`${id}-holiday`} className="flex items-center gap-2"><CalendarDays className="size-4" />假期暂停</Label><p className="mt-1 text-sm text-zinc-500">暂停自动息屏，到期恢复原计划；手动控制仍然可用。</p></div>
          <Switch id={`${id}-holiday`} checked={selectedResumeDate !== null} disabled={blocked} onCheckedChange={checked => { setHoliday(checked); if (checked && (!resume || resume <= now)) setResumeDate(localSleepDate(tomorrow)) }} />
        </div>
        {selectedResumeDate !== null && <div className="space-y-2">
          <Label htmlFor={`${id}-resume`}>恢复日期</Label>
          <input id={`${id}-resume`} type="date" value={resumeDate} min={localSleepDate(tomorrow)} max="2099-12-31" disabled={blocked} aria-invalid={invalidHoliday} onChange={event => setResumeDate(event.target.value)} className="h-10 w-full rounded-md border border-white/10 bg-black px-3 text-sm outline-none focus:border-white/30" />
          {invalidHoliday && <p role="alert" className="text-sm text-red-400">恢复日期请选择明天或以后的日期。</p>}
          <p className="text-xs text-zinc-500">恢复日期当天 00:00 起自动恢复。关闭假期暂停并保存，可提前恢复。</p>
        </div>}
      </div>
      <div className="space-y-2 rounded-lg bg-white/[0.03] p-3 text-sm text-zinc-400">
        <p>{sleepWeekdaysText(settings.weekdays)} · {timeValue(settings.startMinutes)} 至{settings.startMinutes > settings.endMinutes ? "次日 " : " "}{timeValue(settings.endMinutes)}</p>
        {paused && <p className="text-amber-300">假期暂停中，{settings.resumeDate} 00:00 恢复。</p>}
        {dirty && <p role="status" className="text-amber-300">更改尚未保存</p>}
      </div>
      <Button variant="outline" className="w-full" disabled={blocked || invalid} onClick={() => void update(settings.enabled)}>
        <Clock3 />{saving ? "正在保存…" : "保存息屏计划"}
      </Button>
    </CardContent>
  </Card>
}
