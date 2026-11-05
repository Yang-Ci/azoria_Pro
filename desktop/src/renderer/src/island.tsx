import { useEffect, useRef, useState } from "react"
import { ArrowUpRight, Disc3, Music2, Pause, Play, SkipBack, SkipForward, Sun, Volume2 } from "lucide-react"
import type { IslandSnapshot } from "../../shared/contracts"
import { currentLyricIndex, lyricLookAheadMs, MusicPlaybackTimeline } from "../../shared/music-timing"
import { Slider } from "@/components/ui/slider"

function MonitorSlider({ label, value, disabled, onCommit, onEditing }: { label: string; value: number; disabled: boolean; onCommit(value: number): void; onEditing(value: boolean): void }) {
  const [local, setLocal] = useState(value)
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setLocal(value) }, [value])
  return <div className="island-slider"><span className="island-slider-label">{label === "亮度" ? <Sun size={14} /> : <Volume2 size={14} />}{label}</span><Slider aria-label={label} value={[local]} max={100} step={1} disabled={disabled} onValueChange={values => { editing.current = true; onEditing(true); setLocal(values[0] ?? 0) }} onValueCommit={values => { editing.current = false; onEditing(false); onCommit(values[0] ?? 0) }} /><strong>{local}%</strong></div>
}

export function Island() {
  const timeline = useRef(new MusicPlaybackTimeline()).current
  const [expanded, setExpanded] = useState(false)
  const [snapshot, setSnapshot] = useState<IslandSnapshot | null>(null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inFlight = useRef(false)
  const editing = useRef(false)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      if (inFlight.current) return
      inFlight.current = true
      try { const value = await window.island.snapshot(); if (active) setSnapshot(value) }
      catch { if (active) setError("数据暂时不可用") }
      finally { inFlight.current = false }
    }
    void refresh()
    const poll = setInterval(() => void refresh(), 2000)
    const clock = setInterval(() => setNow(Date.now()), 500)
    return () => { active = false; clearInterval(poll); clearInterval(clock); clearTimeout(closeTimer.current) }
  }, [])
  const changeExpanded = (value: boolean) => { setExpanded(value); void window.island.expand(value).catch(() => setError("窗口调整失败")) }
  const perform = async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError("")
    try { await operation(); setSnapshot(await window.island.snapshot()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败") }
    finally { setBusy(false) }
  }
  const track = snapshot?.music.track
  const lyricIndex = track ? currentLyricIndex(snapshot?.music.lines ?? [], timeline.position(track) + lyricLookAheadMs) : -1
  const lyric = snapshot?.music.lines[lyricIndex]?.text
  const usage = snapshot?.usage
  const quota = usage?.usageCodexAvailable && usage.usagePrimaryRemaining >= 0 ? `${(usage.usagePrimaryRemaining / 10).toFixed(0)}%` : "--"
  const stale = !!usage && (usage.usageCodexStale || (!!usage.usagePrimaryResetsAt && usage.usagePrimaryResetsAt * 1000 <= now))
  return <div className={`island-shell ${expanded ? "is-expanded" : ""}`} onMouseEnter={() => { clearTimeout(closeTimer.current); if (!expanded) changeExpanded(true) }} onMouseLeave={() => { closeTimer.current = setTimeout(() => { if (!editing.current) changeExpanded(false) }, 350) }}>
    <div className="island-top" onClick={() => { if (!expanded) changeExpanded(true) }}>
      <div className="island-mark"><Music2 size={15} /></div><div className="island-summary"><strong>{track?.title || "YangCi 信息岛"}</strong><span>{track?.artist || "音乐 · 额度 · 显示器"}</span></div><div className={`island-quota ${stale ? "is-stale" : ""}`} title={stale ? "Codex 额度数据较旧" : "Codex 剩余额度"}>{quota}</div>
    </div>
    {expanded && <div className="island-content">
      <div className="island-music"><div className="island-art">{track?.artworkUrl ? <img src={track.artworkUrl} alt="" /> : <Disc3 size={29} />}</div><div className="island-track"><strong>{track?.title || "暂无播放"}</strong><span>{lyric || track?.artist || "播放音乐后将在这里显示歌词"}</span></div><div className="island-buttons">
        <button aria-label="上一首" disabled={busy || !track?.controls.previous} onClick={() => void perform(() => window.island.music("previous"))}><SkipBack size={17} /></button>
        <button className="island-play" aria-label={track?.status === "playing" ? "暂停" : "播放"} disabled={busy || !track || (track.status === "playing" ? !track.controls.pause : !track.controls.play)} onClick={() => void perform(() => window.island.music(track?.status === "playing" ? "pause" : "play"))}>{track?.status === "playing" ? <Pause size={16} /> : <Play size={16} />}</button>
        <button aria-label="下一首" disabled={busy || !track?.controls.next} onClick={() => void perform(() => window.island.music("next"))}><SkipForward size={17} /></button>
      </div></div>
      <div className="island-cards"><div className="island-card"><span>CODEX 额度{stale ? " · 数据较旧" : ""}</span><strong>{quota}</strong><small>{usage?.usagePrimaryMinutes ? `${usage.usagePrimaryMinutes >= 60 ? `${Math.round(usage.usagePrimaryMinutes / 60)} 小时` : `${usage.usagePrimaryMinutes} 分钟`}周期剩余` : "等待本机额度记录"}</small></div><div className="island-card"><span>{usage?.usageApiName || "API 余额"}{usage?.usageApiStale ? " · 数据较旧" : ""}</span><strong>{usage?.usageApiAvailable ? `${usage.usageApiCompact}${usage.usageApiScale}` : "--"}</strong><small>{usage?.usageApiPaused ? "已暂停" : usage?.usageApiError ? "更新失败" : usage?.usageApiUnit || "在主窗口配置服务"}</small></div></div>
      <div className="island-bottom"><div className="island-monitor"><span title={snapshot?.monitorName}>{snapshot?.monitorName || "显示器"}</span><strong>{snapshot?.monitorAvailable ? "" : "不可用"}</strong></div><div className="island-buttons"><button aria-label="打开 YangCi" title="打开 YangCi" onClick={() => void window.island.openMain()}><ArrowUpRight size={16} /></button></div></div>
      <MonitorSlider label="亮度" value={snapshot?.monitor.brightness ?? 0} disabled={busy || !snapshot?.monitorAvailable} onEditing={value => { editing.current = value }} onCommit={value => void perform(() => window.island.monitor("brightness", value))} />
      <MonitorSlider label="音量" value={snapshot?.monitor.volume ?? 0} disabled={busy || !snapshot?.monitorAvailable} onEditing={value => { editing.current = value }} onCommit={value => void perform(() => window.island.monitor("volume", value))} />
      {error && <div className="island-error" role="alert">{error}</div>}
    </div>}
  </div>
}
