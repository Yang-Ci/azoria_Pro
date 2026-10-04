import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, KeyRound, Pencil, RefreshCw, Trash2, Wallet } from "lucide-react"
import type { ApiProviderConfig, ApiProviderState } from "../../../shared/usage"
import { formatAmount, formatSample, usageError } from "../usage-format"
import { UsageChart } from "./usage-chart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"

export function ApiProviderCard({ provider, onEdit, onDelete, onUpdate }: {
  provider: ApiProviderState
  onEdit(config: ApiProviderConfig): void
  onDelete(id: string): Promise<void>
  onUpdate(provider: ApiProviderState): void
}) {
  const { config, snapshot } = provider
  const [loading, setLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [details, setDetails] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(false)
  const initialCheckedAt = useRef(provider.checkedAt)
  const refresh = useCallback(async () => {
    if (pending.current) return
    pending.current = true
    setLoading(true); setActionError(null)
    try {
      const next = await window.azoria.usage.refreshProvider(config.id)
      if (mounted.current) onUpdate(next)
    } catch (error) { if (mounted.current) setActionError(usageError(error)) }
    finally { pending.current = false; if (mounted.current) setLoading(false) }
  }, [config.id, onUpdate])

  useEffect(() => {
    mounted.current = true
    if (!config.enabled) return () => { mounted.current = false }
    const interval = config.refreshMinutes * 60_000
    const checked = initialCheckedAt.current ? Date.parse(initialCheckedAt.current) : 0
    const firstTimer = window.setTimeout(() => void refresh(), Math.max(0, interval - (Date.now() - checked)))
    const timer = window.setInterval(() => { if (!document.hidden) void refresh() }, interval)
    const onVisible = () => { if (!document.hidden) void refresh() }
    document.addEventListener("visibilitychange", onVisible)
    return () => { mounted.current = false; clearTimeout(firstTimer); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible) }
  }, [config.enabled, config.refreshMinutes, refresh])

  const remove = async () => {
    try { await onDelete(config.id) }
    catch (error) { setActionError(usageError(error)) }
  }
  const unit = snapshot?.unit ?? config.unit
  const stale = !!snapshot && Date.now() - Date.parse(snapshot.sampledAt) > config.refreshMinutes * 120_000
  const error = actionError ?? provider.error
  return <Card className="min-w-0">
    <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
      <div className="min-w-0 space-y-2"><CardTitle className="flex items-center gap-2 text-base"><Wallet className="size-4 shrink-0 text-emerald-400" /><span className="truncate">{config.name}</span></CardTitle><CardDescription>{config.kind === "new-api" ? "New API 账户" : config.kind === "deepseek" ? "DeepSeek 官方" : "自定义用量接口"}</CardDescription></div>
      <div className="flex shrink-0 items-center gap-1"><Button variant="ghost" size="icon" aria-label={`编辑 ${config.name}`} onClick={() => onEdit(config)} disabled={loading}><Pencil className="size-4" /></Button><AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="icon" aria-label={`删除 ${config.name}`} disabled={loading}><Trash2 className="size-4" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除 {config.name}？</AlertDialogTitle><AlertDialogDescription>将删除本机的服务配置、凭据和查询缓存。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => void remove()}>删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{config.kind === "custom" ? "剩余用量" : "账户余额"}</span><Badge variant="outline" className={error || stale ? "text-amber-300" : config.enabled ? "text-emerald-300" : "text-muted-foreground"}>{!config.enabled ? "已暂停" : loading ? "更新中" : error ? "更新失败" : stale ? "数据较旧" : snapshot ? "已同步" : "等待查询"}</Badge></div>
      <div className="flex flex-wrap items-baseline gap-2"><strong className="font-mono text-3xl font-semibold tabular-nums tracking-tight">{snapshot ? formatAmount(snapshot.remaining, unit) : loading ? "…" : "—"}</strong><span className="text-sm text-muted-foreground">{snapshot ? unit : ""}</span></div>
      {snapshot ? <>
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
          {config.kind === "deepseek" ? <><div><p className="mb-1 text-xs text-muted-foreground">赠送余额</p><p className="font-mono tabular-nums">{formatAmount(snapshot.granted, unit)} {unit}</p></div><div><p className="mb-1 text-xs text-muted-foreground">充值余额</p><p className="font-mono tabular-nums">{formatAmount(snapshot.toppedUp, unit)} {unit}</p></div></> : <><div><p className="mb-1 text-xs text-muted-foreground">{config.kind === "new-api" ? "历史使用" : "已用量"}</p><p className="font-mono tabular-nums">{formatAmount(snapshot.used, unit)} {unit}</p></div><div><p className="mb-1 text-xs text-muted-foreground">{config.kind === "new-api" ? "近 24 小时消耗" : "总额度"}</p><p className="font-mono tabular-nums">{formatAmount(config.kind === "new-api" ? snapshot.recentUsage : snapshot.total, unit)} {unit}</p></div></>}
        </div>
        {config.kind === "custom" && snapshot.total !== null && snapshot.used !== null ? <div className="space-y-2"><div role="progressbar" aria-label={`${config.name}已用比例`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={snapshot.total > 0 ? Math.min(100, snapshot.used / snapshot.total * 100) : 0} className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${snapshot.total > 0 ? Math.min(100, snapshot.used / snapshot.total * 100) : 0}%` }} /></div><p className="text-xs text-muted-foreground">{snapshot.total > 0 ? `已使用 ${(snapshot.used / snapshot.total * 100).toFixed(1)}%` : "总额度为 0"}</p></div> : null}
        {config.kind === "new-api" ? <div className="flex justify-between text-xs text-muted-foreground"><span>累计请求数</span><span className="font-mono tabular-nums">{formatAmount(snapshot.requestCount, "次")} 次</span></div> : null}
        {snapshot.detailError ? <p className="text-xs leading-5 text-amber-300">24 小时详情：{snapshot.detailError}</p> : null}
      </> : <p className="text-sm leading-6 text-muted-foreground">{!config.enabled ? "在服务设置中启用查询。" : !config.hasCredential && config.kind !== "custom" ? "填写查询凭据后，余额会显示在这里。" : "等待首次查询结果。"}</p>}
      {error ? <p role="alert" className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-200">{error}{snapshot ? " 上次成功数据已保留。" : ""}</p> : null}
      {snapshot && (snapshot.history.length > 0 || snapshot.breakdown.length > 0) ? <><Button variant="ghost" className="h-8 w-full justify-between px-0 text-xs" onClick={() => setDetails((current) => !current)} aria-expanded={details}>{config.kind === "new-api" ? "查看 24 小时用量曲线" : "查看用量明细"}<ChevronDown className={`size-4 transition-transform ${details ? "rotate-180" : ""}`} /></Button>{details ? <div className="space-y-3 border-t border-border pt-3">{snapshot.history.length ? <UsageChart points={snapshot.history.map((point) => ({ timestamp: point.timestamp, value: point.usage }))} label="24 小时消耗" unit={unit} /> : null}{snapshot.breakdown.map((segment, index) => <div key={`${segment.label}-${index}`} className="flex justify-between gap-3 text-xs"><span className="truncate text-muted-foreground">{segment.label}</span><span className="font-mono">{formatAmount(segment.tokens, unit)} {unit}</span></div>)}</div> : null}</> : null}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3"><div className="min-w-0 space-y-1 text-xs text-muted-foreground"><p>更新于 {formatSample(snapshot?.sampledAt)}</p><p className="flex items-center gap-1"><KeyRound className="size-3" />{config.hasCredential ? "凭据已配置" : "未配置凭据"} · {config.refreshMinutes} 分钟刷新</p></div><Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading || !config.enabled}><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />刷新</Button></div>
    </CardContent>
  </Card>
}
