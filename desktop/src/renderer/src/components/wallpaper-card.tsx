import { useEffect, useRef, useState } from "react"
import { Clock3, Film, Image as ImageIcon, Trash2, Upload } from "lucide-react"
import type { LanDevice, WallpaperIdleMinutes, WallpaperInfo } from "../../../shared/contracts"
import { createWallpaperUpload } from "../wallpaper-format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const idleOptions: Array<{ value: WallpaperIdleMinutes; label: string }> = [
  { value: 1, label: "1 分钟" },
  { value: 5, label: "5 分钟" },
  { value: 10, label: "10 分钟" },
  { value: 30, label: "30 分钟" },
  { value: 0, label: "关闭" },
]

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function WallpaperCard({ devices, onMessage }: { devices: LanDevice[]; onMessage(message: string): void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [wallpaper, setWallpaper] = useState<WallpaperInfo | null>(null)
  const [processing, setProcessing] = useState(false)
  const [idleMinutes, setIdleMinutes] = useState<WallpaperIdleMinutes>(5)
  const [savingIdle, setSavingIdle] = useState(false)

  useEffect(() => {
    let active = true
    void Promise.all([window.azoria.wallpaper.info(), window.azoria.wallpaper.settings()]).then(([info, settings]) => {
      if (!active) return
      setWallpaper(info)
      setIdleMinutes(settings.idleMinutes)
    }).catch(() => onMessage("壁纸设置读取失败"))
    return () => { active = false }
  }, [onMessage])

  const saveIdleMinutes = async (value: string) => {
    const minutes = Number(value) as WallpaperIdleMinutes
    setSavingIdle(true)
    try {
      const settings = await window.azoria.wallpaper.setIdleMinutes(minutes)
      setIdleMinutes(settings.idleMinutes)
      onMessage(minutes === 0 ? "已关闭自动进入壁纸模式" : `无操作 ${minutes} 分钟后将自动进入壁纸模式`)
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "自动壁纸时间保存失败")
    } finally {
      setSavingIdle(false)
    }
  }

  const selectFile = () => inputRef.current?.click()
  const upload = async (file: File) => {
    setProcessing(true)
    onMessage(file.type.startsWith("video/") ? "正在生成 Touch 动态壁纸" : "正在处理 Touch 壁纸")
    try {
      const reportedLimits = devices
        .map((device) => device.wallpaperLimit)
        .filter((limit): limit is number => typeof limit === "number" && Number.isInteger(limit) && limit > 0)
      const packageLimit = reportedLimits.length === devices.length && reportedLimits.length > 0
        ? Math.min(...reportedLimits) - 64 * 1024
        : 3_150_000
      const input = await createWallpaperUpload(file, packageLimit)
      const info = await window.azoria.wallpaper.upload(input)
      setWallpaper(info)
      onMessage(devices.length > 0 ? "壁纸已保存，Touch 正在自动同步" : "壁纸已保存，Touch 联机后会自动同步")
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "壁纸处理失败")
    } finally {
      setProcessing(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }
  let syncedCount = 0
  const tfCount = devices.filter((device) => device.wallpaperStorage === "tf").length
  if (wallpaper) {
    for (const device of devices) if (device.wallpaperHash === wallpaper.sha256) syncedCount++
  }
  const remove = async () => {
    setProcessing(true)
    try {
      await window.azoria.wallpaper.remove()
      setWallpaper(null)
      onMessage("壁纸已移除，Touch 正在同步")
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "壁纸移除失败")
    } finally {
      setProcessing(false)
    }
  }

  return <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">{wallpaper?.kind === "video" ? <Film /> : <ImageIcon />}壁纸模式</CardTitle>
      <CardDescription>图片或视频会转换为 480 × 480，并同步到同一 Wi‑Fi 下的所有 Touch</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-black p-4">
        <div className="flex min-w-0 items-center gap-3">
          <Clock3 className="size-5 shrink-0 text-zinc-400" />
          <div><p className="text-sm font-medium">自动进入壁纸</p><p className="mt-1 text-xs text-zinc-500">Touch 无操作达到指定时间后进入</p></div>
        </div>
        <Select value={String(idleMinutes)} disabled={savingIdle} onValueChange={(value) => void saveIdleMinutes(value)}>
          <SelectTrigger className="w-28 shrink-0"><SelectValue /></SelectTrigger>
          <SelectContent>{idleOptions.map((option) => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {wallpaper ? <div className="rounded-lg border border-white/10 bg-black p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0"><p className="truncate font-medium">{wallpaper.name}</p><p className="mt-1 text-sm text-zinc-500">{wallpaper.kind === "video" ? `动态 · ${wallpaper.frameCount} 帧 · ${(wallpaper.durationMs / 1000).toFixed(1)} 秒循环` : "静态图片"} · {formatBytes(wallpaper.size)}</p></div>
          <Badge variant="outline" className="shrink-0 border-white/10">{devices.length > 0 ? `${syncedCount}/${devices.length} 已同步` : "等待设备"}</Badge>
        </div>
      </div> : <div className="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">尚未设置壁纸</div>}
      {devices.length > 0 && <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>Touch 存储</span>
        <Badge variant="outline" className="border-white/10">
          {tfCount > 0 ? `TF 卡已就绪${devices.length > 1 ? ` ${tfCount}/${devices.length}` : ""}` : devices.every((device) => device.wallpaperStorage === "flash") ? "板载存储" : "等待设备上报"}
        </Badge>
      </div>}
      <input ref={inputRef} type="file" accept="image/*,video/*" className="sr-only" aria-label="选择图片或视频壁纸" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={processing} onClick={selectFile}><Upload />{processing ? "正在处理" : wallpaper ? "更换壁纸" : "上传壁纸"}</Button>
        <Button variant="outline" disabled={processing || !wallpaper} onClick={() => void remove()}><Trash2 />移除</Button>
      </div>
      <p className="text-xs leading-5 text-zinc-500">已插入 TF 卡时优先保存到卡中：动画最长约 20 秒、最多 120 帧、总大小不超过 24 MB；未插卡时自动使用板载存储，壁纸需小于 3 MB。</p>
    </CardContent>
  </Card>
}
