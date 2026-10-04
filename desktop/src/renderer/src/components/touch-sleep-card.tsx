import { useCallback, useEffect, useState } from "react"
import { Clock3, MoonStar, RotateCw } from "lucide-react"
import type { TouchRotationSettings, TouchSleepSettings, TouchSleepUpdate } from "../../../shared/contracts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

const defaults: TouchSleepSettings = {
  enabled: false,
  startMinutes: 23 * 60,
  endMinutes: 7 * 60,
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

function activeNow(settings: TouchSleepSettings, now: Date): boolean {
  if (!settings.enabled || settings.startMinutes === settings.endMinutes) return false
  const current = now.getHours() * 60 + now.getMinutes()
  return settings.startMinutes < settings.endMinutes
    ? current >= settings.startMinutes && current < settings.endMinutes
    : current >= settings.startMinutes || current < settings.endMinutes
}

export function TouchSleepCard({ onMessage }: { onMessage(message: string): void }) {
  const [settings, setSettings] = useState(defaults)
  const [rotation, setRotation] = useState(defaultRotation)
  const [start, setStart] = useState(timeValue(defaults.startMinutes))
  const [end, setEnd] = useState(timeValue(defaults.endMinutes))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(async () => {
    try {
      const [nextSleep, nextRotation] = await Promise.all([
        window.azoria.touchSleep.settings(),
        window.azoria.touchRotation.settings(),
      ])
      setSettings(nextSleep)
      setStart(timeValue(nextSleep.startMinutes))
      setEnd(timeValue(nextSleep.endMinutes))
      setRotation(nextRotation)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Touch 设置读取失败")
    } finally {
      setLoading(false)
    }
  }, [onMessage])

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
    const input: TouchSleepUpdate = { enabled, startMinutes, endMinutes }
    setSaving(true)
    try {
      const next = await window.azoria.touchSleep.update(input)
      setSettings(next)
      setStart(timeValue(next.startMinutes))
      setEnd(timeValue(next.endMinutes))
      setNow(new Date())
      onMessage(enabled ? "Touch 定时息屏已开启" : "Touch 定时息屏已关闭")
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

  const active = activeNow(settings, now)

  return <Card>
    <CardHeader className="flex flex-row items-start justify-between space-y-0">
      <div>
        <CardTitle className="flex items-center gap-2"><MoonStar />Touch 设置</CardTitle>
        <CardDescription>调整屏幕方向，并设置自动息屏时间。</CardDescription>
      </div>
      <Badge variant="outline" className="border-white/10">
        <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-blue-400" : "bg-zinc-600"}`} />
        {active ? "当前息屏" : "当前亮屏"}
      </Badge>
    </CardHeader>
    <CardContent className="space-y-5">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-white/10 p-4">
        <div>
          <p className="text-sm font-medium leading-none">屏幕方向</p>
          <p className="mt-1 text-sm text-zinc-500">当前顺时针旋转 {rotation.degrees}°，画面与触摸坐标会一起调整。</p>
        </div>
        <Button variant="outline" disabled={loading || rotating} onClick={() => void rotateClockwise()}>
          <RotateCw />{rotating ? "正在保存…" : "旋转 90°"}
        </Button>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-white/10 p-4">
        <div>
          <Label htmlFor="touch-sleep-enabled">启用定时息屏</Label>
          <p className="mt-1 text-sm text-zinc-500">支持跨午夜，例如 23:00 至次日 07:00。</p>
        </div>
        <Switch id="touch-sleep-enabled" checked={settings.enabled} disabled={loading || saving} onCheckedChange={(checked) => void update(checked)} />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="touch-sleep-start">开始时间</Label>
          <input id="touch-sleep-start" type="time" value={start} disabled={loading || saving} onChange={(event) => setStart(event.target.value)} className="h-10 w-full rounded-md border border-white/10 bg-black px-3 text-sm outline-none focus:border-white/30" />
        </div>
        <span className="pb-2 text-sm text-zinc-600">至</span>
        <div className="space-y-2">
          <Label htmlFor="touch-sleep-end">结束时间</Label>
          <input id="touch-sleep-end" type="time" value={end} disabled={loading || saving} onChange={(event) => setEnd(event.target.value)} className="h-10 w-full rounded-md border border-white/10 bg-black px-3 text-sm outline-none focus:border-white/30" />
        </div>
      </div>
      <Button variant="outline" className="w-full" disabled={loading || saving} onClick={() => void update(settings.enabled)}>
        <Clock3 />{saving ? "正在保存…" : "保存时间段"}
      </Button>
    </CardContent>
  </Card>
}
