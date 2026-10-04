import { useEffect, useState, type CSSProperties } from "react"
import { RotateCcw } from "lucide-react"
import { defaultWallpaperCrop, wallpaperCropRect, wallpaperKind, type WallpaperCrop } from "../wallpaper-format"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"

export function WallpaperCropDialog({ file, processing, progress, saveError, onClose, onSave }: {
  file: File; processing: boolean; progress: number; saveError: string | null; onClose(): void; onSave(crop: WallpaperCrop): void
}) {
  const [url, setUrl] = useState("")
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [crop, setCrop] = useState<WallpaperCrop>(defaultWallpaperCrop)
  const [error, setError] = useState<string | null>(null)
  const kind = wallpaperKind(file)
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  const rect = dimensions ? wallpaperCropRect(dimensions.width, dimensions.height, crop) : null
  const mediaStyle: CSSProperties = dimensions && rect ? {
    position: "absolute", maxWidth: "none", width: `${dimensions.width / rect.size * 100}%`, height: `${dimensions.height / rect.size * 100}%`,
    left: `${-rect.x / rect.size * 100}%`, top: `${-rect.y / rect.size * 100}%`,
  } : { visibility: "hidden" }
  const failed = () => setError("无法预览所选文件，请换一张图片或使用系统支持的视频格式。")
  return <Dialog open onOpenChange={(open) => { if (!open && !processing) onClose() }}>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>裁切预览</DialogTitle>
        <DialogDescription className="truncate">{file.name} · 调整位置和缩放，预览 Touch 上的显示效果</DialogDescription>
      </DialogHeader>
      <div className="grid items-start gap-6 sm:grid-cols-[1fr_1fr]">
        <div className="mx-auto w-full max-w-72">
          <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-black" aria-label="480 × 480 壁纸裁切预览">
            {url && (kind === "video"
              ? <video src={url} muted autoPlay loop playsInline style={mediaStyle} onLoadedData={(event) => {
                const video = event.currentTarget
                if (video.videoWidth && video.videoHeight) setDimensions({ width: video.videoWidth, height: video.videoHeight }); else failed()
              }} onError={failed} />
              : <img src={url} alt="所选壁纸裁切效果" style={mediaStyle} onLoad={(event) => {
                const image = event.currentTarget
                setDimensions({ width: image.naturalWidth, height: image.naturalHeight })
              }} onError={failed} />)}
            {!dimensions && !error ? <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">正在读取预览…</p> : null}
            <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-20" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <div key={index} className="border border-white" />)}</div>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">480 × 480{kind === "video" ? " · 动态壁纸保留前 10 秒以内片段" : ""}</p>
        </div>
        <fieldset disabled={processing || !dimensions || !!error} className="space-y-5">
          <div className="space-y-3"><label className="flex justify-between text-sm" htmlFor="wallpaper-crop-zoom">缩放<span className="font-mono text-muted-foreground">{crop.zoom.toFixed(2)}×</span></label><Slider disabled={processing || !dimensions || !!error} id="wallpaper-crop-zoom" aria-label="壁纸缩放" min={100} max={300} step={1} value={[Math.round(crop.zoom * 100)]} onValueChange={([value]) => setCrop(current => ({ ...current, zoom: value! / 100 }))} /></div>
          <div className="space-y-3"><label className="text-sm" htmlFor="wallpaper-crop-x">水平位置</label><Slider disabled={processing || !dimensions || !!error} id="wallpaper-crop-x" aria-label="壁纸水平位置" min={0} max={100} value={[Math.round(crop.x * 100)]} onValueChange={([value]) => setCrop(current => ({ ...current, x: value! / 100 }))} /></div>
          <div className="space-y-3"><label className="text-sm" htmlFor="wallpaper-crop-y">垂直位置</label><Slider disabled={processing || !dimensions || !!error} id="wallpaper-crop-y" aria-label="壁纸垂直位置" min={0} max={100} value={[Math.round(crop.y * 100)]} onValueChange={([value]) => setCrop(current => ({ ...current, y: value! / 100 }))} /></div>
          <Button variant="outline" size="sm" onClick={() => setCrop(defaultWallpaperCrop)}><RotateCcw className="size-4" />居中重置</Button>
          <p className="text-xs leading-5 text-muted-foreground">保存后加入壁纸库，并作为当前壁纸同步到 Touch。</p>
        </fieldset>
      </div>
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
      {saveError ? <p role="alert" className="text-sm text-red-400">{saveError}</p> : null}
      {processing ? <p role="status" className="text-sm text-muted-foreground">正在生成壁纸… {progress}%</p> : null}
      <DialogFooter>
        <Button variant="outline" disabled={processing} onClick={onClose}>取消</Button>
        <Button disabled={processing || !dimensions || !!error} onClick={() => onSave(crop)}>{processing ? "正在保存…" : "保存并显示"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
