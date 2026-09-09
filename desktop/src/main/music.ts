import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { promisify } from "node:util"
import type { LyricLine, LyricsProvider, MusicControlRequest, MusicControls, MusicSnapshot, MusicSource, MusicTrack } from "../shared/contracts"

const run = promisify(execFile)
const requestHeaders = {
  "User-Agent": "YangCi/0.2.0 (https://github.com/Yang-Ci/azoria_Pro)",
  Referer: "https://music.163.com/",
}

interface SidecarResponse { ok: boolean; result?: unknown; error?: string }
interface CachedLyrics { provider: MusicSnapshot["provider"]; lines: LyricLine[]; plainText: string; matchedTitle: string; matchedArtist: string }
interface PlaybackClock { key: string; positionMs: number; updatedAt: number; status: MusicTrack["status"]; source: MusicTrack["positionSource"] }
interface ArtworkCache { url: string; checkedAt: number }

const noControls: MusicControls = { play: false, pause: false, previous: false, next: false, seek: false, shuffle: false, repeat: false }

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function sourceName(sourceAppId: string): MusicTrack["source"] {
  const value = sourceAppId.toLowerCase()
  if (value.includes("qqmusic")) return "qqmusic"
  if (value.includes("qq音乐")) return "qqmusic"
  if (value.includes("cloudmusic") || value.includes("netease") || value.includes("网易云")) return "netease"
  return "other"
}

export function lyricProviderOrder(source: MusicSource): LyricsProvider[] {
  if (source === "netease") return ["netease", "qqmusic", "lrclib"]
  if (source === "qqmusic") return ["qqmusic", "netease", "lrclib"]
  return ["lrclib", "netease", "qqmusic"]
}

function sourceLabel(source: MusicTrack["source"]): string {
  if (source === "qqmusic") return "QQ 音乐"
  if (source === "netease") return "网易云音乐"
  return "Windows 媒体"
}

export function parseSyncedLyrics(raw: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const row of raw.replace(/\r/g, "").split("\n")) {
    const timestamps = [...row.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (!timestamps.length) continue
    const content = row.replace(/\[[^\]]*\]/g, "").trim()
    if (!content) continue
    for (const match of timestamps) {
      const fraction = (match[3] ?? "0").padEnd(3, "0").slice(0, 3)
      lines.push({ timeMs: Number(match[1]) * 60_000 + Number(match[2]) * 1000 + Number(fraction), text: content })
    }
  }
  return lines.sort((left, right) => left.timeMs - right.timeMs)
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[\s·・,，.。!！?？'"“”‘’\-_/]/g, "")
}

function coreTitle(value: string): string {
  return normalized(value.replace(/[（(][^）)]*[）)]/g, ""))
}

export function matchScore(track: Pick<MusicTrack, "title" | "artist">, title: string, artist: string): number {
  const wantedTitle = normalized(track.title)
  const wantedCore = coreTitle(track.title)
  const candidateTitle = normalized(title)
  const candidateCore = coreTitle(title)
  const wantedArtist = normalized(track.artist)
  const candidateArtist = normalized(artist)
  let score = 0
  if (wantedTitle === candidateTitle) score += 8
  else if (wantedCore && wantedCore === candidateCore) score += 6
  else if (wantedCore && (candidateCore.includes(wantedCore) || wantedCore.includes(candidateCore))) score += 3
  if (wantedArtist && candidateArtist === wantedArtist) score += 5
  else if (wantedArtist && candidateArtist && (candidateArtist.includes(wantedArtist) || wantedArtist.includes(candidateArtist))) score += 2
  else if (wantedArtist && candidateArtist) score -= 4
  return score
}

export function selectMediaSession(
  sessions: Array<Record<string, unknown>>,
  previous?: Pick<MusicTrack, "title" | "artist" | "source">,
): Record<string, unknown> | undefined {
  const candidates = sessions.filter((session) => Boolean(text(session.title)))
  const playing = candidates.find((session) => session.status === "playing")
  if (playing) return playing
  if (previous) {
    const sameTrack = candidates.find((session) => sourceName(text(session.sourceAppId)) === previous.source
      && normalized(text(session.title)) === normalized(previous.title)
      && normalized(text(session.artist)) === normalized(previous.artist))
    if (sameTrack) return sameTrack
    const samePlayer = candidates.find((session) => sourceName(text(session.sourceAppId)) === previous.source)
    if (samePlayer) return samePlayer
  }
  return candidates.find((session) => session.status === "paused") ?? candidates[0]
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(url, { ...init, headers: { ...requestHeaders, ...init?.headers }, signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function fromLrclib(track: MusicTrack): Promise<CachedLyrics | null> {
  const query = new URLSearchParams({ track_name: track.title, artist_name: track.artist })
  const payload = await fetchJson(`https://lrclib.net/api/search?${query}`)
  if (!Array.isArray(payload)) return null
  const candidates = payload.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    .map((entry) => ({ entry, score: matchScore(track, text(entry.trackName), text(entry.artistName)) }))
    .sort((left, right) => right.score - left.score)
  const best = candidates[0]
  if (!best || best.score < 6) return null
  const synced = text(best.entry.syncedLyrics)
  const plain = text(best.entry.plainLyrics)
  const lines = parseSyncedLyrics(synced)
  if (!lines.length && !plain) return null
  return { provider: "lrclib", lines, plainText: plain, matchedTitle: text(best.entry.trackName), matchedArtist: text(best.entry.artistName) }
}

async function fromNetease(track: MusicTrack): Promise<CachedLyrics | null> {
  const directId = neteaseSongId(track.trackId)
  if (directId) {
    const lyricPayload = await fetchJson(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(directId)}&lv=1&kv=1&tv=-1`) as {
      lrc?: { lyric?: unknown }
    }
    const raw = text(lyricPayload.lrc?.lyric)
    const lines = parseSyncedLyrics(raw)
    if (lines.length) return {
      provider: "netease",
      lines,
      plainText: lines.map((line) => line.text).join("\n"),
      matchedTitle: track.title,
      matchedArtist: track.artist,
    }
  }
  const body = new URLSearchParams({ s: `${track.title} ${track.artist}`.trim(), type: "1", limit: "10", offset: "0" })
  const payload = await fetchJson("https://music.163.com/api/search/get", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }) as { result?: { songs?: Array<Record<string, unknown>> } }
  const songs = Array.isArray(payload.result?.songs) ? payload.result.songs : []
  const candidates = songs.map((song) => {
    const artists = Array.isArray(song.artists) ? song.artists as Array<Record<string, unknown>> : []
    const artist = artists.map((item) => text(item.name)).filter(Boolean).join("/")
    return { song, artist, score: matchScore(track, text(song.name), artist) }
  }).sort((left, right) => right.score - left.score)
  const best = candidates[0]
  if (!best || best.score < 6 || (!Number.isInteger(best.song.id) && typeof best.song.id !== "string")) return null
  const lyricPayload = await fetchJson(`https://music.163.com/api/song/lyric?id=${encodeURIComponent(String(best.song.id))}&lv=1&kv=1&tv=-1`) as {
    lrc?: { lyric?: unknown }
  }
  const raw = text(lyricPayload.lrc?.lyric)
  const lines = parseSyncedLyrics(raw)
  if (!lines.length) return null
  return { provider: "netease", lines, plainText: lines.map((line) => line.text).join("\n"), matchedTitle: text(best.song.name), matchedArtist: best.artist }
}

export function neteaseSongId(trackId: string): string | null {
  return /^NCM-(\d+)$/i.exec(trackId.trim())?.[1] ?? null
}

function decodeEntities(value: string): string {
  return value.replace(/&#58;/g, ":").replace(/&#46;/g, ".").replace(/&apos;/g, "'")
    .replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
}

async function fromQqMusic(track: MusicTrack): Promise<CachedLyrics | null> {
  const query = new URLSearchParams({ format: "json", key: `${track.title} ${track.artist}`.trim() })
  const payload = await fetchJson(`https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?${query}`, {
    headers: { Referer: "https://y.qq.com/" },
  }) as { data?: { song?: { itemlist?: Array<Record<string, unknown>> } } }
  const songs = Array.isArray(payload.data?.song?.itemlist) ? payload.data.song.itemlist : []
  const candidates = songs.map((song) => ({
    song,
    score: matchScore(track, text(song.name), text(song.singer)),
  })).sort((left, right) => right.score - left.score)
  const best = candidates[0]
  const songMid = text(best?.song.mid)
  if (!best || best.score < 6 || !/^[A-Za-z0-9]{8,32}$/.test(songMid)) return null
  const lyricQuery = new URLSearchParams({ songmid: songMid, format: "json", nobase64: "1" })
  const lyricPayload = await fetchJson(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${lyricQuery}`, {
    headers: { Referer: "https://y.qq.com/" },
  }) as { lyric?: unknown }
  const raw = decodeEntities(text(lyricPayload.lyric))
  const lines = parseSyncedLyrics(raw)
  if (!lines.length) return null
  return {
    provider: "qqmusic",
    lines,
    plainText: lines.map((line) => line.text).join("\n"),
    matchedTitle: text(best.song.name),
    matchedArtist: text(best.song.singer),
  }
}

export class MusicManager {
  private cache = new Map<string, CachedLyrics>()
  private clock?: PlaybackClock
  private lastTrack?: MusicTrack
  private unknownSince?: number
  private artwork = new Map<string, ArtworkCache>()
  private latestSnapshot: MusicSnapshot = { available: false, track: null, provider: null, lines: [], plainText: "", message: "正在检测音乐播放器", syncReady: false }
  private pollTimer?: NodeJS.Timeout
  private pollInFlight = false
  private snapshotInFlight?: Promise<MusicSnapshot>

  constructor(private readonly sidecarBinary: string) {}

  startPolling(): void {
    if (this.pollTimer) return
    const update = () => {
      if (this.pollInFlight) return
      this.pollInFlight = true
      void this.snapshot().finally(() => { this.pollInFlight = false })
    }
    update()
    this.pollTimer = setInterval(update, 750)
    this.pollTimer.unref()
  }

  touchStatus(): Record<string, unknown> {
    const track = this.latestSnapshot.track
    const clean = (value: string, maxBytes: number) => {
      const normalizedValue = value.replace(/[\\"|\r\n]/g, " ").trim()
      let result = ""
      for (const character of normalizedValue) {
        if (Buffer.byteLength(result + character, "utf8") > maxBytes) break
        result += character
      }
      return result
    }
    const mode = track?.shuffleActive ? "shuffle"
      : track?.repeatMode === "track" ? "track"
        : track?.repeatMode === "list" ? "list"
          : track?.repeatMode === "none" ? "order" : "unknown"
    const now = Date.now()
    const elapsed = track?.status === "playing" && track.sampledAt > 0
      ? Math.max(0, now - track.sampledAt) * track.playbackRate
      : 0
    const projectedPosition = track ? track.positionMs + elapsed : 0
    const positionMs = track?.durationMs
      ? Math.min(projectedPosition, track.durationMs)
      : projectedPosition
    let lyricIndex = -1
    for (let index = this.latestSnapshot.lines.length - 1; index >= 0; index--) {
      if ((this.latestSnapshot.lines[index]?.timeMs ?? Number.MAX_SAFE_INTEGER) <= positionMs) {
        lyricIndex = index
        break
      }
    }
    const lyrics = this.latestSnapshot.lines
    return {
      musicAvailable: Boolean(track),
      musicTitle: clean(track?.title ?? "", 72),
      musicArtist: clean(track?.artist ?? "", 48),
      musicPlaying: track?.status === "playing",
      musicMode: mode,
      musicSource: track?.source ?? "other",
      musicPositionMs: Math.max(0, Math.round(positionMs)),
      musicDurationMs: Math.max(0, Math.round(track?.durationMs ?? 0)),
      musicLyricPrevious: clean(lyricIndex > 0 ? lyrics[lyricIndex - 1]?.text ?? "" : "", 108),
      musicLyricCurrent: clean(lyricIndex >= 0 ? lyrics[lyricIndex]?.text ?? "" : "", 108),
      musicLyricNext: clean(lyrics[lyricIndex + 1]?.text ?? "", 108),
    }
  }

  private async sidecar(request: Record<string, unknown>, maxBuffer = 256 * 1024): Promise<unknown> {
    const { stdout } = await run(this.sidecarBinary, [JSON.stringify(request)], {
      timeout: 5000,
      windowsHide: true,
      maxBuffer,
    })
    const response = JSON.parse(stdout) as SidecarResponse
    if (!response.ok) throw new Error(response.error || "媒体组件请求失败")
    return response.result
  }

  private sessions(result: unknown): Array<Record<string, unknown>> {
    if (!result || typeof result !== "object") return []
    const value = result as Record<string, unknown>
    return Array.isArray(value.sessions)
      ? value.sessions.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : [value]
  }

  private async currentTrack(): Promise<MusicTrack | null> {
    if (!existsSync(this.sidecarBinary)) throw new Error("媒体检测组件不可用")
    const sessions = this.sessions(await this.sidecar({ operation: "current_media" }))
    const value = selectMediaSession(sessions, this.lastTrack)
    if (!value) return null
    const title = text(value.title)
    if (!title) return null
    const sourceAppId = text(value.sourceAppId)
    const key = `${sourceName(sourceAppId)}\u0000${normalized(title)}\u0000${normalized(text(value.artist))}`
    const trackId = text(value.trackId)
    const artworkKey = trackId || key
    let artwork = this.artwork.get(artworkKey)
    if (!artwork || (!artwork.url && Date.now() - artwork.checkedAt > 30_000)) {
      try {
        const withArtwork = this.sessions(await this.sidecar({ operation: "current_media", include_artwork: true }, 12 * 1024 * 1024))
        const artworkSession = withArtwork.find((session) => text(session.sourceAppId).toLowerCase() === sourceAppId.toLowerCase()
          && normalized(text(session.title)) === normalized(title))
        artwork = { url: text(artworkSession?.artworkUrl), checkedAt: Date.now() }
      } catch {
        artwork = { url: "", checkedAt: Date.now() }
      }
      this.artwork.set(artworkKey, artwork)
    }
    let status: MusicTrack["status"] = value.status === "playing" ? "playing"
      : value.status === "paused" ? "paused" : value.status === "stopped" ? "stopped" : "unknown"
    if (status === "unknown") {
      this.unknownSince ??= Date.now()
      if (this.clock?.key === key && this.clock.status === "playing" && Date.now() - this.unknownSince < 2500) status = "playing"
    } else {
      this.unknownSince = undefined
    }
    const rawPosition = typeof value.positionMs === "number" && Number.isFinite(value.positionMs) ? Math.max(0, value.positionMs) : null
    const rawDuration = typeof value.durationMs === "number" && Number.isFinite(value.durationMs) ? Math.max(0, value.durationMs) : 0
    const sampledAt = typeof value.sampledAt === "number" && Number.isFinite(value.sampledAt) ? value.sampledAt : Date.now()
    const playbackRate = typeof value.playbackRate === "number" && Number.isFinite(value.playbackRate) ? value.playbackRate : 1
    const reportedSource = value.positionSource === "system" || value.positionSource === "accessibility" ? value.positionSource : null
    const rawControls = value.controls && typeof value.controls === "object" ? value.controls as Record<string, unknown> : {}
    const reportedShuffle = typeof value.shuffleActive === "boolean" ? value.shuffleActive : undefined
    const reportedRepeat = value.repeatMode === "none" || value.repeatMode === "track" || value.repeatMode === "list" ? value.repeatMode : undefined
    const controls: MusicControls = {
      play: rawControls.play === true,
      pause: rawControls.pause === true,
      previous: rawControls.previous === true,
      next: rawControls.next === true,
      seek: rawControls.seek === true,
      shuffle: rawControls.shuffle === true,
      repeat: rawControls.repeat === true,
    }
    if (!this.clock || this.clock.key !== key) {
      this.clock = { key, positionMs: rawPosition ?? 0, updatedAt: rawPosition === null ? Date.now() : sampledAt, status, source: reportedSource ?? "estimated" }
    } else if (rawPosition !== null && reportedSource) {
      this.clock = { key, positionMs: rawPosition, updatedAt: sampledAt, status, source: reportedSource }
    } else {
      const elapsed = this.clock.status === "playing" ? Math.max(0, Date.now() - this.clock.updatedAt) : 0
      this.clock = {
        ...this.clock,
        source: this.clock.source === "manual" ? "manual" : "estimated",
        positionMs: this.clock.positionMs + elapsed * playbackRate,
        updatedAt: Date.now(),
        status,
      }
    }
    const positionMs = this.clock.positionMs
    const track: MusicTrack = {
      title,
      artist: text(value.artist),
      album: text(value.album),
      trackId,
      artworkUrl: artwork?.url ?? "",
      sourceAppId,
      source: sourceName(sourceAppId),
      status,
      positionMs: rawDuration > 0 ? Math.min(positionMs, rawDuration) : positionMs,
      durationMs: rawDuration,
      playbackRate,
      sampledAt: this.clock.updatedAt,
      positionSource: this.clock.source,
      shuffleActive: reportedShuffle ?? null,
      repeatMode: reportedRepeat ?? "unknown",
      controls: sourceAppId ? controls : noControls,
      detectedBy: value.detectedBy === "window" || value.detectedBy === "mpris" || value.detectedBy === "mediaremote" || value.detectedBy === "app-script" ? value.detectedBy : "smtc",
    }
    this.lastTrack = track
    return track
  }

  private async findLyrics(track: MusicTrack): Promise<CachedLyrics | null> {
    const key = `${track.trackId || "unknown"}\u0000${normalized(track.title)}\u0000${normalized(track.artist)}`
    if (this.cache.has(key)) return this.cache.get(key) ?? null
    const providers = { netease: fromNetease, qqmusic: fromQqMusic, lrclib: fromLrclib }
    for (const providerId of lyricProviderOrder(track.source)) {
      try {
        const lyrics = await providers[providerId](track)
        if (lyrics) { this.cache.set(key, lyrics); return lyrics }
      } catch { /* Try the next provider. */ }
    }
    return null
  }

  async calibrate(positionMs: number): Promise<MusicSnapshot> {
    if (!this.clock || !this.lastTrack || !Number.isFinite(positionMs) || positionMs < 0 || positionMs > 86_400_000) {
      throw new Error("歌词定位位置无效")
    }
    this.clock = { ...this.clock, positionMs, updatedAt: Date.now(), source: "manual" }
    return this.snapshot()
  }

  async control(request: MusicControlRequest): Promise<MusicSnapshot> {
    if (!this.lastTrack?.sourceAppId || !request || typeof request !== "object") throw new Error("没有可控制的音乐播放器")
    const allowed = new Set(["play", "pause", "previous", "next", "seek", "set-shuffle", "set-repeat", "cycle-repeat", "toggle-shuffle", "cycle-play-mode"])
    if (!allowed.has(request.action)) throw new Error("媒体控制操作无效")
    if (request.action === "seek" && (!Number.isFinite(request.positionMs) || request.positionMs < 0 || request.positionMs > 86_400_000)) {
      throw new Error("播放位置无效")
    }
    const payload: Record<string, unknown> = {
      operation: "control_media",
      source_app_id: this.lastTrack.sourceAppId,
      action: request.action,
    }
    if (request.action === "cycle-play-mode") {
      if (process.platform !== "win32" || this.lastTrack.source !== "netease") throw new Error("当前播放器不支持组合播放模式切换")
      const sessions = this.sessions(await this.sidecar({ operation: "current_media" }))
      const current = sessions.find((session) => text(session.sourceAppId).toLowerCase() === String(payload.source_app_id).toLowerCase())
      const shuffleActive = typeof current?.shuffleActive === "boolean" ? current.shuffleActive : this.lastTrack.shuffleActive
      const repeatMode = current?.repeatMode === "none" || current?.repeatMode === "list" || current?.repeatMode === "track"
        ? current.repeatMode : this.lastTrack.repeatMode
      // InfLink only forwards a request when the supplied SMTC value differs
      // from the published value, then advances NetEase's internal mode once.
      if (shuffleActive === true) {
        payload.action = "set-repeat"
        payload.repeat_mode = "none"
      } else if (repeatMode === "track") {
        payload.action = "set-shuffle"
        payload.enabled = true
      } else if (repeatMode === "list") {
        payload.action = "set-repeat"
        payload.repeat_mode = "track"
      } else if (repeatMode === "none") {
        payload.action = "set-repeat"
        payload.repeat_mode = "list"
      } else {
        payload.action = "cycle-repeat"
      }
    }
    if (request.action === "cycle-repeat" || request.action === "toggle-shuffle") {
      if (request.action === "cycle-repeat") {
        if (process.platform === "win32" && this.lastTrack.source === "netease") {
          // InfLink maps every SMTC repeat-change request to the player's own
          // toggleRepeat action. Let NetEase advance from its real internal state.
          payload.action = "cycle-repeat"
        } else {
          const sessions = this.sessions(await this.sidecar({ operation: "current_media" }))
          const current = sessions.find((session) => text(session.sourceAppId).toLowerCase() === String(payload.source_app_id).toLowerCase())
          if (!current || !["none", "list", "track"].includes(String(current.repeatMode))) throw new Error("播放器未提供当前循环模式，请在播放器内切换")
          payload.action = "set-repeat"
          payload.repeat_mode = current.repeatMode === "none" ? "list" : current.repeatMode === "list" ? "track" : "none"
        }
      } else {
        const sessions = this.sessions(await this.sidecar({ operation: "current_media" }))
        const current = sessions.find((session) => text(session.sourceAppId).toLowerCase() === String(payload.source_app_id).toLowerCase())
        if (typeof current?.shuffleActive !== "boolean") throw new Error("播放器未提供当前随机模式，请在播放器内切换")
        payload.action = "set-shuffle"
        payload.enabled = !current.shuffleActive
      }
    }
    if (request.action === "seek") payload.position_ms = Math.round(request.positionMs)
    if (request.action === "set-shuffle") payload.enabled = request.enabled
    if (request.action === "set-repeat") payload.repeat_mode = request.repeatMode
    const result = await this.sidecar(payload)
    if (!result || typeof result !== "object" || (result as Record<string, unknown>).acknowledged !== true) {
      throw new Error("播放器没有执行此操作")
    }
    if (this.clock && request.action === "seek") {
      this.clock = { ...this.clock, positionMs: request.positionMs, updatedAt: Date.now(), source: "system" }
    } else if (this.clock && (request.action === "play" || request.action === "pause")) {
      this.clock = { ...this.clock, updatedAt: Date.now(), status: request.action === "play" ? "playing" : "paused" }
    }
    await new Promise((resolve) => setTimeout(resolve, 120))
    const pendingSnapshot = this.snapshotInFlight
    if (pendingSnapshot) await pendingSnapshot.catch(() => undefined)
    return this.snapshot()
  }

  snapshot(): Promise<MusicSnapshot> {
    if (this.snapshotInFlight) return this.snapshotInFlight
    const request = this.collectSnapshot()
    this.snapshotInFlight = request
    void request.finally(() => {
      if (this.snapshotInFlight === request) this.snapshotInFlight = undefined
    })
    return request
  }

  private async collectSnapshot(): Promise<MusicSnapshot> {
    let snapshot: MusicSnapshot
    try {
      const track = await this.currentTrack()
      if (!track) snapshot = { available: false, track: null, provider: null, lines: [], plainText: "", message: "没有检测到正在播放的音乐", syncReady: false }
      else {
        const lyrics = await this.findLyrics(track)
        if (!lyrics) snapshot = { available: true, track, provider: null, lines: [], plainText: "", message: `已识别 ${sourceLabel(track.source)}，暂未匹配到歌词`, syncReady: false }
        else {
          const providerLabel = lyrics.provider === "netease" ? "网易云音乐" : lyrics.provider === "qqmusic" ? "QQ 音乐" : "LRCLIB"
          const syncReady = track.positionSource === "system"
            || track.positionSource === "accessibility"
            || track.positionSource === "manual"
          snapshot = { available: true, track, ...lyrics, message: `已从${providerLabel}获取歌词`, syncReady }
        }
      }
    } catch (error) {
      snapshot = { available: false, track: null, provider: null, lines: [], plainText: "", message: error instanceof Error ? error.message : "媒体检测失败", syncReady: false }
    }
    this.latestSnapshot = snapshot
    return snapshot
  }
}
