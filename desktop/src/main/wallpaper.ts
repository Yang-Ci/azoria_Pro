import { createHash, randomInt } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ServerResponse } from "node:http"
import type { WallpaperIdleMinutes, WallpaperInfo, WallpaperKind, WallpaperSettings, WallpaperUpload, WallpaperLibraryItem, WallpaperLibrarySnapshot, WallpaperPlaybackSettings } from "../shared/contracts"

const headerSize = 20
const maxPackageSize = 24 * 1024 * 1024
const maxFrames = 120
const defaultIdleMinutes: WallpaperIdleMinutes = 5
const allowedIdleMinutes = new Set<number>([0, 1, 5, 10, 30])

type PackageValidation = {
  frameCount: number
  frameDelayMs: number
  durationMs: number
  format: "AZW1" | "AZW2" | "AZW3" | "AZW4"
}

function readUInt16(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8)
}

function readUInt32(data: Uint8Array, offset: number): number {
  return (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0
}

function validatePackage(data: Uint8Array, kind: WallpaperKind): PackageValidation {
  if (data.byteLength < headerSize + 8 || data.byteLength > maxPackageSize) throw new Error("壁纸包大小无效")
  const format = String.fromCharCode(...data.subarray(0, 4))
  const sourceWidth = readUInt16(data, 4)
  const sourceHeight = readUInt16(data, 6)
  if (!((format === "AZW1" && sourceWidth === 480 && sourceHeight === 480) ||
        (format === "AZW2" && sourceWidth === 240 && sourceHeight === 240) ||
        (format === "AZW3" && sourceWidth === 320 && sourceHeight === 320) ||
        (format === "AZW4" && sourceWidth === 480 && sourceHeight === 480))) {
    throw new Error("壁纸包格式无效")
  }
  const frameCount = readUInt16(data, 8)
  const frameDelayMs = readUInt16(data, 10)
  const payloadSize = readUInt32(data, 12)
  if (frameCount < 1 || frameCount > maxFrames || payloadSize !== data.byteLength - headerSize) throw new Error("壁纸帧信息无效")
  if ((kind === "image" && (frameCount !== 1 || frameDelayMs !== 0)) ||
      (kind === "video" && (frameCount < 2 || frameDelayMs < 100 || frameDelayMs > 2000)) ||
      (kind === "image" && format !== "AZW1")) {
    throw new Error("壁纸类型与动画帧不匹配")
  }
  let offset = headerSize
  for (let index = 0; index < frameCount; index++) {
    if (offset + 4 > data.byteLength) throw new Error("壁纸帧不完整")
    const length = readUInt32(data, offset)
    offset += 4
    if (length < 128 || length > 600_000 || offset + length > data.byteLength ||
        data[offset] !== 0xff || data[offset + 1] !== 0xd8 ||
        data[offset + length - 2] !== 0xff || data[offset + length - 1] !== 0xd9) {
      throw new Error("壁纸 JPEG 帧无效")
    }
    offset += length
  }
  if (offset !== data.byteLength) throw new Error("壁纸包包含多余数据")
  return { frameCount, frameDelayMs, durationMs: frameCount * frameDelayMs, format: format as PackageValidation["format"] }
}

export class WallpaperManager {
  private readonly settingsPath: string
  private readonly libraryDirectory: string
  private readonly manifestPath: string
  private items: WallpaperLibraryItem[] = []
  private activeId: string | null = null
  private playback: WallpaperPlaybackSettings = { enabled: false, intervalMinutes: 5, order: "sequential", playlist: [], schedules: [] }
  private currentSettings: WallpaperSettings = { idleMinutes: defaultIdleMinutes }
  private lastChangedAt = 0
  private lastCheckedAt = 0
  private error: string | null = null
  private loadFailed = false
  private timer?: NodeJS.Timeout
  private mutations: Promise<unknown> = Promise.resolve()

  constructor(private readonly directory: string, private readonly now: () => number = Date.now) {
    this.settingsPath = path.join(directory, "wallpaper-settings.json")
    this.libraryDirectory = path.join(directory, "wallpaper-library")
    this.manifestPath = path.join(this.libraryDirectory, "library.json")
  }

  async initialize(): Promise<void> {
    await mkdir(this.libraryDirectory, { recursive: true })
    this.lastChangedAt = this.lastCheckedAt = this.now()
    try {
      const parsed = JSON.parse(await readFile(this.settingsPath, "utf8")) as Partial<WallpaperSettings>
      if (typeof parsed.idleMinutes === "number" && allowedIdleMinutes.has(parsed.idleMinutes)) {
        this.currentSettings = { idleMinutes: parsed.idleMinutes as WallpaperIdleMinutes }
      }
    } catch {
      this.currentSettings = { idleMinutes: defaultIdleMinutes }
    }
    try {
      const manifest = JSON.parse(await readFile(this.manifestPath, "utf8"))
      if (manifest.version !== 1 || !Array.isArray(manifest.items) || manifest.items.length > 100) throw new Error("壁纸库格式无效")
      const restored: WallpaperLibraryItem[] = []
      for (const item of manifest.items) {
        if (!this.validInfo(item) || item.id !== item.sha256 || restored.some(entry => entry.id === item.id)) continue
        try { if ((await stat(this.itemPath(item.id))).size === item.size) restored.push(item) } catch { /* Missing assets are omitted. */ }
      }
      this.items = restored
      this.playback = this.validatePlayback(manifest.playback, true)
      this.activeId = restored.some(item => item.id === manifest.activeId) ? manifest.activeId : null
      if (this.activeId) {
        try { await this.readValidated(this.activeId) } catch { this.activeId = null; this.error = "当前壁纸文件损坏，请重新添加或选择其他壁纸。" }
      }
      this.lastChangedAt = typeof manifest.lastChangedAt === "number" && Number.isFinite(manifest.lastChangedAt)
        ? Math.min(this.now(), manifest.lastChangedAt) : this.now()
      return
    } catch (error) {
      // Never overwrite a damaged manifest with the legacy file or an empty library.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.loadFailed = true
        this.error = "壁纸库读取失败，原文件已保留。请恢复壁纸库文件后重启程序。"
        return
      }
    }
    try {
      const [data, raw] = await Promise.all([readFile(path.join(this.directory, "wallpaper.azw")), readFile(path.join(this.directory, "wallpaper.json"), "utf8")])
      const metadata = JSON.parse(raw) as WallpaperInfo
      if (!this.validInfo(metadata)) return
      this.verify(data, metadata)
      const item = { ...metadata, id: metadata.sha256 }
      await this.writeAsset(item.id, data)
      this.items = [item]
      this.activeId = item.id
      this.playback.playlist = [item.id]
    } catch { /* First launch or invalid legacy wallpaper. */ }
    await this.persist()
  }

  info(): WallpaperInfo | null {
    const current = this.items.find(item => item.id === this.activeId)
    return current ? { ...current } : null
  }

  settings(): WallpaperSettings {
    return { ...this.currentSettings }
  }

  async setIdleMinutes(minutes: number): Promise<WallpaperSettings> {
    if (!Number.isInteger(minutes) || !allowedIdleMinutes.has(minutes)) throw new Error("自动壁纸时间无效")
    return this.exclusive(async () => {
      const settings: WallpaperSettings = { idleMinutes: minutes as WallpaperIdleMinutes }
      await this.writeJson(this.settingsPath, settings)
      this.currentSettings = settings
      return { ...settings }
    })
  }

  async upload(input: WallpaperUpload): Promise<WallpaperInfo> {
    if (!input || typeof input.name !== "string" || input.name.length < 1 || input.name.length > 160 ||
        !["image", "video"].includes(input.kind) || !(input.data instanceof Uint8Array)) {
      throw new Error("壁纸上传参数无效")
    }
    const data = Buffer.from(input.data)
    const validation = validatePackage(data, input.kind)
    const hash = createHash("sha256").update(data).digest("hex")
    const info: WallpaperLibraryItem = {
      id: hash,
      name: path.basename(input.name),
      kind: input.kind,
      size: data.byteLength,
      sha256: hash,
      frameCount: validation.frameCount,
      durationMs: validation.durationMs,
      updatedAt: new Date().toISOString(),
    }
    return this.exclusive(async () => {
      const existing = this.items.find(item => item.id === info.id)
      if (!existing && this.items.length >= 100) throw new Error("壁纸库最多保存 100 张，请先删除不需要的壁纸。")
      await this.writeAsset(info.id, data)
      await this.commit({
        items: existing ? this.items.map(item => item.id === info.id ? info : item) : [info, ...this.items],
        activeId: info.id,
        playback: { ...this.playback, playlist: this.playback.playlist.includes(info.id) ? this.playback.playlist : [...this.playback.playlist, info.id] },
        lastChangedAt: this.now(),
      })
      return { ...info }
    })
  }

  async remove(): Promise<void> {
    await this.exclusive(() => this.commit({ activeId: null, playback: { ...this.playback, enabled: false, schedules: this.playback.schedules.map(rule => ({ ...rule, enabled: false })) }, lastChangedAt: this.now() }))
  }

  library(): WallpaperLibrarySnapshot {
    const now = this.now()
    const times: number[] = []
    if (this.playback.enabled && this.playback.playlist.length > 1) times.push(Math.max(now, this.lastChangedAt + this.playback.intervalMinutes * 60_000))
    for (const schedule of this.playback.schedules.filter(item => item.enabled)) {
      const due = this.scheduleTime(schedule.time, now)
      if (due <= now) { const date = new Date(due); date.setDate(date.getDate() + 1); times.push(date.getTime()) } else times.push(due)
    }
    return {
      items: this.items.map(item => ({ ...item })), activeId: this.activeId,
      playback: structuredClone(this.playback), error: this.error,
      nextSwitchAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    }
  }

  async preview(id: string): Promise<string> {
    this.find(id)
    const file = await open(this.itemPath(id), "r")
    try {
      const lengthData = Buffer.alloc(4)
      if ((await file.read(lengthData, 0, 4, headerSize)).bytesRead !== 4) throw new Error("壁纸预览读取失败")
      const length = lengthData.readUInt32LE()
      if (length < 128 || length > 600_000) throw new Error("壁纸预览无效")
      const jpeg = Buffer.alloc(length)
      if ((await file.read(jpeg, 0, length, headerSize + 4)).bytesRead !== length || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("壁纸预览读取失败")
      return `data:image/jpeg;base64,${jpeg.toString("base64")}`
    } finally { await file.close() }
  }

  activate(id: string): Promise<WallpaperLibrarySnapshot> {
    return this.exclusive(async () => { await this.switchTo(id, this.now()); return this.library() })
  }

  deleteItem(id: string): Promise<WallpaperLibrarySnapshot> {
    return this.exclusive(async () => {
      this.find(id)
      const items = this.items.filter(item => item.id !== id)
      const playlist = this.playback.playlist.filter(item => item !== id)
      const oldIndex = this.playback.playlist.indexOf(id)
      const activeId = this.activeId === id ? playlist[oldIndex >= 0 ? oldIndex % Math.max(1, playlist.length) : 0] ?? items[0]?.id ?? null : this.activeId
      if (activeId && activeId !== this.activeId) await this.readValidated(activeId)
      await this.commit({ items, activeId, playback: {
        ...this.playback, playlist, enabled: this.playback.enabled && playlist.length > 1,
        schedules: this.playback.schedules.filter(item => item.wallpaperId !== id),
      }, lastChangedAt: activeId !== this.activeId ? this.now() : this.lastChangedAt })
      // The manifest is committed first; an interrupted cleanup only leaves an unused asset.
      await rm(this.itemPath(id), { force: true })
      return this.library()
    })
  }

  setPlayback(input: WallpaperPlaybackSettings): Promise<WallpaperLibrarySnapshot> {
    return this.exclusive(async () => {
      const playback = this.validatePlayback(input)
      await this.commit({ playback, lastChangedAt: this.now() })
      this.lastCheckedAt = this.now()
      return this.library()
    })
  }

  next(): Promise<WallpaperLibrarySnapshot> {
    return this.exclusive(async () => { await this.advance(this.now()); return this.library() })
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.tick().catch(error => { this.error = error instanceof Error ? error.message : "壁纸切换失败" }) }, 10_000)
    this.timer.unref()
  }

  stop(): void { clearInterval(this.timer); this.timer = undefined }

  tick(now = this.now()): Promise<void> {
    return this.exclusive(async () => {
      let latest: { id: string; due: number } | undefined
      for (const schedule of this.playback.schedules.filter(item => item.enabled)) {
        const today = new Date(now)
        const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
        for (const date of [yesterday, today]) {
          const due = this.scheduleTime(schedule.time, date.getTime())
          if (due > this.lastCheckedAt && due <= now && (!latest || due > latest.due)) latest = { id: schedule.wallpaperId, due }
        }
      }
      if (latest) await this.switchTo(latest.id, now)
      else if (this.playback.enabled && now >= this.lastChangedAt + this.playback.intervalMinutes * 60_000) await this.advance(now)
      this.lastCheckedAt = now
    })
  }

  private scheduleTime(time: string, now: number): number {
    const [hours, minutes] = time.split(":").map(Number)
    const date = new Date(now)
    date.setHours(hours!, minutes!, 0, 0)
    return date.getTime()
  }

  private async advance(now: number): Promise<void> {
    const playlist = this.playback.playlist
    if (!playlist.length) return
    const alternatives = playlist.filter(id => id !== this.activeId)
    const id = this.playback.order === "random" && alternatives.length
      ? alternatives[randomInt(alternatives.length)]!
      : playlist[(playlist.indexOf(this.activeId ?? "") + 1) % playlist.length]!
    await this.switchTo(id, now)
  }

  private async switchTo(id: string, now: number): Promise<void> {
    await this.readValidated(id)
    await this.commit({ activeId: id, lastChangedAt: now })
  }

  private find(id: string): WallpaperLibraryItem {
    if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id)) throw new Error("壁纸标识无效")
    const item = this.items.find(item => item.id === id)
    if (!item) throw new Error("壁纸不存在，请刷新壁纸库。")
    return item
  }

  private itemPath(id: string): string {
    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("壁纸标识无效")
    return path.join(this.libraryDirectory, `${id}.azw`)
  }

  private validInfo(item: WallpaperInfo): boolean {
    return !!item && ["image", "video"].includes(item.kind) && typeof item.name === "string" && item.name.length > 0 && item.name.length <= 160 &&
      typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt)) && typeof item.sha256 === "string" && /^[0-9a-f]{64}$/.test(item.sha256) &&
      Number.isInteger(item.size) && item.size > 0 && item.size <= maxPackageSize
  }

  private verify(data: Uint8Array, info: WallpaperInfo): void {
    const validation = validatePackage(data, info.kind)
    if (createHash("sha256").update(data).digest("hex") !== info.sha256 || info.size !== data.byteLength ||
        info.frameCount !== validation.frameCount || info.durationMs !== validation.durationMs) throw new Error("壁纸文件校验失败，请重新添加。")
  }

  private async readValidated(id: string): Promise<Buffer> {
    const item = this.find(id)
    const data = await readFile(this.itemPath(id))
    this.verify(data, item)
    return data
  }

  private validatePlayback(input: WallpaperPlaybackSettings, restore = false): WallpaperPlaybackSettings {
    if (!input || typeof input.enabled !== "boolean" || !Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 1 || input.intervalMinutes > 1440 ||
        !["sequential", "random"].includes(input.order) || !Array.isArray(input.playlist) || input.playlist.length > 100 ||
        !Array.isArray(input.schedules) || input.schedules.length > 24) throw new Error("壁纸播放设置无效")
    const known = new Set(this.items.map(item => item.id))
    if (!restore && input.playlist.some(id => !known.has(id))) throw new Error("播放列表包含不存在的壁纸")
    const playlist = [...new Set(input.playlist.filter(id => known.has(id)))]
    const scheduleIds = new Set<string>()
    const enabledTimes = new Set<string>()
    const schedules = input.schedules.filter(item => {
      if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(item.id) || scheduleIds.has(item.id) ||
          typeof item.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time) || typeof item.enabled !== "boolean") throw new Error("定时切换规则无效")
      scheduleIds.add(item.id)
      if (item.enabled && enabledTimes.has(item.time)) throw new Error("同一时间只能启用一条壁纸切换规则")
      if (item.enabled) enabledTimes.add(item.time)
      if (!restore && !known.has(item.wallpaperId)) throw new Error("定时切换包含不存在的壁纸")
      return known.has(item.wallpaperId)
    }).map(item => ({ id: item.id, time: item.time, wallpaperId: item.wallpaperId, enabled: item.enabled }))
    if (!restore && input.enabled && playlist.length < 2) throw new Error("自动轮播至少需要两张壁纸")
    return { enabled: input.enabled && playlist.length > 1, intervalMinutes: input.intervalMinutes, order: input.order, playlist, schedules }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.loadFailed) return Promise.reject(new Error(this.error ?? "壁纸库读取失败"))
    const result = this.mutations.then(operation)
    this.mutations = result.catch(() => undefined)
    return result
  }

  private async writeAsset(id: string, data: Uint8Array): Promise<void> {
    const target = this.itemPath(id)
    await writeFile(`${target}.tmp`, data, { mode: 0o600 })
    await rename(`${target}.tmp`, target)
  }

  private async writeJson(target: string, data: unknown): Promise<void> {
    await writeFile(`${target}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 })
    await rename(`${target}.tmp`, target)
  }

  private persist(): Promise<void> {
    return this.writeJson(this.manifestPath, { version: 1, items: this.items, activeId: this.activeId, playback: this.playback, lastChangedAt: this.lastChangedAt })
  }

  private async commit(changes: Partial<{ items: WallpaperLibraryItem[]; activeId: string | null; playback: WallpaperPlaybackSettings; lastChangedAt: number }>): Promise<void> {
    const state = { items: this.items, activeId: this.activeId, playback: this.playback, lastChangedAt: this.lastChangedAt, ...changes }
    await this.writeJson(this.manifestPath, { version: 1, ...state })
    this.items = state.items; this.activeId = state.activeId; this.playback = state.playback; this.lastChangedAt = state.lastChangedAt
    this.error = null
  }

  stream(response: ServerResponse): void {
    const info = this.items.find(item => item.id === this.activeId)
    if (!info) {
      response.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" })
      response.end(JSON.stringify({ ok: false, error: "wallpaper not found" }))
      return
    }
    response.writeHead(200, {
      "Content-Type": "application/vnd.azoria.wallpaper",
      "Content-Length": String(info.size),
      "Cache-Control": "no-store",
      "X-Azoria-SHA256": info.sha256,
    })
    const stream = createReadStream(this.itemPath(info.id))
    stream.on("error", () => response.destroy())
    stream.pipe(response)
  }
}
