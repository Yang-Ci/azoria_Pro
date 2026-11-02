import { useEffect, useState } from "react"
import { CalendarDays, Monitor, MoonStar, Plus, RotateCcw, Sun, Trash2 } from "lucide-react"
import type { DisplaySchedule, DisplayTimeRange, ExternalPowerAction, ExternalPowerState } from "../../../shared/contracts"
import { defaultDisplaySchedule, displaySchedulePaused, displayTime, maxDisplayPeriods, officeDisplayWeek } from "../../../shared/display-schedule"
import { localSleepDate, sleepDayLabels } from "../../../shared/touch-sleep"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

const dayOrder = [1, 2, 3, 4, 5, 6, 0]
const inputStyle = "h-10 min-w-0 rounded-md border border-white/10 bg-black px-3 text-sm [color-scheme:dark]"
const summary = (periods: DisplayTimeRange[]) => !periods.length ? "全天熄屏" :
  periods.length === 1 && periods[0]!.startMinutes === 0 && periods[0]!.endMinutes === 1440 ? "全天亮屏" :
  periods.map(p => `${displayTime(p.startMinutes)}–${displayTime(p.endMinutes)}`).join("、")

export function DisplayScheduleCard({ state, pending, onControl, onSave, onMessage }: {
  state: ExternalPowerState; pending: boolean
  onControl(action: ExternalPowerAction, holdMinutes?: number): Promise<void>
  onSave(plan: DisplaySchedule): Promise<void>
  onMessage(message: string): void
}) {
  const [draft, setDraft] = useState(defaultDisplaySchedule)
  const [dirty, setDirty] = useState(false)
  const [day, setDay] = useState(() => new Date().getDay())
  const [hold, setHold] = useState(0)
  const [customHold, setCustomHold] = useState(60)
  const holdMinutes = hold === -2 ? customHold : hold
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!dirty && state.schedule) setDraft(structuredClone(state.schedule)) }, [state.schedule, dirty])
  const change = (next: DisplaySchedule) => { setDraft(next); setDirty(true) }
  const periods = draft.week[day]!
  const setPeriods = (next: DisplayTimeRange[]) => change({ ...draft, week: draft.week.map((p, index) => index === day ? next : p) })
  const copy = (days: number[]) => change({ ...draft, week: draft.week.map((p, index) => days.includes(index) ? structuredClone(periods) : p) })
  const blocked = pending || state.busy || saving || !state.schedule
  const hardwareBlocked = blocked || !state.supported || !state.internalAvailable
  const save = async () => {
    setSaving(true)
    try { await onSave(draft); setDirty(false) } catch (error) { onMessage(error instanceof Error ? error.message : "计划保存失败") }
    finally { setSaving(false) }
  }
  const add = () => {
    const sorted = [...periods].sort((a, b) => a.startMinutes - b.startMinutes)
    let start = 0
    for (const p of sorted) { if (p.startMinutes > start) break; start = Math.max(start, p.endMinutes) }
    if (start >= 1440) { onMessage("当天已全部安排亮屏，可先修改现有时段"); return }
    const end = sorted.find(p => p.startMinutes > start)?.startMinutes ?? 1440
    setPeriods([...periods, { startMinutes: start, endMinutes: Math.min(start + 60, end) }])
  }
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1)
  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Monitor />外接屏电源与每周计划</CardTitle>
      <CardDescription>在 YangCi 设置两块外接屏的作息；Touch 保留一键熄屏与恢复，笔记本内屏保持可用。</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      <p className="text-sm text-zinc-400">{state.externalCount} 块外接屏 · {state.off ? "已熄灭" : "正常显示"} · {state.override ? `手动${state.override.on ? "亮屏" : "熄屏"}，${state.override.until ? `${new Date(state.override.until).toLocaleString("zh-CN")}恢复自动` : "保持至主动恢复自动"}` : state.schedule?.enabled ? displaySchedulePaused(state.schedule) ? "计划暂停中" : "自动计划中" : "手动控制"}</p>
      {state.deferredUntil && <p role="status" className="text-sm text-cyan-200">检测到电脑输入，自动熄屏已推迟至 {new Date(state.deferredUntil).toLocaleTimeString("zh-CN")}；到时再检查前 1 分钟是否有输入。</p>}
      {state.activityAvailable === false && !state.off && <p role="status" className="text-sm text-amber-300">暂时无法读取输入活动，已暂缓自动熄屏。手动熄屏仍可使用。</p>}
      {state.touchBacklight && <p className="text-sm text-zinc-400">Touch：{state.touchBacklight.awake ? "亮屏" : "息屏"}{state.off && state.touchBacklight.awake && state.touchBacklight.sleepAt && new Date(state.touchBacklight.sleepAt) > new Date() ? `，${new Date(state.touchBacklight.sleepAt).toLocaleTimeString("zh-CN")} 息屏` : ""}{state.touchBacklight.wakeAt && new Date(state.touchBacklight.wakeAt) > new Date() ? ` · 下次提前亮屏 ${new Date(state.touchBacklight.wakeAt).toLocaleString("zh-CN")}` : ""}</p>}
      <div className="space-y-2">
        <Label htmlFor="display-hold">手动操作保持时间</Label>
        <select id="display-hold" value={hold} disabled={blocked} onChange={e => setHold(Number(e.target.value))} className={`${inputStyle} w-full`}>
          <option value={0}>至计划下次切换</option><option value={30}>30 分钟</option><option value={60}>1 小时</option><option value={120}>2 小时</option><option value={-1}>一直保持，直到恢复自动</option><option value={-2}>自定义分钟数</option>
        </select>
        {hold === -2 && <div className="space-y-2"><Label htmlFor="display-hold-minutes">保持分钟数（1–10080）</Label><input id="display-hold-minutes" type="number" min={1} max={10080} step={1} value={customHold} disabled={blocked} onChange={e => setCustomHold(Number(e.target.value))} className={`${inputStyle} w-full`} /></div>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={hardwareBlocked || state.externalCount === 0 || !Number.isInteger(holdMinutes) || holdMinutes < -1 || holdMinutes > 10080} onClick={() => void onControl("off", holdMinutes)}><MoonStar />熄灭外接屏</Button>
        <Button variant="outline" disabled={hardwareBlocked || !Number.isInteger(holdMinutes) || holdMinutes < -1 || holdMinutes > 10080} onClick={() => void onControl("on", holdMinutes)}><Sun />恢复外接屏</Button>
        <Button variant="outline" disabled={hardwareBlocked || !state.schedule?.enabled} onClick={() => void onControl("auto")}><RotateCcw />恢复自动</Button>
      </div>
      {state.linked && <p className="text-sm text-amber-300">旧版 Touch 息屏联动仍在执行。<Button variant="link" disabled={blocked} onClick={() => void onControl("link-off")}>关闭旧版联动</Button>启用每周计划后会改为按以下时段执行。</p>}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-white/10 p-4">
        <div><Label htmlFor="display-plan-enabled">启用外接屏每周计划</Label><p className="mt-1 text-sm text-zinc-500">以下时段内亮屏，其余时间熄屏。保存后生效。</p></div>
        <Switch id="display-plan-enabled" checked={draft.enabled} disabled={blocked} onCheckedChange={enabled => change({ ...draft, enabled })} />
      </div>
      <Button variant="outline" disabled={blocked} className="h-auto whitespace-normal py-2 text-left" onClick={() => change({ ...draft, enabled: true, week: officeDisplayWeek(), resumeDate: null })}>使用工作日 08:50–18:10、周末全天熄屏</Button>
      <fieldset disabled={blocked} className="space-y-4 rounded-lg border border-white/10 p-4">
        <legend className="px-2 text-sm font-medium">下班延后与 Touch 联动</legend>
        <div className="flex items-center justify-between gap-4"><div><Label htmlFor="display-activity-delay">有电脑输入时延后自动熄屏</Label><p className="mt-1 text-xs leading-5 text-zinc-500">每次准备熄屏时，只检查前 1 分钟的键盘或鼠标输入。有输入就延后指定分钟，到新时间再检查；没有输入就熄屏。手动熄屏立即执行；全天熄屏日期不延后。</p></div><Switch id="display-activity-delay" checked={(draft.activityDelayMinutes ?? 0) > 0} onCheckedChange={checked => change({ ...draft, activityDelayMinutes: checked ? 10 : 0 })} /></div>
        {(draft.activityDelayMinutes ?? 0) > 0 && <div className="space-y-2"><Label htmlFor="display-activity-minutes">有输入时每次延后（分钟）</Label><input id="display-activity-minutes" type="number" min={1} max={120} step={1} value={draft.activityDelayMinutes} onChange={e => change({ ...draft, activityDelayMinutes: Number(e.target.value) })} className={`${inputStyle} w-full`} /></div>}
        <div className="flex items-center justify-between gap-4"><div><Label htmlFor="display-touch-follow">Touch 跟随外接屏亮灭</Label><p className="mt-1 text-xs leading-5 text-zinc-500">外接屏熄灭后，Touch 延后息屏；下一次计划亮屏前，Touch 提前亮起。启用后替代独立背光时段。</p></div><Switch id="display-touch-follow" checked={draft.touchFollow ?? false} onCheckedChange={touchFollow => change({ ...draft, touchFollow })} /></div>
        {draft.touchFollow && <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="display-touch-wake-lead">Touch 提前亮屏（分钟）</Label><input id="display-touch-wake-lead" type="number" min={0} max={120} step={1} value={draft.touchWakeLeadMinutes ?? 10} onChange={e => change({ ...draft, touchWakeLeadMinutes: Number(e.target.value) })} className={`${inputStyle} w-full`} /></div><div className="space-y-2"><Label htmlFor="display-touch-sleep-delay">Touch 延后息屏（分钟）</Label><input id="display-touch-sleep-delay" type="number" min={0} max={120} step={1} value={draft.touchSleepDelayMinutes ?? 10} onChange={e => change({ ...draft, touchSleepDelayMinutes: Number(e.target.value) })} className={`${inputStyle} w-full`} /></div></div>}
      </fieldset>
      <fieldset disabled={blocked} className="space-y-3">
        <legend className="mb-3 flex items-center gap-2 text-sm font-medium"><CalendarDays className="size-4" />每天的亮屏时间</legend>
        <div className="grid grid-cols-7 gap-1">{dayOrder.map(d => <Button key={d} size="sm" variant={day === d ? "default" : "outline"} aria-pressed={day === d} className="px-0" onClick={() => setDay(d)}>{sleepDayLabels[d]}</Button>)}</div>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setPeriods([{ startMinutes: 0, endMinutes: 1440 }])}>全天亮屏</Button><Button size="sm" variant="outline" onClick={() => setPeriods([])}>全天熄屏</Button><Button size="sm" variant="outline" disabled={blocked || periods.length >= maxDisplayPeriods} onClick={add}><Plus />添加时段</Button></div>
        {!periods.length && <p className="text-sm text-zinc-400">{sleepDayLabels[day]}全天熄屏</p>}
        {periods.map((period, index) => <div key={index} className="flex items-center gap-2">
          <input type="time" aria-label={`${sleepDayLabels[day]}时段${index + 1}亮屏时间`} className={`${inputStyle} flex-1`} value={displayTime(period.startMinutes)} onChange={e => { if (!e.target.value) return; const [h, m] = e.target.value.split(":").map(Number); setPeriods(periods.map((p, i) => i === index ? { ...p, startMinutes: h! * 60 + m! } : p)) }} />
          <span className="text-zinc-500">至</span>
          <input type="time" aria-label={`${sleepDayLabels[day]}时段${index + 1}熄屏时间（00:00 表示当日结束）`} className={`${inputStyle} flex-1`} value={displayTime(period.endMinutes % 1440)} onChange={e => { if (!e.target.value) return; const [h, m] = e.target.value.split(":").map(Number); setPeriods(periods.map((p, i) => i === index ? { ...p, endMinutes: (h! * 60 + m!) || 1440 } : p)) }} />
          <Button variant="ghost" size="icon" aria-label={`删除时段${index + 1}`} onClick={() => setPeriods(periods.filter((_, i) => i !== index))}><Trash2 /></Button>
        </div>)}
        <p className="text-xs leading-5 text-zinc-500">每天最多 8 段；结束时间 00:00 表示当天 24:00。跨午夜请分别设置两天。按电脑本地时间执行，不自动识别调休。</p>
        <div className="flex flex-wrap gap-2">{[{ label: "复制到工作日", days: [1, 2, 3, 4, 5] }, { label: "复制到周末", days: [0, 6] }, { label: "复制到每天", days: dayOrder }].map(p => <Button key={p.label} size="sm" variant="outline" onClick={() => copy(p.days)}>{p.label}</Button>)}</div>
        <div className="space-y-1 rounded-lg bg-white/[0.03] p-3 text-sm text-zinc-400">{dayOrder.map(d => <p key={d}>{sleepDayLabels[d]} · {summary(draft.week[d]!)}</p>)}</div>
        <div className="space-y-2"><Label htmlFor="display-plan-resume">假期暂停至（当天 00:00 恢复）</Label><input id="display-plan-resume" type="date" className={`${inputStyle} w-full`} min={localSleepDate(tomorrow)} max="2099-12-31" value={draft.resumeDate ?? ""} onChange={e => change({ ...draft, resumeDate: e.target.value || null })} /><p className="text-xs text-zinc-500">留空正常执行。暂停期间保持亮屏，手动控制仍可使用。</p></div>
      </fieldset>
      {dirty && <p role="status" className="text-sm text-amber-300">更改尚未保存。保存计划会结束当前手动接管。</p>}
      {dirty && state.schedule && state.schedule.revision !== draft.revision && <p role="alert" className="text-sm text-amber-300">计划已在其他窗口修改，请重新读取后编辑。</p>}
      <div className="flex flex-wrap gap-2"><Button disabled={blocked || !dirty} onClick={() => void save()}>{saving ? "正在保存…" : "保存外接屏计划"}</Button><Button variant="ghost" disabled={blocked} onClick={() => { if (state.schedule) setDraft(structuredClone(state.schedule)); setDirty(false) }}>重新读取 / 撤销修改</Button></div>
      <p className="text-xs text-zinc-500">{state.schedule?.enabled && state.nextChangeAt ? `下次切换：${new Date(state.nextChangeAt).toLocaleString("zh-CN")}` : ""} 计划由 YangCi 执行，电脑需保持开机、登录桌面，YangCi 可在托盘后台运行。</p>
    </CardContent>
  </Card>
}
