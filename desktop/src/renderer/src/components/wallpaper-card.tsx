import { useEffect, useRef, useState } from "react"
import { Film, Image as ImageIcon, Trash2, Upload } from "lucide-react"
import type { LanDevice, WallpaperInfo } from "../../../shared/contracts"
import { createWallpaperUpload } from "../wallpaper-format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function WallpaperCard({ devices, onMessage }: { devices: LanDevice[]; onMessage(message: string): void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [wallpaper, setWallpaper] = useState<WallpaperInfo | null>(null)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    let active = true
    void window.azoria.wallpaper.info().then((info) => { if (active) setWallpaper(info) })
    return () => { active = false }
  }, [])

  const selectFile = () => inputRef.current?.click()
  const upload = async (file: File) => {
    setProcessing(true)
    onMessage(file.type.startsWith("video/") ? "正在生成 Touch 动态壁纸" : "正在处理 Touch 壁纸")
    try {
      const input = await createWallpaperUpload(file)
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
      {wallpaper ? <div className="rounded-lg border border-white/10 bg-black p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0"><p className="truncate font-medium">{wallpaper.name}</p><p className="mt-1 text-sm text-zinc-500">{wallpaper.kind === "video" ? `动态 · ${wallpaper.frameCount} 帧 · ${(wallpaper.durationMs / 1000).toFixed(1)} 秒循环` : "静态图片"} · {formatBytes(wallpaper.size)}</p></div>
          <Badge variant="outline" className="shrink-0 border-white/10">{devices.length > 0 ? `${syncedCount}/${devices.length} 已同步` : "等待设备"}</Badge>
        </div>
      </div> : <div className="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">尚未设置壁纸</div>}
      <input ref={inputRef} type="file" accept="image/*,video/*" className="sr-only" aria-label="选择图片或视频壁纸" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={processing} onClick={selectFile}><Upload />{processing ? "正在处理" : wallpaper ? "更换壁纸" : "上传壁纸"}</Button>
        <Button variant="outline" disabled={processing || !wallpaper} onClick={() => void remove()}><Trash2 />移除</Button>
      </div>
      <p className="text-xs leading-5 text-zinc-500">第一版使用板载存储：动画最长约 12 秒、总大小不超过 3 MB；后续接入 TF 卡可扩展容量。</p>
    </CardContent>
  </Card>
}
