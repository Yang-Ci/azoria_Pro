import { useEffect, useRef, useState } from "react"
import { Battery, Bluetooth, Zap } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TouchSleepCard } from "./touch-sleep-card"
import { DisplayScheduleCard } from "./display-schedule-card"
import type { ExternalPowerAction, ExternalPowerState, PowerData, PowerMode, DisplaySchedule } from "../../../shared/contracts"

const modeNames: Record<PowerMode, string> = { performance: "性能模式", balanced: "均衡模式", "power-saver": "节电模式", unknown: "未提供电源模式" }
const batteryNames: Record<PowerData["batteryStatus"], string> = { charging: "正在充电", discharging: "使用电池", full: "已充满", "no-battery": "未检测到电池", unknown: "电池状态未知" }
const emptyData: PowerData = { available: false, batteryLevel: null, batteryStatus: "unknown", devices: [], mode: "unknown", sampledAt: null, error: null }
const emptyPower: ExternalPowerState = { supported: false, off: false, externalCount: 0, internalAvailable: false, linked: false, scheduleActive: false, busy: false, error: null }

function BatteryBar({ value }: { value: number | null }) {
  return <div className="h-3 overflow-hidden rounded-full bg-zinc-800"><div className={`h-full transition-[width] duration-300 motion-reduce:transition-none ${value !== null && value <= 20 ? "bg-orange-400" : "bg-green-500"}`} style={{ width: `${value ?? 0}%` }} /></div>
}

export function PowerPage() {
  const [data, setData] = useState(emptyData)
  const [external, setExternal] = useState(emptyPower)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState("")
  const controlGeneration = useRef(0)
  useEffect(() => {
    let mounted = true, reading = false
    const refresh = async () => {
      if (reading) return
      reading = true
      const generation = controlGeneration.current
      try {
        const [power, screens] = await Promise.all([window.azoria.power.data(), window.azoria.power.externalState()])
        if (mounted && generation === controlGeneration.current) { setData(power); setExternal(screens) }
      } catch { if (mounted) setNotice("电源数据读取失败，正在重试") }
      finally { reading = false }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => { mounted = false; window.clearInterval(timer) }
  }, [])
  const control = async (action: ExternalPowerAction, holdMinutes?: number) => {
    controlGeneration.current++
    setPending(true); setNotice("")
    try { setExternal(await window.azoria.power.externalControl(action, holdMinutes)); setNotice(action === "off" ? "外接屏已熄灭，笔记本内屏保持开启" : action === "on" ? "外接屏已恢复" : action === "auto" ? "自动计划已恢复" : "旧版联动已关闭") }
    catch (error) { setNotice(error instanceof Error ? error.message : "外接屏控制失败") }
    finally { controlGeneration.current++; setPending(false) }
  }
  const saveSchedule = async (plan: DisplaySchedule) => {
    controlGeneration.current++
    setPending(true)
    try { setExternal(await window.azoria.power.updateSchedule(plan)); setNotice("外接屏每周计划已保存") }
    finally { controlGeneration.current++; setPending(false) }
  }
  return <div className="mx-auto grid max-w-2xl gap-5">
    <DisplayScheduleCard state={external} pending={pending} onControl={control} onSave={saveSchedule} onMessage={setNotice} />
    <p role="status" aria-live="polite" className="text-sm text-zinc-300">{notice || external.error}</p>
    <TouchSleepCard onMessage={setNotice} showRotation={false} />
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Battery />电脑电池</CardTitle><CardDescription>读取系统数据，每 5 秒刷新。</CardDescription></CardHeader><CardContent className="space-y-4">
      <BatteryBar value={data.batteryLevel} /><div className="flex items-center justify-between"><span className="text-sm text-zinc-400">{batteryNames[data.batteryStatus]}</span><span className="font-mono">{data.batteryLevel === null ? "--" : `${data.batteryLevel}%`}</span></div>
      {data.error && <p role="status" className="text-sm text-zinc-500">{data.error}</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Bluetooth />蓝牙设备电量</CardTitle></CardHeader><CardContent className="space-y-4">
      {data.devices.map(device => <div key={device.name} className="space-y-2"><div className="flex justify-between gap-4 text-sm"><span>{device.name}</span><span className="text-zinc-400">{device.level === null ? "未提供电量" : `${device.level}%`}</span></div><BatteryBar value={device.level} /></div>)}
      {!data.devices.length && <p className="text-sm text-zinc-500">{data.available ? "暂无提供电量的已连接蓝牙设备" : "正在读取系统电源数据"}</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Zap />电源模式</CardTitle></CardHeader><CardContent className="text-sm text-zinc-300">{modeNames[data.mode]}</CardContent></Card>
  </div>
}
