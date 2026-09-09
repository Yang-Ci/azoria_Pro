import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Disc3, ListEnd, Music2, Pause, Play, RefreshCw, Repeat1, Repeat2, Shuffle, SkipBack, SkipForward } from "lucide-react"
import type { MusicControlRequest, MusicSnapshot, MusicSource, MusicTrack } from "../../../shared/contracts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"

const empty: MusicSnapshot = {
  available: false,
  track: null,
  provider: null,
  lines: [],
  plainText: "",
  message: "正在检测音乐播放器",
  syncReady: false,
}

function sourceLabel(source: MusicSource) {
  if (source === "netease") return "网易云音乐"
  if (source === "qqmusic") return "QQ 音乐"
  return "系统媒体"
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
}

function neteasePlaybackMode(track: MusicTrack) {
  if (track.shuffleActive) return "shuffle"
  if (track.repeatMode === "track") return "track"
  if (track.repeatMode === "list") return "list"
  if (track.repeatMode === "none") return "order"
  return "unknown"
}

function neteasePlaybackModeLabel(track: MusicTrack) {
  const mode = neteasePlaybackMode(track)
  if (mode === "shuffle") return "随机播放"
  if (mode === "track") return "单曲循环"
  if (mode === "list") return "列表循环"
  if (mode === "order") return "顺序播放"
  return "未同步，点击切换"
}

function projectedPosition(track: MusicTrack, now: number) {
  const elapsed = track.status === "playing" && track.sampledAt > 0
    ? Math.max(0, now - track.sampledAt) * track.playbackRate
    : 0
  const position = track.positionMs + elapsed
  return track.durationMs > 0 ? Math.min(position, track.durationMs) : position
}

export function optimisticMusicControl(snapshot: MusicSnapshot, request: MusicControlRequest): MusicSnapshot {
  if (!snapshot.track) return snapshot
  const track = { ...snapshot.track }
  const now = Date.now()
  if (request.action === "play") { track.status = "playing"; track.sampledAt = now }
  if (request.action === "pause") { track.positionMs = projectedPosition(track, now); track.status = "paused"; track.sampledAt = now }
  if (request.action === "seek") { track.positionMs = request.positionMs; track.sampledAt = now }
  if (request.action === "set-shuffle") track.shuffleActive = request.enabled
  if (request.action === "set-repeat") track.repeatMode = request.repeatMode
  if (request.action === "toggle-shuffle" && track.shuffleActive !== null) track.shuffleActive = !track.shuffleActive
  if (request.action === "cycle-repeat") {
    track.repeatMode = track.repeatMode === "none" ? "list" : track.repeatMode === "list" ? "track" : track.repeatMode === "track" ? "none" : "unknown"
  }
  if (request.action === "cycle-play-mode") {
    const mode = neteasePlaybackMode(track)
    if (mode === "order") { track.shuffleActive = false; track.repeatMode = "list" }
    if (mode === "list") { track.shuffleActive = false; track.repeatMode = "track" }
    if (mode === "track") { track.shuffleActive = true; track.repeatMode = "list" }
    if (mode === "shuffle") { track.shuffleActive = false; track.repeatMode = "none" }
  }
  return { ...snapshot, track }
}

interface PlaybackControlsProps {
  track: MusicTrack
  positionMs: number
  busy: boolean
  onPositionChange(value: number | null): void
  onControl(request: MusicControlRequest): Promise<void>
}

function PlaybackControls({ track, positionMs, busy, onPositionChange, onControl }: PlaybackControlsProps) {
  const playing = track.status === "playing"
  const repeatActive = track.repeatMode === "track" || track.repeatMode === "list"
  const repeatStateKnown = track.repeatMode !== "unknown"
  const canCycleRepeat = track.controls.repeat && (repeatStateKnown || track.source === "netease")
  const neteaseMode = neteasePlaybackMode(track)
  const neteaseModeLabel = neteasePlaybackModeLabel(track)
  const seekEnabled = track.controls.seek && track.durationMs > 0

  return <div className="space-y-3">
    <div className="space-y-2">
      <Slider
        aria-label="播放进度"
        value={[Math.min(positionMs, track.durationMs || positionMs)]}
        max={Math.max(track.durationMs, 1)}
        step={250}
        disabled={!seekEnabled || busy}
        onValueChange={(value) => onPositionChange(value[0] ?? 0)}
        onValueCommit={(value) => void onControl({ action: "seek", positionMs: value[0] ?? 0 })}
      />
      <div className="flex justify-between font-mono text-xs text-zinc-500">
        <span>{formatTime(positionMs)}</span>
        <span>{track.durationMs > 0 ? formatTime(track.durationMs) : "--:--"}</span>
      </div>
    </div>
    <div className="flex items-center justify-center gap-2">
      {track.source === "netease" ? <Button type="button" size="icon" variant="secondary" disabled={(!track.controls.repeat && !track.controls.shuffle) || busy} aria-label={`播放模式：${neteaseModeLabel}`} title={`播放模式：${neteaseModeLabel}`} onClick={() => void onControl({ action: "cycle-play-mode" })}>
        {neteaseMode === "shuffle" ? <Shuffle className="size-4" /> : neteaseMode === "track" ? <Repeat1 className="size-4" /> : neteaseMode === "list" ? <Repeat2 className="size-4" /> : <ListEnd className="size-4" />}
      </Button> : <Button type="button" size="icon" variant={track.shuffleActive ? "secondary" : "ghost"} disabled={!track.controls.shuffle || track.shuffleActive === null || busy} aria-label={track.shuffleActive ? "关闭随机播放" : "开启随机播放"} title={track.controls.shuffle ? (track.shuffleActive ? "关闭随机播放" : "开启随机播放") : "播放器未提供随机控制"} onClick={() => void onControl({ action: "toggle-shuffle" })}>
        <Shuffle className="size-4" />
      </Button>}
      <Button type="button" size="icon" variant="ghost" disabled={!track.controls.previous || busy} aria-label="上一首" title="上一首" onClick={() => void onControl({ action: "previous" })}>
        <SkipBack className="size-5" />
      </Button>
      <Button type="button" size="icon" className="size-11 rounded-full" disabled={busy || (playing ? !track.controls.pause : !track.controls.play)} aria-label={playing ? "暂停" : "播放"} title={playing ? "暂停" : "播放"} onClick={() => void onControl({ action: playing ? "pause" : "play" })}>
        {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}
      </Button>
      <Button type="button" size="icon" variant="ghost" disabled={!track.controls.next || busy} aria-label="下一首" title="下一首" onClick={() => void onControl({ action: "next" })}>
        <SkipForward className="size-5" />
      </Button>
      {track.source !== "netease" && <Button type="button" size="icon" variant={repeatActive ? "secondary" : "ghost"} disabled={!canCycleRepeat || busy} aria-label={`循环模式：${track.repeatMode === "track" ? "单曲循环" : track.repeatMode === "list" ? "列表循环" : track.repeatMode === "unknown" ? "未同步，点击切换" : "关闭"}`} title={track.controls.repeat ? `循环模式：${track.repeatMode === "track" ? "单曲" : track.repeatMode === "list" ? "列表" : track.repeatMode === "unknown" ? "未同步，点击后由播放器切换一次" : "关闭"}` : "播放器未提供循环控制"} onClick={() => void onControl({ action: "cycle-repeat" })}>
        {track.repeatMode === "track" ? <Repeat1 className="size-4" /> : <Repeat2 className="size-4" />}
      </Button>}
    </div>
  </div>
}

export function MusicLyricsCard() {
  const [snapshot, setSnapshot] = useState(empty)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [controlError, setControlError] = useState("")
  const [seekingMs, setSeekingMs] = useState<number | null>(null)
  const currentRef = useRef<HTMLButtonElement>(null)
  const refreshingRef = useRef(false)
  const controlCooldownRef = useRef(false)
  const controlRequestRef = useRef(0)
  const controlInFlightRef = useRef(0)
  const [playbackNow, setPlaybackNow] = useState(Date.now())
  const refresh = useCallback(async () => {
    if (refreshingRef.current || controlInFlightRef.current > 0) return
    refreshingRef.current = true
    try { setSnapshot(await window.azoria.music.snapshot()) }
    catch (error) { setSnapshot({ ...empty, message: error instanceof Error ? error.message : "音乐检测失败" }) }
    finally { refreshingRef.current = false; setLoading(false) }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 750)
    return () => window.clearInterval(timer)
  }, [refresh])

  const track = snapshot.track
  useEffect(() => {
    setPlaybackNow(Date.now())
    if (track?.status !== "playing") return
    const timer = window.setInterval(() => setPlaybackNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [track?.status, track?.title, track?.artist])
  const positionMs = seekingMs ?? (track ? projectedPosition(track, playbackNow) : 0)
  const currentIndex = useMemo(() => {
    if (!track || positionMs <= 0) return -1
    for (let index = snapshot.lines.length - 1; index >= 0; index--) {
      if ((snapshot.lines[index]?.timeMs ?? Number.MAX_SAFE_INTEGER) <= positionMs) return index
    }
    return -1
  }, [snapshot.lines, track, positionMs])

  useEffect(() => { currentRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }) }, [currentIndex])
  useEffect(() => { setSeekingMs(null) }, [track?.title, track?.artist])

  const runControl = useCallback((request: MusicControlRequest) => {
    if (controlCooldownRef.current) return Promise.resolve()
    controlCooldownRef.current = true
    const requestId = ++controlRequestRef.current
    controlInFlightRef.current += 1
    let requestFailed = false
    setBusy(true)
    setControlError("")
    setSnapshot((current) => optimisticMusicControl(current, request))
    window.setTimeout(() => {
      controlCooldownRef.current = false
      setBusy(false)
    }, 180)
    void window.azoria.music.control(request).then((next) => {
      if (requestId === controlRequestRef.current) setSnapshot(next)
    }).catch((error) => {
      if (requestId === controlRequestRef.current) {
        requestFailed = true
        setControlError(error instanceof Error ? error.message : "播放器控制失败")
      }
    }).finally(() => {
      controlInFlightRef.current = Math.max(0, controlInFlightRef.current - 1)
      if (requestId === controlRequestRef.current) {
        setSeekingMs(null)
        if (requestFailed) void refresh()
      }
    })
    return Promise.resolve()
  }, [refresh])

  const seekOrCalibrate = useCallback(async (linePositionMs: number) => {
    if (track?.controls.seek) {
      await runControl({ action: "seek", positionMs: linePositionMs })
      return
    }
    setSnapshot(await window.azoria.music.calibrate(linePositionMs))
  }, [runControl, track?.controls.seek])

  const positionLabel = track?.positionSource === "system" ? "系统精确进度"
    : track?.positionSource === "accessibility" ? "播放器精确进度"
      : track?.positionSource === "manual" ? "手动校准进度"
        : track?.positionSource === "estimated" ? "切歌时间估算"
          : "没有播放进度"

  return <Card className="lg:col-span-2">
    <CardHeader className="flex flex-row items-start justify-between space-y-0">
      <div className="min-w-0">
        <CardTitle className="flex items-center gap-2"><Music2 />音乐歌词</CardTitle>
        <CardDescription className="mt-2">{snapshot.message}</CardDescription>
      </div>
      <Button variant="outline" size="icon" disabled={loading} aria-label="刷新音乐信息" title="刷新" onClick={() => { setLoading(true); void refresh() }}><RefreshCw className={loading ? "animate-spin" : ""} /></Button>
    </CardHeader>
    <CardContent>
      {track ? <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
        <div className="space-y-4 rounded-lg border border-white/10 bg-black p-5">
          <div className="flex gap-4">
            <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-zinc-900 shadow-lg">
              {track.artworkUrl ? <img src={track.artworkUrl} alt={`${track.title} 封面`} className="size-full object-cover" draggable={false} /> : <Disc3 className={`size-10 text-zinc-600 ${track.status === "playing" ? "animate-spin" : ""}`} />}
            </div>
            <div className="min-w-0 self-center">
              <p className="truncate text-xl font-semibold" title={track.title}>{track.title}</p>
              <p className="mt-1 truncate text-sm text-zinc-400" title={track.artist}>{track.artist || "未知歌手"}</p>
              {track.album && track.album !== track.title && <p className="mt-1 truncate text-xs text-zinc-600" title={track.album}>{track.album}</p>}
              {track.trackId && <p className="mt-2 truncate font-mono text-[11px] text-zinc-600" title={track.trackId}>ID · {track.trackId}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-white/10">{sourceLabel(track.source)}</Badge>
            <Badge variant="outline" className="border-white/10">{track.status === "playing" ? "播放中" : track.status === "paused" ? "已暂停" : track.status === "stopped" ? "已停止" : "状态未知"}</Badge>
            {snapshot.provider && <Badge variant="outline" className="border-white/10">歌词：{snapshot.provider === "netease" ? "网易云" : snapshot.provider === "qqmusic" ? "QQ 音乐" : "LRCLIB"}</Badge>}
            {snapshot.provider && <Badge variant="outline" className="border-white/10">同步：{snapshot.syncReady ? "可用" : "需校准"}</Badge>}
          </div>
          <PlaybackControls track={track} positionMs={positionMs} busy={busy} onPositionChange={setSeekingMs} onControl={runControl} />
          <div className="text-xs text-zinc-500">{positionLabel}{track.source === "netease" ? ` · ${neteasePlaybackModeLabel(track)}` : <>{track.shuffleActive !== null ? ` · 随机${track.shuffleActive ? "开" : "关"}` : ""}{track.repeatMode !== "unknown" ? ` · ${track.repeatMode === "track" ? "单曲循环" : track.repeatMode === "list" ? "列表循环" : "循环关"}` : ""}</>}</div>
          {controlError && <p role="alert" className="text-xs text-red-400">{controlError}</p>}
          {track.positionSource === "estimated" && <p className="text-xs leading-5 text-zinc-500">当前播放器没有提供精确进度。点击右侧实际正在播放的歌词完成校准，之后会按播放/暂停状态继续计时。</p>}
          {track.positionSource === "manual" && <p className="text-xs leading-5 text-zinc-500">已手动校准；若之后拖动了播放器进度，可再次点击实际歌词重新校准。</p>}
          {snapshot.matchedTitle && <div className="border-t border-white/10 pt-4 text-xs text-zinc-500">匹配：{snapshot.matchedTitle}{snapshot.matchedArtist ? ` · ${snapshot.matchedArtist}` : ""}</div>}
        </div>
        <div className="h-[440px] overflow-y-auto rounded-lg border border-white/10 bg-zinc-950/60 px-6 py-8 text-center">
          {snapshot.lines.map((line, index) => <button type="button" key={`${line.timeMs}-${index}`} ref={index === currentIndex ? currentRef : undefined} title={track.controls.seek ? "点击跳转到这句歌词" : "点击将歌词进度校准到这句"} onClick={() => void seekOrCalibrate(line.timeMs)} className={`block w-full py-2 text-center transition-all hover:text-zinc-200 ${index === currentIndex ? "scale-105 text-base font-semibold text-white" : "text-sm text-zinc-500"}`}>{line.text}</button>)}
          {!snapshot.lines.length && snapshot.plainText && <p className="whitespace-pre-line text-sm leading-8 text-zinc-300">{snapshot.plainText}</p>}
          {!snapshot.lines.length && !snapshot.plainText && <div className="flex h-full items-center justify-center text-sm text-zinc-500">暂时没有可显示的歌词</div>}
        </div>
      </div> : <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-white/10 text-sm text-zinc-500">请先在网易云音乐或 QQ 音乐播放一首歌</div>}
    </CardContent>
  </Card>
}
