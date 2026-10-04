import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp, Cpu, MemoryStick } from "lucide-react"
import type { ComputerSnapshot } from "../../../shared/contracts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function rate(value: number | null): string { return value === null ? "--" : value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB/s` : `${(value / 1024).toFixed(1)} KB/s` }
function Trend({ values, maximum, label, color }: { values: Array<number | null>; maximum: number; label: string; color: string }) {
  let connected = false
  const commands = values.map((value, index) => {
    if (value === null) { connected = false; return "" }
    const command = `${connected ? "L" : "M"}${values.length < 2 ? 0 : index / (values.length - 1) * 300},${54 - Math.min(1, value / Math.max(1, maximum)) * 50}`
    connected = true
    return command
  }).join(" ")
  return <svg viewBox="0 0 300 56" className="mt-4 w-full" role="img" aria-label={label}><path d="M0,54 H300" stroke="currentColor" className="text-border" /><path d={commands} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
}
export function ComputerStatusCard() {
  const [snapshot, setSnapshot] = useState<ComputerSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    const update = () => { void window.azoria.computer.snapshot().then(value => { if (active) { setSnapshot(value); setError(null) } }).catch(() => { if (active) setError("电脑状态暂时不可用") }) }
    update(); const timer = setInterval(update, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  const ready = snapshot?.available && !error
  const history = ready ? snapshot.history : []
  const networkReady = ready && snapshot.networkAvailable
  const items = [
    { title: "CPU", icon: <Cpu />, value: ready && snapshot.cpuPercent !== null ? `${snapshot.cpuPercent.toFixed(1)}%` : "--", detail: "全部核心平均使用率", values: history.map(item => item.cpuPercent), maximum: 100, color: "#20dfe5" },
    { title: "内存", icon: <MemoryStick />, value: ready ? `${snapshot.memoryPercent.toFixed(1)}%` : "--", detail: ready ? `${(snapshot.memoryUsedBytes / 1073741824).toFixed(1)} / ${(snapshot.memoryTotalBytes / 1073741824).toFixed(1)} GB` : "等待采样", values: history.map(item => item.memoryPercent), maximum: 100, color: "#b69af1" },
    { title: "下载", icon: <ArrowDown />, value: rate(networkReady ? snapshot.networkRxBps : null), detail: "活动网卡接收速度合计", values: history.map(item => item.networkRxBps), maximum: Math.max(1024, ...history.map(item => item.networkRxBps ?? 0)), color: "#69a7ff" },
    { title: "上传", icon: <ArrowUp />, value: rate(networkReady ? snapshot.networkTxBps : null), detail: "活动网卡发送速度合计", values: history.map(item => item.networkTxBps), maximum: Math.max(1024, ...history.map(item => item.networkTxBps ?? 0)), color: "#ffc166" },
  ]
  return <Card><CardHeader><CardTitle>电脑状态</CardTitle><CardDescription>每 2 秒更新 · 最近一分钟趋势 · Touch 首页点击 PC Status 查看。</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{items.map(item => <div key={item.title} className="rounded-xl border border-border p-4"><div className="flex items-center gap-2 text-sm text-muted-foreground">{item.icon}{item.title}</div><p className="mt-3 font-mono text-2xl tabular-nums">{item.value}</p><p className="mt-1 text-xs text-muted-foreground">{item.detail}</p><Trend values={item.values} maximum={item.maximum} label={`${item.title}近一分钟趋势`} color={item.color} /></div>)}</div>{error ? <p role="status" className="text-sm text-red-400">{error}</p> : null}<p className="text-xs text-muted-foreground">电脑端在后台运行时继续采样。网卡重新连接或电脑唤醒后会重新建立速度基准。</p></CardContent></Card>
}
