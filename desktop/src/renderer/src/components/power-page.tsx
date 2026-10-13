import { useEffect, useState } from "react"
import { Battery, Bluetooth, Zap } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { PowerMode } from "../../../shared/contracts"

interface ConnectedDevice {
  name: string
  level: number
}


const modeInfo: Record<PowerMode, { title: string; desc: string }> = {
  performance: { title: "性能模式", desc: "高性能和功耗" },
  balanced: { title: "均衡模式", desc: "标准性能和功耗" },
  "power-saver": { title: "节电模式", desc: "降低性能和功耗" },
  unknown: { title: "未知", desc: "无法获取当前电源模式" },
}

function ProgressBar({ level, color }: { level: number; color: string }) {
  const width = Math.min(100, Math.max(0, level))
  return (
    <div className="h-3 w-full rounded-full bg-zinc-800 overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all duration-500", color)}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}



export function PowerPage() {
  const [batteryLevel] = useState(95)
  const [batteryStatus] = useState("已充满")
  const [devices] = useState<ConnectedDevice[]>([
    { name: "VGN Y2 Ultra", level: 70 },
    { name: "X98 5.0", level: 0 },
  ])
  const [powerMode, setPowerMode] = useState<PowerMode>("unknown")

  useEffect(() => {
    let mounted = true
    window.azoria.power.mode().then((mode) => {
      if (mounted) setPowerMode(mode)
    }).catch(() => {
      if (mounted) setPowerMode("unknown")
    })
    return () => { mounted = false }
  }, [])

  const batteryColor = "bg-green-500"

  function deviceColor(level: number) {
    if (level <= 0) return "bg-zinc-600"
    if (level <= 30) return "bg-orange-500"
    return "bg-green-500"
  }



  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Battery className="h-5 w-5" />
          电池电量
        </h2>
        <Card className="border-white/10 bg-zinc-900/50">
          <CardContent className="p-5 space-y-4">
            <ProgressBar level={batteryLevel} color={batteryColor} />
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-300">{batteryStatus}</span>
              <span className="font-mono tabular-nums text-white">{batteryLevel}%</span>
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Bluetooth className="h-5 w-5" />
          已连接的设备
        </h2>
        <Card className="border-white/10 bg-zinc-900/50">
          <CardContent className="divide-y divide-white/10 p-5">
            {devices.map((device) => (
              <div key={device.name} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="font-medium text-white">{device.name}</span>
                  <span className="font-mono tabular-nums text-zinc-400">{device.level}%</span>
                </div>
                <ProgressBar level={device.level} color={deviceColor(device.level)} />
              </div>
            ))}
            {devices.length === 0 && (
              <p className="text-sm text-zinc-500">暂无已连接的蓝牙设备</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Zap className="h-5 w-5" />
          电源模式
        </h2>
        <Card className="border-white/10 bg-zinc-900/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-white">{modeInfo[powerMode].title}</p>
                <p className="text-sm text-zinc-500">{modeInfo[powerMode].desc}</p>
              </div>
              <div className="rounded-full bg-orange-500/10 px-3 py-1 text-sm font-medium text-orange-500">
                {powerMode === "unknown" ? "--" : powerMode}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
