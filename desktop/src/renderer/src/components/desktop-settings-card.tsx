import { useEffect, useState } from "react"
import type { DesktopPreferences, DesktopPreferencesSnapshot } from "../../../shared/contracts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

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
  return <Card><CardHeader><CardTitle>托盘与快捷键</CardTitle><CardDescription>保存后立即生效，开机启动和全局快捷键默认关闭。</CardDescription></CardHeader><CardContent className="space-y-5">{draft && <>
    {toggles.map(item => <div key={item.key} className="flex items-start justify-between gap-6"><div className="space-y-1"><Label htmlFor={`desktop-${item.key}`}>{item.label}</Label><p className="text-xs leading-5 text-muted-foreground">{item.detail}</p></div><Switch id={`desktop-${item.key}`} checked={draft[item.key]} disabled={busy || item.disabled} onCheckedChange={value => setDraft({ ...draft, [item.key]: value })} /></div>)}
    <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-3">{fields.map(item => <div key={item.key} className="space-y-2"><Label htmlFor={`hotkey-${item.key}`}>{item.label}</Label><Input id={`hotkey-${item.key}`} value={draft[item.key]} maxLength={80} disabled={busy || !draft.hotkeysEnabled} onChange={event => setDraft({ ...draft, [item.key]: event.target.value })} /></div>)}</div>
    <p className="text-xs text-muted-foreground">默认 Ctrl / Command + Alt + ↑ / ↓ 调亮度，Ctrl / Command + Alt + S 切换场景。可填写例如 Ctrl+Alt+Up；占用冲突会提示。</p>
    <Button disabled={busy || !dirty} onClick={() => void save()}>{busy ? "正在保存…" : "保存桌面设置"}</Button>
  </>}{error || saved?.shortcutError ? <p role="alert" className="text-sm text-red-400">{error || saved?.shortcutError}</p> : null}{saved && !saved.trayAvailable ? <p role="status" className="text-sm text-muted-foreground">系统托盘暂不可用，关闭窗口将退出程序。</p> : null}</CardContent></Card>
}
