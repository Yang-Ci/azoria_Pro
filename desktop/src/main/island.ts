import { readFile } from "node:fs/promises"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import path from "node:path"
import { BrowserWindow, screen } from "electron"
import type { IslandSettings, IslandSettingsSnapshot, IslandSnapshot, MusicControlRequest } from "../shared/contracts"
import { writeAtomicJson } from "./atomic-json"

export function isIslandSupported(platform: NodeJS.Platform, session: string | undefined, display: string | undefined): boolean {
  return platform === "win32" || (platform === "linux" && session !== "wayland" && !!display)
}

/** The selected screen is independent of the display controlled by DDC. */
export class IslandWindow {
  private settings: IslandSettings = { enabled: false, displayId: "primary", style: "daozai" }
  private window?: BrowserWindow
  private natives = new Map<string, { child: ChildProcessWithoutNullStreams; geometry: string; mirror: boolean }>()
  private nativeTimer?: NodeJS.Timeout
  private nativePending = false
  private expanded = false
  private queue: Promise<unknown> = Promise.resolve()
  private readonly filename: string
  readonly supported = isIslandSupported(process.platform, process.env.XDG_SESSION_TYPE, process.env.DISPLAY)

  constructor(private readonly userData: string, private readonly development: boolean, private readonly services?: {
    snapshot(): Promise<IslandSnapshot>
    monitor(control: "brightness" | "volume", value: number): Promise<unknown>
    music(request: MusicControlRequest): Promise<unknown>
    notify(title: string, body: string, sound: boolean): void
    setAutostart(enabled: boolean): Promise<unknown>
    stopped?(): void
  }) {
    this.filename = path.join(userData, "island-settings.json")
  }

  async initialize(): Promise<void> {
    try {
      const value = JSON.parse(await readFile(this.filename, "utf8")) as IslandSettings
      if (typeof value.enabled === "boolean" && typeof value.displayId === "string" && value.displayId.length <= 64) {
        const displayIds = Array.isArray(value.displayIds) ? [...new Set(value.displayIds.filter(id => typeof id === "string" && id.length > 0 && id.length <= 64))].slice(0, 16) : []
        this.settings = { enabled: value.enabled, displayId: value.displayId === "multiple" && !displayIds.length ? "primary" : value.displayId, style: value.style === "pill" ? "pill" : "daozai", ...(value.displayId === "multiple" && displayIds.length ? { displayIds } : {}) }
      }
    } catch { /* Missing or invalid settings leave the island disabled. */ }
    screen.on("display-added", this.reposition)
    screen.on("display-removed", this.reposition)
    screen.on("display-metrics-changed", this.reposition)
    this.apply()
  }

  snapshot(): IslandSettingsSnapshot {
    return { ...this.settings, supported: this.supported, nativeDisplaySelection: process.platform === "linux", primaryDisplayId: String(screen.getPrimaryDisplay().id), displays: screen.getAllDisplays().map((display, index) => ({ id: String(display.id), label: display.label || `显示器 ${index + 1}` })) }
  }

  update(input: IslandSettings): Promise<IslandSettingsSnapshot> {
    const displays = screen.getAllDisplays().map(display => String(display.id))
    if (!input || typeof input.enabled !== "boolean" || !["pill", "daozai"].includes(input.style) || typeof input.displayId !== "string" || input.displayId.length > 64 || (["all", "multiple"].includes(input.displayId) && (input.style !== "daozai" || process.platform !== "linux")) || (!["primary", "all", "multiple"].includes(input.displayId) && input.displayId !== this.settings.displayId && !displays.includes(input.displayId))) throw new Error("信息岛设置无效")
    if (input.displayId === "multiple" && (!Array.isArray(input.displayIds) || input.displayIds.length < 1 || input.displayIds.length > 16 || new Set(input.displayIds).size !== input.displayIds.length || input.displayIds.some(id => typeof id !== "string" || !id || id.length > 64 || (!displays.includes(id) && !this.settings.displayIds?.includes(id))))) throw new Error("请至少选择一个有效的显示器")
    if (input.enabled && !this.supported) throw new Error("信息岛目前支持 Windows 和 Linux X11 桌面")
    if (input.enabled && input.style === "daozai" && (!this.services || !existsSync(this.nativePath()))) throw new Error("岛仔组件未安装，请重新安装 YangCi")
    const next = { enabled: input.enabled, displayId: input.displayId, style: input.style, ...(input.displayId === "multiple" ? { displayIds: [...input.displayIds!] } : {}) }
    const operation = this.queue.then(async () => {
      await writeAtomicJson(this.filename, next)
      this.settings = next
      this.apply()
      return this.snapshot()
    })
    this.queue = operation.catch(() => undefined)
    return operation
  }

  owns(sender: Electron.WebContents): boolean { return !!this.window && !this.window.isDestroyed() && this.window.webContents === sender }
  openNativeSettings(): void {
    const child = [...this.natives.values()].find(entry => !entry.mirror)?.child
    if (child && !child.stdin.destroyed) child.stdin.write(`${JSON.stringify({ command: "open-settings" })}\n`)
  }
  setExpanded(expanded: boolean): void { this.expanded = expanded; this.reposition() }
  dispose(): void {
    screen.removeListener("display-added", this.reposition)
    screen.removeListener("display-removed", this.reposition)
    screen.removeListener("display-metrics-changed", this.reposition)
    this.window?.destroy()
    this.window = undefined
    this.stopNative()
  }

  private nativePath(): string {
    const executable = process.platform === "win32" ? "daozai.exe" : "daozai"
    return this.development ? path.resolve(process.cwd(), "desktop/daozai/target/release", executable) : path.join(process.resourcesPath, "daozai", executable)
  }

  private stopNative(): void {
    clearInterval(this.nativeTimer); this.nativeTimer = undefined
    const entries = [...this.natives.values()]; this.natives.clear()
    for (const { child } of entries) if (!child.killed) { child.stdin.end(); child.kill() }
  }

  private mirrorDirectory(id: string): string {
    const key = createHash("sha256").update(id).digest("hex").slice(0, 16)
    const dir = path.join(this.userData, "island-displays", key)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    if (!existsSync(path.join(dir, "ai-quota.json"))) {
      const source = process.env.DAOZAI_DATA_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "Daozai")
      const settings = path.join(source, "settings.txt")
      if (existsSync(settings) && !existsSync(path.join(dir, "settings.txt"))) copyFileSync(settings, path.join(dir, "settings.txt"))
      let initialQuota: Record<string, unknown> = {}
      try {
        const quota = JSON.parse(readFileSync(path.join(source, "ai-quota.json"), "utf8"))
        if (typeof quota.enabled === "boolean") initialQuota.enabled = quota.enabled
        if (typeof quota.compact === "boolean") initialQuota.compact = quota.compact
      } catch { /* Use defaults if there is no existing quota preference. */ }
      writeFileSync(path.join(dir, "ai-quota.json"), JSON.stringify(initialQuota), { mode: 0o600, flag: "wx" })
    }
    return dir
  }

  private startNative(id: string, geometry: string, mirror: boolean): void {
    if (!this.services || !existsSync(this.nativePath())) return
    const args = ["--yangci-managed", ...(geometry ? [`--yangci-position=${geometry}`] : []), ...(mirror ? ["--yangci-mirror"] : [])]
    const env = { ...process.env, ...(process.platform === "linux" ? { WINIT_UNIX_BACKEND: "x11" } : {}), ...(mirror ? { DAOZAI_DATA_DIR: this.mirrorDirectory(id) } : {}) }
    const child = spawn(this.nativePath(), args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env })
    this.natives.set(id, { child, geometry, mirror })
    child.stderr.resume()
    const stopped = () => { if (this.natives.get(id)?.child === child) { this.stopNative(); this.services?.stopped?.() } }
    child.on("error", stopped)
    child.on("exit", stopped)
    child.stdin.on("error", () => undefined)
    const lines = createInterface({ input: child.stdout })
    lines.on("line", line => {
      if (line.length > 4096 || this.natives.get(id)?.child !== child) return
      try {
        const msg = JSON.parse(line)
        const failed = (error: unknown) => { if (this.natives.get(id)?.child === child && !child.stdin.destroyed) child.stdin.write(`${JSON.stringify({ error: error instanceof Error ? error.message : "操作失败" })}\n`) }
        if (msg.type === "monitor" && ["brightness", "volume"].includes(msg.control) && Number.isInteger(msg.value) && msg.value >= 0 && msg.value <= 100) void Promise.resolve().then(() => this.services!.monitor(msg.control, msg.value)).catch(failed)
        if (msg.type === "music" && msg.request && (["play", "pause", "previous", "next"].includes(msg.request.action) || (msg.request.action === "seek" && Number.isFinite(msg.request.positionMs) && msg.request.positionMs >= 0))) void Promise.resolve().then(() => this.services!.music(msg.request)).catch(failed)
        if (!mirror && msg.type === "notification" && typeof msg.title === "string" && typeof msg.body === "string" && typeof msg.sound === "boolean") this.services!.notify(msg.title.slice(0, 100), msg.body.slice(0, 500), msg.sound)
        if (msg.type === "autostart" && typeof msg.enabled === "boolean") void Promise.resolve().then(() => this.services!.setAutostart(msg.enabled)).catch(failed)
      } catch { /* Ignore invalid child messages. */ }
    })
  }

  private publishNative = async (): Promise<void> => {
      if (this.nativePending || !this.natives.size || !this.services) return
      this.nativePending = true
      try { const state = await this.services.snapshot(); const message = `${JSON.stringify(state)}\n`; for (const { child } of this.natives.values()) if (!child.stdin.destroyed && !child.stdin.writableNeedDrain) child.stdin.write(message) }
      catch { /* Next tick retries the snapshot. */ }
      finally { this.nativePending = false }
  }

  private syncNative(): void {
    if (!this.services) return
    const primary = screen.getPrimaryDisplay()
    const connected = screen.getAllDisplays()
    const chosen = this.settings.displayId === "all" ? connected : this.settings.displayId === "multiple"
      ? connected.filter(display => this.settings.displayIds?.includes(String(display.id))) : []
    const displays = process.platform !== "linux" ? [primary] : ["all", "multiple"].includes(this.settings.displayId)
      ? (chosen.length ? [...chosen].sort((a, b) => Number(b.id === primary.id) - Number(a.id === primary.id)) : [primary])
      : [connected.find(display => String(display.id) === this.settings.displayId) ?? primary]
    const wanted = displays.map((display, index) => {
      const area = display.workArea
      return { id: String(display.id), geometry: process.platform === "linux" ? `${area.x},${area.y},${area.width}` : "", mirror: index > 0 }
    })
    for (const [id, entry] of this.natives) {
      const next = wanted.find(display => display.id === id)
      if (!next || next.geometry !== entry.geometry || next.mirror !== entry.mirror) {
        this.natives.delete(id); if (!entry.child.killed) { entry.child.stdin.end(); entry.child.kill() }
      }
    }
    try {
      for (const display of wanted) if (!this.natives.has(display.id)) this.startNative(display.id, display.geometry, display.mirror)
    } catch {
      this.stopNative(); this.services.stopped?.(); return
    }
    if (this.natives.size && !this.nativeTimer) { void this.publishNative(); this.nativeTimer = setInterval(() => void this.publishNative(), 2000); this.nativeTimer.unref() }
    else if (this.natives.size) void this.publishNative()
  }

  private apply(): void {
    if (!this.supported || !this.settings.enabled) {
      this.window?.destroy(); this.window = undefined; this.expanded = false
      this.stopNative()
      return
    }
    if (this.settings.style === "daozai") {
      this.window?.destroy(); this.window = undefined; this.expanded = false
      this.syncNative()
      return
    }
    this.stopNative()
    if (!this.window || this.window.isDestroyed()) {
      const window = new BrowserWindow({
        width: 260, height: 56, show: false, frame: false, transparent: true, hasShadow: false, backgroundColor: "#00000000",
        resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true,
        webPreferences: { preload: path.join(__dirname, "../preload/island.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
      })
      this.window = window
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
      window.webContents.on("will-navigate", event => event.preventDefault())
      window.on("closed", () => { if (this.window === window) this.window = undefined })
      this.reposition()
      window.once("ready-to-show", () => { if (!window.isDestroyed()) window.showInactive() })
      if (this.development && process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}#island`)
      else void window.loadFile(path.join(__dirname, "../renderer/index.html"), { hash: "island" })
    } else this.reposition()
  }

  private reposition = (): void => {
    if (this.settings.enabled && this.settings.style === "daozai") { this.syncNative(); return }
    if (!this.window || this.window.isDestroyed()) return
    const display = screen.getAllDisplays().find(item => String(item.id) === this.settings.displayId) ?? screen.getPrimaryDisplay()
    const area = display.workArea
    const width = Math.min(this.expanded ? 440 : 260, area.width)
    const height = Math.min(this.expanded ? 330 : 56, area.height)
    this.window.setBounds({ x: Math.round(area.x + (area.width - width) / 2), y: area.y, width, height })
  }
}
