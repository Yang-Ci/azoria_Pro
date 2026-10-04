import { useState, type FormEvent } from "react"
import { FlaskConical, Loader2, ShieldCheck } from "lucide-react"
import type { ApiProviderConfig, ApiProviderInput, ApiProviderKind, ApiProviderState } from "../../../shared/usage"
import { usageError, formatAmount } from "../usage-format"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

export function newApiProvider(): ApiProviderConfig {
  return {
    id: "", kind: "new-api", name: "New API", enabled: true, baseUrl: "", accountUserId: "",
    refreshMinutes: 5, method: "GET", body: "", usedPath: "/used", totalPath: "/total",
    breakdownPath: "", unit: "tokens", hasCredential: false,
  }
}

export function ApiProviderEditor({ initial, onClose, onSaved }: { initial: ApiProviderConfig; onClose(): void; onSaved(provider: ApiProviderState): void }) {
  const [draft, setDraft] = useState(initial)
  const [credential, setCredential] = useState("")
  const [clearCredential, setClearCredential] = useState(false)
  const [busy, setBusy] = useState<"save" | "test" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const update = <K extends keyof ApiProviderConfig>(key: K, value: ApiProviderConfig[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setTestResult(null)
    setError(null)
  }
  const input = (): ApiProviderInput => ({ config: draft, credential: clearCredential ? "" : credential.trim() || undefined })
  const changeKind = (kind: ApiProviderKind) => {
    setDraft((current) => ({ ...current, kind, name: kind === "deepseek" ? "DeepSeek" : kind === "new-api" ? "New API" : "自定义用量", baseUrl: kind === "deepseek" ? "https://api.deepseek.com" : "", hasCredential: kind === initial.kind && initial.hasCredential }))
    setCredential(""); setClearCredential(false); setTestResult(null); setError(null)
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy("save"); setError(null)
    try { onSaved(await window.azoria.usage.saveProvider(input())); onClose() }
    catch (error) { setError(usageError(error)) }
    finally { setBusy(null) }
  }
  const test = async () => {
    setBusy("test"); setError(null); setTestResult(null)
    try {
      const result = await window.azoria.usage.testProvider(input())
      setTestResult(`连接成功，剩余 ${formatAmount(result.remaining, result.unit)} ${result.unit}${result.detailError ? "；余额可用，24 小时详情暂不可用" : ""}`)
    } catch (error) { setError(usageError(error)) }
    finally { setBusy(null) }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }} onInteractOutside={(event) => { if (busy) event.preventDefault() }}>
      <DialogHeader><DialogTitle>{initial.id ? "编辑 API 服务" : "添加 API 服务"}</DialogTitle><DialogDescription>设置余额或用量查询。测试连接使用当前填写内容，保存后自动更新。</DialogDescription></DialogHeader>
      <form onSubmit={(event) => void save(event)} className="space-y-4">
        <fieldset disabled={!!busy} className="space-y-4 disabled:opacity-70">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label htmlFor="provider-kind">服务类型</Label><Select value={draft.kind} onValueChange={(value) => changeKind(value as ApiProviderKind)} disabled={!!busy}><SelectTrigger id="provider-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new-api">New API 中转站</SelectItem><SelectItem value="deepseek">DeepSeek 官方</SelectItem><SelectItem value="custom">自定义用量接口</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="provider-name">名称</Label><Input id="provider-name" value={draft.name} onChange={(event) => update("name", event.target.value)} maxLength={80} required /></div>
          </div>
          {draft.kind !== "deepseek" ? <div className="space-y-2"><Label htmlFor="provider-url">{draft.kind === "new-api" ? "中转站地址" : "查询接口地址"}</Label><Input id="provider-url" type="url" placeholder={draft.kind === "new-api" ? "https://api.example.com" : "https://api.example.com/usage"} value={draft.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} required maxLength={2048} /></div> : null}
          {draft.kind === "new-api" ? <div className="space-y-2"><Label htmlFor="provider-user">数字用户 ID（旧版 New API 需要）</Label><Input id="provider-user" inputMode="numeric" pattern="[0-9]*" placeholder="可选，例如 123" value={draft.accountUserId} onChange={(event) => update("accountUserId", event.target.value)} maxLength={32} /><p className="text-xs leading-5 text-muted-foreground">使用个人资料中的账户访问令牌 PAT 查询账户余额和用量。</p></div> : null}
          <div className="space-y-2"><Label htmlFor="provider-credential">{draft.kind === "new-api" ? "账户访问令牌 PAT" : draft.kind === "deepseek" ? "API Key" : "Authorization（可选）"}</Label><Input id="provider-credential" type="password" autoComplete="off" spellCheck={false} value={credential} disabled={clearCredential} onChange={(event) => { setCredential(event.target.value); setTestResult(null) }} placeholder={draft.hasCredential ? "已配置，留空保留原凭据" : draft.kind === "custom" ? "例如 Bearer your-token" : "填写查询凭据"} maxLength={8192} />
            {draft.hasCredential ? <div className="flex items-center justify-between"><Label htmlFor="provider-clear" className="text-xs text-muted-foreground">清除已保存凭据</Label><Switch id="provider-clear" checked={clearCredential} onCheckedChange={(value) => { setClearCredential(value); setTestResult(null) }} disabled={!!busy} /></div> : null}
          </div>
          {draft.kind === "custom" ? <>
            <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="provider-method">请求方式</Label><Select value={draft.method} onValueChange={(value) => update("method", value as "GET" | "POST")} disabled={!!busy}><SelectTrigger id="provider-method"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="GET">GET</SelectItem><SelectItem value="POST">POST</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="provider-unit">用量单位</Label><Input id="provider-unit" value={draft.unit} onChange={(event) => update("unit", event.target.value)} placeholder="tokens" maxLength={24} /></div></div>
            {draft.method === "POST" ? <div className="space-y-2"><Label htmlFor="provider-body">JSON 请求体</Label><Textarea id="provider-body" className="font-mono" value={draft.body} onChange={(event) => update("body", event.target.value)} placeholder={'{"range":"month"}'} maxLength={65_536} /></div> : null}
            <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="provider-used">已用量字段</Label><Input id="provider-used" className="font-mono" value={draft.usedPath} onChange={(event) => update("usedPath", event.target.value)} placeholder="/data/used" required /></div><div className="space-y-2"><Label htmlFor="provider-total">总额度字段</Label><Input id="provider-total" className="font-mono" value={draft.totalPath} onChange={(event) => update("totalPath", event.target.value)} placeholder="/data/total" required /></div></div>
            <div className="space-y-2"><Label htmlFor="provider-breakdown">明细字段（可选）</Label><Input id="provider-breakdown" className="font-mono" value={draft.breakdownPath} onChange={(event) => update("breakdownPath", event.target.value)} placeholder="/data/breakdown" /><p className="text-xs leading-5 text-muted-foreground">字段路径使用 / 分隔。明细数组每项包含 label 和 tokens。</p></div>
          </> : null}
          <div className="flex items-end justify-between gap-4"><div className="w-44 space-y-2"><Label htmlFor="provider-interval">刷新间隔（分钟）</Label><Input id="provider-interval" type="number" min={1} max={1440} value={draft.refreshMinutes} onChange={(event) => update("refreshMinutes", Number(event.target.value))} required /></div><div className="mb-2 flex items-center gap-3"><Label htmlFor="provider-enabled">启用查询</Label><Switch id="provider-enabled" checked={draft.enabled} onCheckedChange={(value) => update("enabled", value)} disabled={!!busy} /></div></div>
        </fieldset>
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 shrink-0" />凭据经系统加密保存，查询结果保留在本机。</p>
        {error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-red-300">{error}</p> : null}
        {testResult ? <p role="status" className="rounded-md border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-300">{testResult}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={onClose} disabled={!!busy}>取消</Button><Button type="button" variant="outline" onClick={() => void test()} disabled={!!busy}>{busy === "test" ? <Loader2 className="animate-spin" /> : <FlaskConical />}测试连接</Button><Button type="submit" disabled={!!busy}>{busy === "save" ? <Loader2 className="animate-spin" /> : null}保存</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}
