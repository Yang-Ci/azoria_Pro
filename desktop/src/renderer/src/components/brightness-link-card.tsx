import { useEffect, useState } from "react"
import { Link2, RefreshCw, Sun, Trash2 } from "lucide-react"
import type { BrightnessLinkSettings, BrightnessLinkSnapshot, MonitorDisplaySummary } from "../../../shared/contracts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"

export function BrightnessLinkCard({ displays, onMessage, onChanged }: { displays: MonitorDisplaySummary[]; onMessage(message: string): void; onChanged(): void }) {
  const [state, setState] = useState<BrightnessLinkSnapshot | null>(null)
  const [draft, setDraft] = useState<BrightnessLinkSettings>({ enabled: false, displays: [] })
  const [dirty, setDirty] = useState(false)
  const [offset, setOffset] = useState(0)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void window.azoria.brightnessLink.snapshot().then(value => { if (active) { setState(value); setDraft({ enabled: value.enabled, displays: value.displays }) } }).catch(cause => { if (active) setError(String(cause)) })
    const timer = setInterval(() => { void window.azoria.brightnessLink.snapshot().then(value => { if (active) setState(value) }).catch(() => undefined) }, 2000)
    return () => { active = false; clearInterval(timer) }
  }, [])
  useEffect(() => { setOffset(state?.offset ?? 0) }, [state?.offset])
  useEffect(() => { if (state && !dirty) setDraft({ enabled: state.enabled, displays: state.displays }) }, [state, dirty])
  const edit = (next: BrightnessLinkSettings) => { setDraft(next); setDirty(true) }
  const run = async (operation: () => Promise<BrightnessLinkSnapshot>, message: string) => {
    setBusy(true); setError(null)
    try {
      const value = await operation()
      setState(value); setDraft({ enabled: value.enabled, displays: value.displays }); setDirty(false); onChanged()
      onMessage(value.results.some(item => item.error) ? "部分显示器调整失败，请查看联动结果" : message)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败") }
    finally { setBusy(false) }
  }
  const rows = [...displays, ...draft.displays.filter(item => !displays.some(display => display.id === item.displayId)).map(item => ({ id: item.displayId, name: `未连接显示器 · ${item.displayId}`, index: 0 }))]
  const capture = async () => {
    setBusy(true); setError(null)
    try {
      const ids = draft.displays.length ? draft.displays.map(item => item.displayId) : displays.slice(0, 16).map(item => item.id)
      const values = await window.azoria.brightnessLink.capture(ids)
      edit({ ...draft, displays: values }); onMessage("已读取当前亮度，请保存为基准")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取亮度失败") }
    finally { setBusy(false) }
  }
  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Link2 />多显示器亮度联动</CardTitle><CardDescription>每块屏幕保存独立基准，统一增减亮度时保持百分点差值。</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      <div className="flex items-center justify-between gap-4"><Label htmlFor="brightness-link-enabled">启用亮度联动</Label><Switch id="brightness-link-enabled" checked={draft.enabled} disabled={busy || !state} onCheckedChange={enabled => edit({ ...draft, enabled })} /></div>
      <div className="space-y-2">{rows.map(display => {
        const selected = draft.displays.find(item => item.displayId === display.id)
        const result = state?.results.find(item => item.displayId === display.id)
        return <div key={display.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
          <input type="checkbox" id={`linked-${display.id}`} aria-label={`${display.name}参与亮度联动`} checked={!!selected} disabled={busy || !state} className="size-4 accent-white" onChange={event => edit({ ...draft, displays: event.target.checked ? [...draft.displays, { displayId: display.id, baseline: 50 }] : draft.displays.filter(item => item.displayId !== display.id) })} />
          <Label htmlFor={`linked-${display.id}`} className="min-w-32 flex-1">{display.name}</Label>
          {selected ? <div className="flex items-center gap-2"><Label htmlFor={`baseline-${display.id}`} className="text-xs text-muted-foreground">基准</Label><Input id={`baseline-${display.id}`} aria-label={`${display.name}基准亮度`} type="number" min={0} max={100} className="w-20" value={selected.baseline} disabled={busy} onChange={event => edit({ ...draft, displays: draft.displays.map(item => item.displayId === display.id ? { ...item, baseline: Number(event.target.value) } : item) })} /><span className="text-sm">%</span></div> : null}
          {result?.brightness !== null && result?.brightness !== undefined ? <Badge variant="outline">当前 {Math.round(result.brightness)}%</Badge> : null}
          {result?.error ? <p className="w-full text-xs text-red-400" role="status">{result.error}</p> : null}
        </div>
      })}{!rows.length ? <p className="text-sm text-muted-foreground">连接显示器后可保存基准值。</p> : null}</div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !rows.length} onClick={() => void capture()}><RefreshCw />读取当前亮度为基准</Button><Button disabled={busy || !state || !dirty} onClick={() => void run(() => window.azoria.brightnessLink.save(draft), "联动基准已保存")}>保存基准设置</Button></div>
      {state?.enabled && <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between"><Label htmlFor="brightness-link-offset">统一亮度偏移</Label><span className="font-mono text-sm">{offset > 0 ? "+" : ""}{offset} 点</span></div>
        {state.minimumOffset < state.maximumOffset ? <Slider id="brightness-link-offset" aria-label="统一亮度偏移" min={state.minimumOffset} max={state.maximumOffset} step={1} value={[offset]} disabled={busy || dirty} onValueChange={values => setOffset(values[0] ?? 0)} onValueCommit={values => void run(() => window.azoria.brightnessLink.setOffset(values[0] ?? 0), "联动亮度已更新")} /> : <p className="text-xs text-muted-foreground">当前基准已覆盖 0–100% 范围。</p>}
        <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{dirty ? "保存修改后的基准，再统一调节。" : "桌面端和 Touch 的亮度调节也会联动所选屏幕。"}</p><Button size="sm" variant="outline" disabled={busy || dirty} onClick={() => void run(() => window.azoria.brightnessLink.setOffset(0), "已恢复基准亮度")}><Sun />应用基准</Button></div>
      </div>}
      <div className="space-y-3 border-t border-border pt-4"><Label htmlFor="brightness-scene-name">亮度场景</Label><div className="flex gap-2"><Input id="brightness-scene-name" placeholder="例如：工作、夜间" maxLength={40} value={name} disabled={busy} onChange={event => setName(event.target.value)} /><Button variant="outline" disabled={busy || dirty || !name.trim() || !rows.length} onClick={() => void run(async () => { const value = await window.azoria.brightnessLink.saveScene(name); setName(""); return value }, "当前亮度已保存为场景")}>保存当前亮度</Button></div>
        <div className="flex flex-wrap gap-2">{state?.scenes.map(scene => <div key={scene.id} className="flex items-center gap-1"><Button size="sm" variant={scene.id === state.activeSceneId ? "default" : "outline"} disabled={busy || dirty} onClick={() => void run(() => window.azoria.brightnessLink.applyScene(scene.id), `已切换到 ${scene.name}`)}>{scene.name}</Button><Button size="icon" variant="ghost" aria-label={`删除场景 ${scene.name}`} disabled={busy || dirty} onClick={() => void run(() => window.azoria.brightnessLink.deleteScene(scene.id), "场景已删除")}><Trash2 className="size-3" /></Button></div>)}</div>
        <p className="text-xs text-muted-foreground">场景保存所选屏幕的实际亮度，可从托盘或快捷键切换。</p>
      </div>
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
      {state?.results.filter(item => !item.displayId).map(item => <p key={item.error} role="alert" className="text-sm text-red-400">{item.error}</p>)}
    </CardContent>
  </Card>
}
