import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bot, Clock3, Database, Plus, RefreshCw, TrendingUp } from "lucide-react"
import type { ApiProviderConfig, ApiProviderState, CodexQuotaData, QuotaHistoryPoint, QuotaWindow } from "../../../shared/usage"
import { currentQuotaCycle, estimateMonthlyQuota, quotaSeries } from "../../../shared/quota-history"
import { formatPeriod, formatReset, formatSample, usageError } from "../usage-format"
import { ApiProviderCard } from "./api-provider-card"
import { ApiProviderEditor, newApiProvider } from "./api-provider-editor"
import { UsageChart } from "./usage-chart"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

function QuotaWindowCard({ window, now, sampledAt }: { window: QuotaWindow; now: number; sampledAt: string }) {
  const expired = window.resetsAt * 1000 <= now
  const low = window.remainingPercent <= 20
  return <div className="space-y-3 rounded-lg border border-border bg-background p-4">
    <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{formatPeriod(window.windowMinutes)}周期</span><Badge variant="outline" className={expired || low ? "text-amber-300" : "text-emerald-300"}>{expired ? "等待采样" : low ? "额度较低" : "可用"}</Badge></div>
    <div className="flex items-baseline gap-2"><strong className="font-mono text-4xl font-semibold tracking-tight tabular-nums">{window.remainingPercent.toFixed(1)}<span className="ml-1 text-lg text-muted-foreground">%</span></strong><span className="text-xs text-muted-foreground">剩余</span></div>
    <div role="progressbar" aria-label={`${formatPeriod(window.windowMinutes)}周期剩余额度`} aria-valuenow={window.remainingPercent} aria-valuemin={0} aria-valuemax={100} className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full transition-[width] ${expired ? "bg-muted-foreground" : low ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${window.remainingPercent}%` }} /></div>
    <div className="space-y-1 text-xs text-muted-foreground"><p className="flex items-center gap-1.5"><Clock3 className="size-3.5" />{formatReset(window.resetsAt, now)}</p><p>重置时间 {formatSample(new Date(window.resetsAt * 1000).toISOString())}</p>{expired ? <p>显示的是 {formatSample(sampledAt)} 的最后采样。</p> : null}</div>
  </div>
}

export function CodexUsagePage() {
  const [quota, setQuota] = useState<CodexQuotaData | null>(null)
  const [quotaError, setQuotaError] = useState<string | null>(null)
  const [loadingQuota, setLoadingQuota] = useState(true)
  const [providers, setProviders] = useState<ApiProviderState[]>([])
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [providersError, setProvidersError] = useState<string | null>(null)
  const [editor, setEditor] = useState<ApiProviderConfig | null>(null)
  const [selectedLimit, setSelectedLimit] = useState("")
  const [selectedWindow, setSelectedWindow] = useState<QuotaHistoryPoint["window"] | null>(null)
  const [now, setNow] = useState(Date.now)
  const mounted = useRef(false)
  const quotaPending = useRef(false)
  const refreshQuota = useCallback(async () => {
    if (quotaPending.current) return
    quotaPending.current = true
    setLoadingQuota(true)
    try {
      const next = await window.azoria.usage.codex()
      if (mounted.current) { setQuota(next); setQuotaError(null) }
    } catch (error) { if (mounted.current) setQuotaError(usageError(error)) }
    finally { quotaPending.current = false; if (mounted.current) setLoadingQuota(false) }
  }, [])
  const loadProviders = useCallback(async () => {
    setLoadingProviders(true)
    try {
      const next = await window.azoria.usage.providers()
      if (mounted.current) { setProviders(next); setProvidersError(null) }
    } catch (error) { if (mounted.current) setProvidersError(usageError(error)) }
    finally { if (mounted.current) setLoadingProviders(false) }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refreshQuota(); void loadProviders()
    const quotaTimer = window.setInterval(() => { if (!document.hidden) void refreshQuota() }, 60_000)
    const clockTimer = window.setInterval(() => setNow(Date.now()), 30_000)
    const onVisible = () => { if (!document.hidden) { setNow(Date.now()); void refreshQuota() } }
    document.addEventListener("visibilitychange", onVisible)
    return () => { mounted.current = false; clearInterval(quotaTimer); clearInterval(clockTimer); document.removeEventListener("visibilitychange", onVisible) }
  }, [refreshQuota, loadProviders])

  const onUpdate = useCallback((provider: ApiProviderState) => {
    setProviders((current) => current.some((item) => item.config.id === provider.config.id)
      ? current.map((item) => item.config.id === provider.config.id ? provider : item) : [...current, provider])
  }, [])
  const deleteProvider = async (id: string) => {
    await window.azoria.usage.deleteProvider(id)
    setProviders((current) => current.filter((provider) => provider.config.id !== id))
  }
  const saveProvider = (provider: ApiProviderState) => {
    onUpdate(provider)
    if (provider.config.enabled) {
      void window.azoria.usage.refreshProvider(provider.config.id).then((next) => {
        if (mounted.current) onUpdate(next)
      }).catch(() => { /* The card exposes a retry action and keeps the saved configuration. */ })
    }
  }
  const snapshot = quota?.snapshots.find((item) => item.limitId === selectedLimit) ?? quota?.snapshots[0]
  const windowKind = selectedWindow ?? (snapshot?.secondary && (!snapshot.primary || snapshot.secondary.windowMinutes > snapshot.primary.windowMinutes) ? "secondary" : "primary")
  const trendWindow = snapshot?.[windowKind]
  const series = useMemo(() => snapshot ? quotaSeries(quota?.history ?? [], snapshot.limitId, windowKind) : [], [quota?.history, snapshot?.limitId, windowKind])
  const cycle = useMemo(() => currentQuotaCycle(series), [series])
  const estimate = useMemo(() => estimateMonthlyQuota(series), [series])
  const stale = !!snapshot && (snapshot.stale || now - Date.parse(snapshot.sampledAt) >= 6 * 3600_000)
  return <div className="space-y-6">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Codex / API</h1><p className="mt-2 text-sm text-muted-foreground">额度、余额与用量，一处查看。</p></div><Badge variant="outline" className="mt-1 gap-1.5 font-normal text-muted-foreground"><Database className="size-3.5" />本机数据</Badge></div>
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div className="space-y-2"><CardTitle className="flex items-center gap-2 text-base"><Bot className="size-5 text-emerald-400" />Codex 额度</CardTitle><CardDescription>{snapshot ? `${snapshot.planType === "unknown" ? "套餐未知" : snapshot.planType.toUpperCase()} · ${snapshot.limitName}` : "读取本机 Codex 最新额度记录"}</CardDescription></div><Button variant="outline" size="sm" onClick={() => void refreshQuota()} disabled={loadingQuota}><RefreshCw className={`size-3.5 ${loadingQuota ? "animate-spin" : ""}`} />刷新</Button></CardHeader>
        <CardContent className="space-y-4">
          {quotaError ? <p role="alert" className="rounded-lg border border-amber-400/20 p-3 text-xs leading-5 text-amber-200">{quotaError}{quota ? " 上次额度数据已保留。" : ""}</p> : null}
          {quota && quota.snapshots.length > 1 ? <Select value={snapshot?.limitId} onValueChange={(value) => { setSelectedLimit(value); setSelectedWindow(null) }}><SelectTrigger aria-label="选择 Codex 额度组"><SelectValue /></SelectTrigger><SelectContent>{quota.snapshots.map((item) => <SelectItem key={item.limitId} value={item.limitId}>{item.limitName} · {item.limitId}</SelectItem>)}</SelectContent></Select> : null}
          {snapshot ? <>
            <div className="grid gap-3 sm:grid-cols-2">{snapshot.primary ? <QuotaWindowCard window={snapshot.primary} now={now} sampledAt={snapshot.sampledAt} /> : null}{snapshot.secondary ? <QuotaWindowCard window={snapshot.secondary} now={now} sampledAt={snapshot.sampledAt} /> : null}</div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>采样于 {formatSample(snapshot.sampledAt)}</span><Badge variant="outline" className={`font-normal ${stale ? "text-amber-300" : "text-muted-foreground"}`}>{stale ? "数据较旧" : "已同步"}</Badge></div>
            {stale ? <p className="text-xs leading-5 text-amber-200">本地额度记录已有一段时间未更新，Codex 产生新的额度事件后会自动同步。</p> : null}
            {snapshot.credits?.unlimited || snapshot.credits?.balance !== null && snapshot.credits?.balance !== undefined ? <p className="text-xs text-muted-foreground">额外 credits：{snapshot.credits.unlimited ? "不限额" : snapshot.credits.balance}</p> : null}
          </> : <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 text-center"><Bot className={`size-8 text-muted-foreground ${loadingQuota ? "animate-pulse" : ""}`} /><p className="text-sm">{loadingQuota ? "正在查找额度记录…" : "暂未找到 Codex 额度记录"}</p><p className="max-w-sm text-xs leading-6 text-muted-foreground">在本机 Codex 中完成一次对话后，有效的额度事件会同步到这里。</p></div>}
          {quota?.warnings.map((warning) => <p key={warning} className="text-xs leading-5 text-amber-200">{warning}</p>)}
          <details className="border-t border-border pt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">数据来源与检查时间</summary><div className="mt-2 space-y-2 leading-5"><p className="break-all font-mono">{quota?.codexHome ?? "CODEX_HOME / ~/.codex"}</p><p>活动和归档会话中的额度字段 · 每分钟检查</p><p>最近检查 {formatSample(quota?.checkedAt)}</p></div></details>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div className="space-y-2"><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="size-5 text-emerald-400" />额度趋势</CardTitle><CardDescription>{trendWindow ? `当前 ${formatPeriod(trendWindow.windowMinutes)}周期 · 本地采样` : "采样会随桌面页使用逐步积累"}</CardDescription></div>{snapshot?.primary && snapshot.secondary ? <Select value={windowKind} onValueChange={(value) => setSelectedWindow(value as QuotaHistoryPoint["window"])}><SelectTrigger className="w-28" aria-label="选择趋势周期"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="primary">{formatPeriod(snapshot.primary.windowMinutes)}</SelectItem><SelectItem value="secondary">{formatPeriod(snapshot.secondary.windowMinutes)}</SelectItem></SelectContent></Select> : null}</CardHeader>
        <CardContent className="space-y-4"><UsageChart points={cycle.map((point) => ({ timestamp: point.sampledAt, value: point.usedPercent }))} label="Codex 已用额度" unit="%" percent />
          <div className="grid grid-cols-2 gap-4 border-t border-border pt-4"><div><p className="text-xs text-muted-foreground">30 天本地估算</p><p className="mt-2 font-mono text-2xl tabular-nums">{estimate.percent === null ? "—" : `${estimate.percent.toFixed(1)}%`}</p></div><div><p className="text-xs text-muted-foreground">采样情况</p><p className="mt-2 text-sm">{series.length} 个点 · 可信度{estimate.confidence}</p><p className="mt-1 text-xs text-muted-foreground">{estimate.days > 0 ? `已观察 ${estimate.days.toFixed(1)} 天` : "等待更多有效采样"}</p></div></div>
          <p className="text-xs leading-5 text-muted-foreground">按已观察到的消耗推算 30 天用量；100% 表示一个周期的额度。此数值为本地估算，采样缺失可能低估消耗。</p>
        </CardContent>
      </Card>
    </div>
    <section aria-labelledby="api-services-title" className="space-y-4"><div className="flex items-center justify-between gap-4"><div><h2 id="api-services-title" className="text-lg font-semibold">API 服务</h2><p className="mt-1 text-xs text-muted-foreground">DeepSeek · New API · 自定义用量接口</p></div><Button variant="outline" size="sm" onClick={() => setEditor(newApiProvider())} disabled={loadingProviders || !!providersError}><Plus className="size-4" />添加服务</Button></div>
      {providersError ? <Card><CardContent className="flex items-center justify-between gap-4 pt-6"><p role="alert" className="text-sm text-amber-200">{providersError}</p><Button variant="outline" onClick={() => void loadProviders()} disabled={loadingProviders}>重试</Button></CardContent></Card> : loadingProviders ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">正在读取 API 服务…</CardContent></Card> : providers.length ? <div className="grid items-start gap-5 lg:grid-cols-2">{providers.map((provider) => <ApiProviderCard key={provider.config.id} provider={provider} onEdit={setEditor} onDelete={deleteProvider} onUpdate={onUpdate} />)}</div> : <Card><CardContent className="flex flex-col items-center gap-3 py-9 text-center"><div className="rounded-full border border-border p-3"><Plus className="size-5 text-muted-foreground" /></div><p className="text-sm font-medium">添加第一个 API 服务</p><p className="max-w-md text-xs leading-6 text-muted-foreground">填写服务地址与查询凭据，就能查看账户余额、消耗与用量明细。</p><Button variant="outline" size="sm" onClick={() => setEditor(newApiProvider())}>配置 API 服务</Button></CardContent></Card>}
    </section>
    {editor ? <ApiProviderEditor initial={editor} onClose={() => setEditor(null)} onSaved={saveProvider} /> : null}
  </div>
}
