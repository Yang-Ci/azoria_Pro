import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import path from "node:path"
import { BrowserWindow, screen } from "electron"
import type { IslandSettings, IslandSettingsSnapshot, IslandSnapshot, MusicControlRequest } from "../shared/contracts"
import { writeAtomicJson } from "./atomic-json"

/** The selected screen is independent of the display controlled by DDC. */
export class IslandWindow {
  private settings: IslandSettings = { enabled: false, displayId: "primary", style: "daozai" }
  private window?: BrowserWindow
  private native?: ChildProcessWithoutNullStreams
  private nativeTimer?: NodeJS.Timeout
  private nativePending = false
  private expanded = false
  private queue: Promise<unknown> = Promise.resolve()
  private readonly filename: string
  readonly supported = process.platform === "win32"

  constructor(userData: string, private readonly development: boolean, private readonly services?: {
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
      if (typeof value.enabled === "boolean" && typeof value.displayId === "string" && value.displayId.length <= 64) this.settings = { enabled: value.enabled, displayId: value.displayId, style: value.style === "pill" ? "pill" : "daozai" }
    } catch { /* Missing or invalid settings leave the island disabled. */ }
    screen.on("display-added", this.reposition)
    screen.on("display-removed", this.reposition)
    screen.on("display-metrics-changed", this.reposition)
    this.apply()
  }

  snapshot(): IslandSettingsSnapshot {
    return { ...this.settings, supported: this.supported, displays: screen.getAllDisplays().map((display, index) => ({ id: String(display.id), label: display.label || `显示器 ${index + 1}` })) }
  }

  update(input: IslandSettings): Promise<IslandSettingsSnapshot> {
    if (!input || typeof input.enabled !== "boolean" || !["pill", "daozai"].includes(input.style) || typeof input.displayId !== "string" || input.displayId.length > 64 || (input.displayId !== "primary" && input.displayId !== this.settings.displayId && !screen.getAllDisplays().some(display => String(display.id) === input.displayId))) throw new Error("信息岛设置无效")
    if (input.enabled && !this.supported) throw new Error("信息岛目前仅支持 Windows")
    if (input.enabled && input.style === "daozai" && (!this.services || !existsSync(this.nativePath()))) throw new Error("岛仔组件未安装，请重新安装 YangCi")
    const next = { enabled: input.enabled, displayId: input.displayId, style: input.style }
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
    if (this.native && !this.native.stdin.destroyed) this.native.stdin.write(`${JSON.stringify({ command: "open-settings" })}\n`)
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
    return this.development ? path.resolve(process.cwd(), "desktop/daozai/target/release/daozai.exe") : path.join(process.resourcesPath, "daozai/daozai.exe")
  }

  private stopNative(): void {
    clearInterval(this.nativeTimer); this.nativeTimer = undefined
    const child = this.native; this.native = undefined
    if (child && !child.killed) { child.stdin.end(); child.kill() }
  }

  private startNative(): void {
    if (this.native || !this.services || !existsSync(this.nativePath())) return
    const child = spawn(this.nativePath(), ["--yangci-managed"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
    this.native = child
    child.stderr.resume()
    const stopped = () => { if (this.native === child) { this.stopNative(); this.services?.stopped?.() } }
    child.on("error", stopped)
    child.on("exit", stopped)
    child.stdin.on("error", () => undefined)
    const lines = createInterface({ input: child.stdout })
    lines.on("line", line => {
      if (line.length > 4096 || this.native !== child) return
      try {
        const msg = JSON.parse(line)
        const failed = (error: unknown) => { if (this.native === child && !child.stdin.destroyed) child.stdin.write(`${JSON.stringify({ error: error instanceof Error ? error.message : "操作失败" })}\n`) }
        if (msg.type === "monitor" && ["brightness", "volume"].includes(msg.control) && Number.isInteger(msg.value) && msg.value >= 0 && msg.value <= 100) void Promise.resolve().then(() => this.services!.monitor(msg.control, msg.value)).catch(failed)
        if (msg.type === "music" && msg.request && (["play", "pause", "previous", "next"].includes(msg.request.action) || (msg.request.action === "seek" && Number.isFinite(msg.request.positionMs) && msg.request.positionMs >= 0))) void Promise.resolve().then(() => this.services!.music(msg.request)).catch(failed)
        if (msg.type === "notification" && typeof msg.title === "string" && typeof msg.body === "string" && typeof msg.sound === "boolean") this.services!.notify(msg.title.slice(0, 100), msg.body.slice(0, 500), msg.sound)
        if (msg.type === "autostart" && typeof msg.enabled === "boolean") void Promise.resolve().then(() => this.services!.setAutostart(msg.enabled)).catch(failed)
      } catch { /* Ignore invalid child messages. */ }
    })
    const publish = async () => {
      if (this.nativePending || this.native !== child || child.stdin.destroyed || child.stdin.writableNeedDrain) return
      this.nativePending = true
      try { const state = await this.services!.snapshot(); if (this.native === child && !child.stdin.destroyed) child.stdin.write(`${JSON.stringify(state)}\n`) }
      catch { /* Next tick retries the snapshot. */ }
      finally { this.nativePending = false }
    }
    void publish(); this.nativeTimer = setInterval(() => void publish(), 2000); this.nativeTimer.unref()
  }

  private apply(): void {
    if (!this.supported || !this.settings.enabled) {
      this.window?.destroy(); this.window = undefined; this.expanded = false
      this.stopNative()
      return
    }
    if (this.settings.style === "daozai") {
      this.window?.destroy(); this.window = undefined; this.expanded = false
      this.startNative()
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
    if (!this.window || this.window.isDestroyed()) return
    const display = screen.getAllDisplays().find(item => String(item.id) === this.settings.displayId) ?? screen.getPrimaryDisplay()
    const area = display.workArea
    const width = Math.min(this.expanded ? 440 : 260, area.width)
    const height = Math.min(this.expanded ? 330 : 56, area.height)
    this.window.setBounds({ x: Math.round(area.x + (area.width - width) / 2), y: area.y, width, height })
  }
}
