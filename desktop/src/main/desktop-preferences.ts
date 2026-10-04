import { readFile } from "node:fs/promises"
import path from "node:path"
import type { DesktopPreferences, DesktopPreferencesSnapshot } from "../shared/contracts"
import { writeAtomicJson } from "./atomic-json"

export const defaultDesktopPreferences: DesktopPreferences = {
  closeToTray: true, startAtLogin: false, hotkeysEnabled: false,
  brightnessUp: "CommandOrControl+Alt+Up", brightnessDown: "CommandOrControl+Alt+Down", nextScene: "CommandOrControl+Alt+S",
}
type Action = "brightnessUp" | "brightnessDown" | "nextScene"
const actions: Action[] = ["brightnessUp", "brightnessDown", "nextScene"]
export interface DesktopIntegrationAdapter {
  startupAvailable: boolean
  getStartup(): boolean
  setStartup(enabled: boolean): void
  register(accelerator: string, action: Action): boolean
  unregister(accelerator: string): void
}
export function validateDesktopPreferences(value: DesktopPreferences): DesktopPreferences {
  if (!value || [value.closeToTray, value.startAtLogin, value.hotkeysEnabled].some(item => typeof item !== "boolean")) throw new Error("桌面设置无效")
  const accelerators = actions.map(action => value[action])
  if (accelerators.some(item => typeof item !== "string" || item.length > 80 || !/^(?=.*(?:Control|Ctrl|Command|Cmd|Alt|Option|Super|Meta))[^\r\n]+\+[^+]+$/i.test(item))) throw new Error("快捷键需包含 Ctrl、Command 或 Alt 等修饰键")
  const normalized = accelerators.map(item => item.trim().toLowerCase().replace(/commandorcontrol|cmdorctrl/g, "primary").replace(/ctrl/g, "control").replace(/cmd/g, "command"))
  if (new Set(normalized).size !== actions.length) throw new Error("三个快捷键不能重复")
  return { closeToTray: value.closeToTray, startAtLogin: value.startAtLogin, hotkeysEnabled: value.hotkeysEnabled,
    brightnessUp: value.brightnessUp.trim(), brightnessDown: value.brightnessDown.trim(), nextScene: value.nextScene.trim() }
}

export class DesktopPreferencesManager {
  private settings = { ...defaultDesktopPreferences }
  private registered: string[] = []
  private shortcutError: string | null = null
  private trayAvailable = false
  private queue: Promise<unknown> = Promise.resolve()
  private readonly filename: string
  constructor(userData: string, private readonly adapter: DesktopIntegrationAdapter) { this.filename = path.join(userData, "desktop-preferences.json") }
  async initialize(): Promise<void> {
    try { this.settings = validateDesktopPreferences(JSON.parse(await readFile(this.filename, "utf8"))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.shortcutError = "桌面设置读取失败，原文件已保留；请重新保存设置" }
    this.settings.startAtLogin = this.adapter.startupAvailable && this.adapter.getStartup()
    try { this.register(this.settings) } catch (error) { this.shortcutError = error instanceof Error ? error.message : "快捷键注册失败" }
  }
  setTrayAvailable(available: boolean): void { this.trayAvailable = available }
  snapshot(): DesktopPreferencesSnapshot { return { ...this.settings, startAtLogin: this.adapter.startupAvailable && this.adapter.getStartup(), startupAvailable: this.adapter.startupAvailable, trayAvailable: this.trayAvailable, shortcutError: this.shortcutError } }
  dispose(): void { for (const key of this.registered) this.adapter.unregister(key); this.registered = [] }
  private register(settings: DesktopPreferences): void {
    this.dispose()
    if (!settings.hotkeysEnabled) return
    try {
      for (const action of actions) {
        const key = settings[action]
        if (!this.adapter.register(key, action)) throw new Error(`快捷键 ${key} 已被占用或系统不支持`)
        this.registered.push(key)
      }
    } catch (error) { this.dispose(); throw error }
  }
  update(input: DesktopPreferences): Promise<DesktopPreferencesSnapshot> {
    const next = validateDesktopPreferences(input)
    const result = this.queue.then(async () => {
      const previous = this.snapshot()
      if (!this.adapter.startupAvailable && next.startAtLogin) throw new Error("当前安装不支持开机启动")
      try {
        this.register(next)
        if (this.adapter.startupAvailable && next.startAtLogin !== previous.startAtLogin) this.adapter.setStartup(next.startAtLogin)
        await writeAtomicJson(this.filename, next)
        this.settings = next; this.shortcutError = null
      } catch (error) {
        try { this.register(previous) } catch { this.shortcutError = "原快捷键恢复失败，请重新保存设置" }
        if (this.adapter.startupAvailable && this.adapter.getStartup() !== previous.startAtLogin) this.adapter.setStartup(previous.startAtLogin)
        throw error
      }
      return this.snapshot()
    })
    this.queue = result.catch(() => undefined)
    return result
  }
}
