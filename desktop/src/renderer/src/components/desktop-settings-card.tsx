import { useEffect, useState } from "react"
import type { DesktopPreferences, DesktopPreferencesSnapshot, IslandSettingsSnapshot } from "../../../shared/contracts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

function IslandSettingsCard() {
  const [settings, setSettings] = useState<IslandSettingsSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    let active = true
    const load = () => { void window.azoria.island.settings().then(value => { if (active) setSettings(value) }).catch(() => { if (active) setError("信息岛设置读取失败") }) }
    load(); window.addEventListener("focus", load)
    return () => { active = false; window.removeEventListener("focus", load) }
  }, [])
  const update = async (enabled: boolean, displayId: string, style: "pill" | "daozai" = settings?.style ?? "daozai", displayIds = settings?.displayIds) => {
    setBusy(true); setError("")
    try { setSettings(await window.azoria.island.update({ enabled, displayId, style, ...(displayId === "multiple" ? { displayIds } : {}) })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "信息岛设置保存失败") }
    finally { setBusy(false) }
  }
  return <Card><CardHeader><CardTitle>顶部信息岛</CardTitle><CardDescription>在屏幕顶部快速查看音乐与额度，调整当前显示器亮度。</CardDescription></CardHeader><CardContent className="space-y-5">
    <div className="flex items-start justify-between gap-6"><div className="space-y-1"><Label htmlFor="island-enabled">启用信息岛</Label><p className="text-xs leading-5 text-muted-foreground">{settings?.supported ? "鼠标移至信息岛展开；也可从托盘菜单切换。" : "目前支持 Windows 和 Linux X11 桌面。"}</p></div><Switch id="island-enabled" checked={settings?.enabled && settings.supported || false} disabled={!settings?.supported || busy} onCheckedChange={value => void update(value, settings?.displayId ?? "primary")} /></div>
    {settings?.supported && <div className="space-y-2"><Label htmlFor="island-style">信息岛样式</Label><Select value={settings.style} disabled={busy} onValueChange={value => void update(settings.enabled, value === "pill" && ["all", "multiple"].includes(settings.displayId) ? "primary" : settings.displayId, value as "pill" | "daozai")}><SelectTrigger id="island-style"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pill">YangCi 药丸</SelectItem><SelectItem value="daozai">岛仔原版</SelectItem></SelectContent></Select></div>}
    {settings?.supported && (settings.style === "pill" || settings.nativeDisplaySelection) && <div className="space-y-2"><Label htmlFor="island-display">信息岛所在屏幕</Label><Select value={settings.displayId} disabled={busy} onValueChange={value => void update(settings.enabled, value, settings.style, value === "multiple" ? (settings.displayIds?.length ? settings.displayIds : [settings.displays.some(display => display.id === settings.displayId) ? settings.displayId : settings.primaryDisplayId]) : undefined)}><SelectTrigger id="island-display"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="primary">系统主显示器</SelectItem>{settings.style === "daozai" && settings.nativeDisplaySelection && <><SelectItem value="multiple">选择多个显示器</SelectItem><SelectItem value="all">所有显示器</SelectItem></>}{settings.displays.map(display => <SelectItem key={display.id} value={display.id}>{display.label}</SelectItem>)}{!["primary", "all", "multiple"].includes(settings.displayId) && !settings.displays.some(display => display.id === settings.displayId) && <SelectItem value={settings.displayId}>原显示器已断开（暂用主显示器）</SelectItem>}</SelectContent></Select>
      {settings.displayId === "multiple" && <fieldset className="space-y-2 rounded-md border border-border p-3"><legend className="px-1 text-xs text-muted-foreground">选择显示器</legend>{[...settings.displays, ...(settings.displayIds ?? []).filter(id => !settings.displays.some(display => display.id === id)).map(id => ({ id, label: `已断开 · ${id}` }))].map(display => { const selected = !!settings.displayIds?.includes(display.id); return <label key={display.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected} disabled={busy || (selected && settings.displayIds?.length === 1)} onChange={event => void update(settings.enabled, "multiple", settings.style, event.target.checked ? [...(settings.displayIds ?? []), display.id] : settings.displayIds?.filter(id => id !== display.id))} />{display.label}</label> })}</fieldset>}
      <p className="text-xs text-muted-foreground">所选屏幕全部断开时暂用主显示器，重新连接后恢复。亮度控制仍使用主界面选中的显示器及联动设置。</p></div>}
    {settings?.supported && settings.style === "daozai" && <p className="text-xs text-muted-foreground">展开后点击右上方的显示器图标调整亮度和音量。</p>}
    {settings?.supported && settings.style === "daozai" && ["all", "multiple"].includes(settings.displayId) && <p className="text-xs text-muted-foreground">各屏同步显示 YangCi 的音乐和额度；各屏岛仔的其他页面与外观设置独立保存。</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
  </CardContent></Card>
}

export function DesktopSettingsCard({ onMessage }: { onMessage(message: string): void }) {
  const [saved, setSaved] = useState<DesktopPreferencesSnapshot | null>(null)
  const [draft, setDraft] = useState<DesktopPreferences | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { let active = true; void window.azoria.desktop.preferences().then(value => { if (active) { setSaved(value); setDraft(value) } }).catch(() => { if (active) setError("桌面设置读取失败") }); return () => { active = false } }, [])
  const save = async () => {
    if (!draft) return
    setBusy(true); setError(null)
    try { const value = await window.azoria.desktop.updatePreferences(draft); setSaved(value); setDraft(value); onMessage("桌面设置已保存") }
    catch (cause) { setError(cause instanceof Error ? cause.message : "设置保存失败") }
    finally { setBusy(false) }
  }
  const toggles: Array<{ key: "closeToTray" | "startAtLogin" | "hotkeysEnabled"; label: string; detail: string; disabled?: boolean }> = [
    { key: "closeToTray", label: "关闭窗口后常驻托盘", detail: "后台继续同步 Touch、播放壁纸和采集状态；从托盘菜单退出。", disabled: !saved?.trayAvailable },
    { key: "startAtLogin", label: "开机自动启动", detail: saved?.startupAvailable ? "登录电脑后在托盘中启动 YangCi。" : "当前安装暂不支持开机启动。", disabled: !saved?.startupAvailable },
    { key: "hotkeysEnabled", label: "启用全局快捷键", detail: "在其他应用中调整亮度，每次增减 5 点，或切换保存的亮度场景。" },
  ]
  const fields: Array<{ key: "brightnessUp" | "brightnessDown" | "nextScene"; label: string }> = [{ key: "brightnessUp", label: "提高亮度" }, { key: "brightnessDown", label: "降低亮度" }, { key: "nextScene", label: "下一个亮度场景" }]
  const dirty = draft && saved && fields.some(item => draft[item.key] !== saved[item.key]) || draft && saved && toggles.some(item => draft[item.key] !== saved[item.key])
  return <div className="space-y-5"><IslandSettingsCard /><Card><CardHeader><CardTitle>托盘与快捷键</CardTitle><CardDescription>保存后立即生效，开机启动和全局快捷键默认关闭。</CardDescription></CardHeader><CardContent className="space-y-5">{draft && <>
    {toggles.map(item => <div key={item.key} className="flex items-start justify-between gap-6"><div className="space-y-1"><Label htmlFor={`desktop-${item.key}`}>{item.label}</Label><p className="text-xs leading-5 text-muted-foreground">{item.detail}</p></div><Switch id={`desktop-${item.key}`} checked={draft[item.key]} disabled={busy || item.disabled} onCheckedChange={value => setDraft({ ...draft, [item.key]: value })} /></div>)}
    <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-3">{fields.map(item => <div key={item.key} className="space-y-2"><Label htmlFor={`hotkey-${item.key}`}>{item.label}</Label><Input id={`hotkey-${item.key}`} value={draft[item.key]} maxLength={80} disabled={busy || !draft.hotkeysEnabled} onChange={event => setDraft({ ...draft, [item.key]: event.target.value })} /></div>)}</div>
    <p className="text-xs text-muted-foreground">默认 Ctrl / Command + Alt + ↑ / ↓ 调亮度，Ctrl / Command + Alt + S 切换场景。可填写例如 Ctrl+Alt+Up；占用冲突会提示。</p>
    <Button disabled={busy || !dirty} onClick={() => void save()}>{busy ? "正在保存…" : "保存桌面设置"}</Button>
  </>}{error || saved?.shortcutError ? <p role="alert" className="text-sm text-red-400">{error || saved?.shortcutError}</p> : null}{saved && !saved.trayAvailable ? <p role="status" className="text-sm text-muted-foreground">系统托盘暂不可用，关闭窗口将退出程序。</p> : null}</CardContent></Card></div>
}
