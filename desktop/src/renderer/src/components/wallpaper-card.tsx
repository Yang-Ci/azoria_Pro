import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Clock3, Film, Image as ImageIcon, ListVideo, Plus, RefreshCw, SkipForward, Trash2, Upload } from "lucide-react"
import type { LanDevice, WallpaperIdleMinutes, WallpaperLibraryItem, WallpaperLibrarySnapshot, WallpaperPlaybackSettings } from "../../../shared/contracts"
import { createWallpaperUpload, wallpaperKind, type WallpaperCrop } from "../wallpaper-format"
import { WallpaperCropDialog } from "./wallpaper-crop-dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

const idleOptions: Array<{ value: WallpaperIdleMinutes; label: string }> = [
  { value: 1, label: "1 分钟" }, { value: 5, label: "5 分钟" }, { value: 10, label: "10 分钟" }, { value: 30, label: "30 分钟" }, { value: 0, label: "关闭" },
]
const intervalOptions = [1, 5, 10, 15, 30, 60, 120, 240, 1440]
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "壁纸操作失败，请重试。"

function WallpaperThumbnail({ item }: { item: WallpaperLibraryItem }) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void window.azoria.wallpaper.preview(item.id).then(value => { if (active) setPreview(value) }).catch(() => { if (active) setPreview(null) })
    return () => { active = false }
  }, [item.id])
  return preview ? <img src={preview} alt={`${item.name}预览`} loading="lazy" className="aspect-square w-full object-cover" />
    : <div className="flex aspect-square items-center justify-center bg-secondary text-muted-foreground"><ImageIcon className="size-8" /><span className="sr-only">暂无预览</span></div>
}

export function WallpaperCard({ devices, onMessage }: { devices: LanDevice[]; onMessage(message: string): void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const dirty = useRef(false)
  const requestVersion = useRef(0)
  const [library, setLibrary] = useState<WallpaperLibrarySnapshot | null>(null)
  const [draft, setDraft] = useState<WallpaperPlaybackSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [idleMinutes, setIdleMinutes] = useState<WallpaperIdleMinutes>(5)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WallpaperLibraryItem | null>(null)

  const acceptSnapshot = useCallback((snapshot: WallpaperLibrarySnapshot) => {
    setLibrary(snapshot)
    if (!dirty.current) setDraft(snapshot.playback)
  }, [])
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    const snapshot = await window.azoria.wallpaper.library()
    if (mounted.current && version === requestVersion.current) acceptSnapshot(snapshot)
  }, [acceptSnapshot])
  useEffect(() => {
    mounted.current = true
    void Promise.all([refresh(), window.azoria.wallpaper.settings()]).then(([, settings]) => {
      if (mounted.current) setIdleMinutes(settings.idleMinutes)
    }).catch(error => { if (mounted.current) setError(errorMessage(error)) })
    const timer = window.setInterval(() => { if (!document.hidden) void refresh().catch(error => { if (mounted.current) setError(errorMessage(error)) }) }, 5000)
    return () => { mounted.current = false; requestVersion.current++; clearInterval(timer) }
  }, [refresh])
  const run = async (operation: () => Promise<unknown>, message?: string) => {
    setBusy(true); setError(null)
    try { await operation(); await refresh(); if (message) onMessage(message) }
    catch (error) { setError(errorMessage(error)); onMessage(errorMessage(error)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const change = (update: (current: WallpaperPlaybackSettings) => WallpaperPlaybackSettings) => {
    dirty.current = true
    setDraft(current => current ? update(current) : current)
  }
  const togglePlaylist = (id: string) => change(current => {
    const playlist = current.playlist.includes(id) ? current.playlist.filter(item => item !== id) : [...current.playlist, id]
    return { ...current, playlist, enabled: current.enabled && playlist.length > 1 }
  })
  const move = (index: number, direction: number) => change(current => {
    const playlist = [...current.playlist]
    const target = index + direction
    if (target < 0 || target >= playlist.length) return current
    const item = playlist[index]!
    playlist[index] = playlist[target]!; playlist[target] = item
    return { ...current, playlist }
  })
  const upload = async (crop: WallpaperCrop) => {
    if (!file) return
    setProcessing(true); setBusy(true); setProgress(0); setError(null)
    try {
      const limits = devices.map(device => device.wallpaperLimit).filter((limit): limit is number => typeof limit === "number" && Number.isInteger(limit) && limit > 0)
      const packageLimit = limits.length === devices.length && limits.length > 0 ? Math.min(...limits) - 64 * 1024 : 3 * 1024 * 1024 - 64 * 1024
      const input = await createWallpaperUpload(file, packageLimit, crop, setProgress)
      await window.azoria.wallpaper.upload(input)
      await refresh(); setFile(null)
      onMessage(devices.length ? "壁纸已加入壁纸库，Touch 正在自动同步" : "壁纸已加入壁纸库，Touch 联机后会自动同步")
    } catch (error) { setError(errorMessage(error)); onMessage(errorMessage(error)) }
    finally { if (mounted.current) { setProcessing(false); setBusy(false) } }
  }
  const removeItem = async (item: WallpaperLibraryItem) => {
    await run(async () => {
      await window.azoria.wallpaper.deleteItem(item.id)
      if (dirty.current) setDraft(current => current ? {
        ...current, playlist: current.playlist.filter(id => id !== item.id), schedules: current.schedules.filter(rule => rule.wallpaperId !== item.id),
        enabled: current.enabled && current.playlist.filter(id => id !== item.id).length > 1,
      } : current)
    }, "壁纸已删除，播放列表和定时规则已更新")
  }
  const savePlayback = async () => {
    if (!draft) return
    await run(async () => {
      const snapshot = await window.azoria.wallpaper.setPlayback(draft)
      dirty.current = false; acceptSnapshot(snapshot)
    }, "壁纸播放设置已保存")
  }
  const discardPlayback = () => { if (library) { dirty.current = false; setDraft(library.playback) } }
  const items = library?.items ?? []
  const current = items.find(item => item.id === library?.activeId)
  const syncedCount = current ? devices.filter(device => device.wallpaperHash === current.sha256).length : 0
  const tfCount = devices.filter(device => device.wallpaperStorage === "tf").length
  const itemMap = new Map(items.map(item => [item.id, item]))

  return <Card>
    <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
      <div className="space-y-2"><CardTitle className="flex items-center gap-2"><ImageIcon className="size-5" />壁纸库</CardTitle><CardDescription>收藏图片与动态壁纸，为 Touch 安排每天的画面</CardDescription></div>
      <Button variant="outline" size="sm" disabled={busy || !library} onClick={() => inputRef.current?.click()}><Plus className="size-4" />添加壁纸</Button>
    </CardHeader>
    <CardContent className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
          <div className="flex min-w-0 items-center gap-3"><Clock3 className="size-5 shrink-0 text-muted-foreground" /><div><p className="text-sm font-medium">自动进入壁纸</p><p className="mt-1 text-xs text-muted-foreground">Touch 无操作达到指定时间后进入</p></div></div>
          <Select value={String(idleMinutes)} disabled={busy || !library} onValueChange={value => void run(async () => { const settings = await window.azoria.wallpaper.setIdleMinutes(Number(value) as WallpaperIdleMinutes); setIdleMinutes(settings.idleMinutes) }, "自动进入壁纸时间已保存")}>
            <SelectTrigger aria-label="自动进入壁纸时间" className="w-28 shrink-0"><SelectValue /></SelectTrigger><SelectContent>{idleOptions.map(option => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
          <div className="min-w-0"><p className="text-sm font-medium">当前显示</p><p className="mt-1 truncate text-xs text-muted-foreground">{current?.name ?? "尚未设置壁纸"}</p></div>
          <Badge variant="outline" className="shrink-0">{current && devices.length ? `${syncedCount}/${devices.length} 已同步` : "等待设备"}</Badge>
        </div>
      </div>
      {error || library?.error ? <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-400/30 p-3 text-sm text-red-300"><p>{error ?? library?.error}</p><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(refresh)}><RefreshCw className="size-4" />重试</Button></div> : null}
      {items.length ? <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {items.map(item => <div key={item.id} className={`overflow-hidden rounded-xl border ${item.id === library?.activeId ? "border-emerald-400/60" : "border-border"}`}>
          <div className="relative"><WallpaperThumbnail item={item} /><div className="absolute left-2 top-2 flex gap-1"><Badge className="bg-black/75 text-white">{item.kind === "video" ? <><Film className="mr-1 size-3" />动态</> : "图片"}</Badge>{item.id === library?.activeId ? <Badge className="bg-emerald-500 text-black">当前</Badge> : null}</div></div>
          <div className="space-y-3 p-3">
            <div><p className="truncate text-sm font-medium" title={item.name}>{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{(item.size / 1024 / 1024).toFixed(1)} MB{item.kind === "video" ? ` · ${(item.durationMs / 1000).toFixed(1)} 秒` : ""}</p></div>
            <div className="flex items-center gap-2"><Button className="flex-1" variant="outline" size="sm" disabled={busy || item.id === library?.activeId} onClick={() => void run(() => window.azoria.wallpaper.activate(item.id), "当前壁纸已切换，Touch 正在同步")}>{item.id === library?.activeId ? "正在显示" : "显示"}</Button><Button variant="ghost" size="icon" className="size-8 shrink-0" disabled={busy} aria-label={`删除 ${item.name}`} onClick={() => setDeleteTarget(item)}><Trash2 className="size-4" /></Button></div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={draft?.playlist.includes(item.id) ?? false} disabled={busy || !draft} onChange={() => togglePlaylist(item.id)} aria-label={`将 ${item.name} 加入播放列表`} className="accent-emerald-400" />加入播放列表{draft?.playlist.includes(item.id) ? <span className="ml-auto font-mono">{draft.playlist.indexOf(item.id) + 1}</span> : null}</label>
          </div>
        </div>)}
      </div> : <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center"><ImageIcon className="size-8 text-muted-foreground" /><p className="text-sm">{library ? "添加第一张壁纸" : "正在读取壁纸库…"}</p><p className="text-xs text-muted-foreground">选择图片或视频，先预览裁切效果，再保存到壁纸库。</p><Button variant="outline" disabled={busy || !library} onClick={() => inputRef.current?.click()}><Upload className="size-4" />选择图片或视频</Button></div>}
      {draft && items.length ? <fieldset disabled={busy} className="space-y-5 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-medium"><ListVideo className="size-4 text-muted-foreground" />播放列表与定时切换</h3>{dirty.current ? <Badge variant="outline" className="text-amber-300">设置尚未保存</Badge> : null}</div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex items-center justify-between gap-3"><label htmlFor="wallpaper-playback-enabled" className="text-sm">自动轮播</label><Switch id="wallpaper-playback-enabled" aria-label="自动轮播" checked={draft.enabled} disabled={busy || draft.playlist.length < 2} onCheckedChange={enabled => change(current => ({ ...current, enabled }))} /></div>
          <div className="space-y-2"><label className="text-xs text-muted-foreground" htmlFor="wallpaper-playback-order">播放顺序</label><Select value={draft.order} disabled={busy} onValueChange={order => change(current => ({ ...current, order: order as WallpaperPlaybackSettings["order"] }))}><SelectTrigger id="wallpaper-playback-order" aria-label="壁纸播放顺序"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="sequential">顺序循环</SelectItem><SelectItem value="random">随机播放</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><label className="text-xs text-muted-foreground" htmlFor="wallpaper-playback-interval">切换间隔</label><Select value={String(draft.intervalMinutes)} disabled={busy} onValueChange={value => change(current => ({ ...current, intervalMinutes: Number(value) }))}><SelectTrigger id="wallpaper-playback-interval" aria-label="壁纸切换间隔"><SelectValue /></SelectTrigger><SelectContent>{[...new Set([...intervalOptions, draft.intervalMinutes])].sort((a, b) => a - b).map(minutes => <SelectItem key={minutes} value={String(minutes)}>{minutes === 1440 ? "每天" : minutes >= 60 ? `${minutes / 60} 小时` : `${minutes} 分钟`}</SelectItem>)}</SelectContent></Select></div>
        </div>
        {draft.playlist.length ? <ol className="space-y-2">{draft.playlist.map((id, index) => {
          const item = itemMap.get(id)
          return item ? <li key={id} className="flex items-center gap-2 rounded-lg bg-secondary/40 px-3 py-2"><span className="w-5 font-mono text-xs text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm">{item.name}</span><Button variant="ghost" size="icon" className="size-7" disabled={busy || index === 0} aria-label={`上移 ${item.name}`} onClick={() => move(index, -1)}><ArrowUp className="size-3.5" /></Button><Button variant="ghost" size="icon" className="size-7" disabled={busy || index === draft.playlist.length - 1} aria-label={`下移 ${item.name}`} onClick={() => move(index, 1)}><ArrowDown className="size-3.5" /></Button><Button variant="ghost" size="icon" className="size-7" aria-label={`从播放列表移除 ${item.name}`} onClick={() => togglePlaylist(id)}><Trash2 className="size-3.5" /></Button></li> : null
        })}</ol> : <p className="text-xs text-muted-foreground">在壁纸上勾选“加入播放列表”，选择轮播内容。</p>}
        {draft.playlist.length < 2 ? <p className="text-xs text-muted-foreground">自动轮播需要至少两张壁纸。</p> : null}
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">每天定时切换</p><p className="mt-1 text-xs text-muted-foreground">按电脑本地时间，切换到指定壁纸</p></div><Button variant="outline" size="sm" disabled={busy || draft.schedules.length >= 24} onClick={() => change(current => ({ ...current, schedules: [...current.schedules, { id: crypto.randomUUID(), time: "09:00", wallpaperId: library?.activeId ?? items[0]!.id, enabled: true }] }))}><Plus className="size-4" />添加时间</Button></div>
          {draft.schedules.map((rule, index) => <div key={rule.id} className="flex flex-wrap items-center gap-2"><input type="checkbox" checked={rule.enabled} aria-label={`启用定时规则 ${index + 1}`} onChange={event => { const enabled = event.target.checked; change(current => ({ ...current, schedules: current.schedules.map(item => item.id === rule.id ? { ...item, enabled } : item) })) }} className="accent-emerald-400" /><Input type="time" value={rule.time} aria-label={`定时切换时间 ${index + 1}`} className="w-32 shrink-0 [color-scheme:dark]" onChange={event => { const time = event.target.value; change(current => ({ ...current, schedules: current.schedules.map(item => item.id === rule.id ? { ...item, time } : item) })) }} /><Select value={rule.wallpaperId} disabled={busy} onValueChange={wallpaperId => change(current => ({ ...current, schedules: current.schedules.map(item => item.id === rule.id ? { ...item, wallpaperId } : item) }))}><SelectTrigger aria-label={`定时切换壁纸 ${index + 1}`} className="min-w-32 flex-1"><SelectValue /></SelectTrigger><SelectContent>{items.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><Button variant="ghost" size="icon" aria-label={`删除定时规则 ${index + 1}`} onClick={() => change(current => ({ ...current, schedules: current.schedules.filter(item => item.id !== rule.id) }))}><Trash2 className="size-4" /></Button></div>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><div className="text-xs text-muted-foreground">{library?.nextSwitchAt ? `下次切换 ${new Date(library.nextSwitchAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}` : "自动轮播未开启"}{dirty.current ? " · 显示的是已保存的计划" : ""}</div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy || dirty.current || (library?.playback.playlist.length ?? 0) < 2} onClick={() => void run(() => window.azoria.wallpaper.next(), "已切换到播放列表中的下一张壁纸")}><SkipForward className="size-4" />下一张</Button><Button variant="ghost" size="sm" disabled={busy || !dirty.current} onClick={discardPlayback}>撤销修改</Button><Button size="sm" disabled={busy || !dirty.current} onClick={() => void savePlayback()}>保存播放设置</Button></div></div>
      </fieldset> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><span>{items.length}/100 张{devices.length ? ` · ${tfCount ? "TF 卡已就绪" : "板载存储或等待设备上报"}` : ""}</span>{current ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => window.azoria.wallpaper.remove(), "已停止显示壁纸并暂停播放计划，壁纸库仍保留")}>停止显示</Button> : null}</div>
      <p className="text-xs leading-5 text-muted-foreground">轮播和定时切换需要 YangCi 运行，Touch 与电脑连接同一局域网；小屏离线时保留最后同步的壁纸。动态壁纸最长 10 秒、目标 25 帧，TF 卡最大 24 MB，板载存储最大 3 MB。</p>
      <input ref={inputRef} type="file" accept="image/*,video/*" className="sr-only" aria-label="选择图片或视频壁纸" onChange={event => {
        const selected = event.target.files?.[0]; event.target.value = ""
        if (selected) { try { wallpaperKind(selected); setError(null); setFile(selected) } catch (error) { setError(errorMessage(error)) } }
      }} />
      {file ? <WallpaperCropDialog key={`${file.name}-${file.lastModified}`} file={file} processing={processing} progress={progress} saveError={error} onClose={() => setFile(null)} onSave={crop => void upload(crop)} /> : null}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这张壁纸？</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.name} 将从壁纸库、播放列表和定时规则中移除。当前壁纸被删除时会切换到下一张。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { if (deleteTarget) void removeItem(deleteTarget) }}>删除壁纸</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </CardContent>
  </Card>
}
