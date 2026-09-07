import { useCallback, useEffect, useState } from "react"
import { ArrowRight, Check, RefreshCw, RotateCcw, Wand2 } from "lucide-react"
import type { InputSource, MonitorConnectionInfo, MonitorProfileMatchState, MonitorProfileSource, MonitorProfileWizardInfo, MonitorStatus, MonitorSystem, MonitorTransport } from "../../../shared/contracts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"

const steps = ["检测", "匹配", "验证", "完成"]

const sourceLabels: Record<MonitorProfileSource, string> = {
  "built-in": "内置",
  user: "本机",
}

const matchLabels: Record<MonitorProfileMatchState, string> = {
  selected: "当前",
  match: "匹配",
  fallback: "回退",
  available: "可用",
}

const inputOptions: Array<{ value: InputSource; label: string }> = [
  { value: "dp1", label: "DisplayPort" },
  { value: "hdmi1", label: "HDMI 1" },
  { value: "hdmi2", label: "HDMI 2" },
  { value: "usbc", label: "USB-C" },
]

function transportLabel(transport: MonitorTransport, system?: MonitorSystem) {
  if (transport === "usb-hid-ddc") return "USB HID → DDC/CI"
  if (transport === "video-ddc") return "视频链路 → DDC/CI"
  if (transport === "internal-panel") {
    if (system === "linux") return "Linux 笔记本内屏"
    if (system === "windows") return "Windows 笔记本内屏"
    return "笔记本内屏"
  }
  return "不可用"
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-white/10 p-4 text-sm">
      <span className="text-zinc-400">{label}</span>
      <span className="text-right text-white">{value}</span>
    </div>
  )
}

export function ProfileWizard({ onConnectionChange }: { onConnectionChange(connection: MonitorConnectionInfo): void }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<MonitorProfileWizardInfo | null>(null)
  const [status, setStatus] = useState<MonitorStatus | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState("")
  const [brightness, setBrightness] = useState(50)
  const [input, setInput] = useState<InputSource>("usbc")
  const [error, setError] = useState("")

  const load = useCallback(async (force = false) => {
    setBusy(true)
    try {
      const next = await window.azoria.monitor.profileWizard(force)
      setInfo(next)
      setSelectedProfileId(next.selectedProfileId ?? next.profiles[0]?.id ?? "")
      const snapshot = await window.azoria.monitor.statusSnapshot()
      setStatus(snapshot)
      setBrightness(snapshot.brightness)
      setInput(snapshot.input)
      setError("")
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "配置向导读取失败")
    }
    finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load(true)
  }, [open, load])

  const applyProfile = async () => {
    if (!selectedProfileId) return
    setBusy(true)
    try {
      const connection = await window.azoria.monitor.activateProfile(selectedProfileId)
      onConnectionChange(connection)
      const next = await window.azoria.monitor.profileWizard()
      setInfo(next)
      setError("")
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "配置应用失败")
    }
    finally {
      setBusy(false)
    }
  }

  const changeDisplay = async (displayId: string) => {
    setBusy(true)
    try {
      const connection = await window.azoria.monitor.selectDisplay(displayId)
      onConnectionChange(connection)
      await load(true)
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "显示器切换失败")
    }
    finally {
      setBusy(false)
    }
  }

  const resetProfile = async () => {
    setBusy(true)
    try {
      const connection = await window.azoria.monitor.resetProfile()
      onConnectionChange(connection)
      const next = await window.azoria.monitor.profileWizard()
      setInfo(next)
      setSelectedProfileId(next.selectedProfileId ?? next.profiles[0]?.id ?? "")
      setError("")
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "自动匹配恢复失败")
    }
    finally {
      setBusy(false)
    }
  }

  const readStatus = async () => {
    setBusy(true)
    try {
      const next = await window.azoria.monitor.status()
      setStatus(next)
      setError("")
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "状态读取失败")
    }
    finally {
      setBusy(false)
    }
  }

  const writeBrightness = async () => {
    setBusy(true)
    try {
      const next = await window.azoria.monitor.control({ control: "brightness", value: brightness, final: true })
      setStatus(next)
      setError("")
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "亮度写入失败")
    }
    finally {
      setBusy(false)
    }
  }

  const writeInput = async () => {
    setBusy(true)
    try {
      const next = await window.azoria.monitor.control({ control: "input", value: input, final: true })
      setStatus(next)
      setError("")
    }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "输入源写入失败")
    }
    finally {
      setBusy(false)
    }
  }

  const selectedProfile = info?.profiles.find((profile) => profile.id === selectedProfileId)
  const activeProfile = info?.profiles.find((profile) => profile.id === info.selectedProfileId)
  const internalPanel = info?.activeTransport === "internal-panel"

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setStep(0)
          setError("")
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline"><Wand2 />Profile 向导</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>显示器 Profile 向导</DialogTitle>
          <DialogDescription>{steps[step]}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          {steps.map((label, index) => (
            <div
              key={label}
              className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-white" : "bg-white/15"}`}
              aria-label={label}
            />
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-[80px_1fr] items-center gap-4">
              <Label>目标</Label>
              <Select value={info?.activeDisplayId ?? ""} onValueChange={(value) => void changeDisplay(value)}>
                <SelectTrigger disabled={busy}><SelectValue placeholder="选择显示器" /></SelectTrigger>
                <SelectContent>
                  {info?.displays.map((display) => (
                    <SelectItem key={display.id} value={display.id}>{display.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <InfoRow label="显示器" value={info?.displayName ?? "--"} />
            <InfoRow label="可用路径" value={info?.availableTransports.map((transport) => transportLabel(transport)).join(" / ") || "--"} />
            <InfoRow label="USB HID" value={info?.detectedUsbHid ? `${info.detectedUsbHid.vendorId} / ${info.detectedUsbHid.productId}` : "--"} />
            <InfoRow label="当前 Profile" value={activeProfile?.name ?? "--"} />
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {info?.profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setSelectedProfileId(profile.id)}
                  className={`w-full rounded-lg border p-4 text-left transition-colors ${
                    selectedProfileId === profile.id ? "border-white/40 bg-white/10" : "border-white/10 bg-black hover:border-white/25"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-white">{profile.name}</span>
                    <Badge variant="outline" className="border-white/10">{matchLabels[profile.matchState]}</Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                    <span>{sourceLabels[profile.source]}</span>
                    <span>·</span>
                    <span>{profile.transports.map((transport) => transportLabel(transport)).join(" / ")}</span>
                  </div>
                </button>
              ))}
              {!info?.profiles.length && <p className="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">暂无配置表</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={busy || !info?.manualProfileId} onClick={() => void resetProfile()}><RotateCcw />恢复自动</Button>
              <Button disabled={busy || !selectedProfileId || selectedProfileId === info?.selectedProfileId} onClick={() => void applyProfile()}><Check />应用</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <InfoRow label="Profile" value={activeProfile?.name ?? "--"} />
            <InfoRow label="路径" value={info ? transportLabel(info.activeTransport, info.displays.find((display) => display.id === info.activeDisplayId)?.system) : "--"} />
            <div className="flex items-center gap-4">
              <Button variant="outline" disabled={busy} onClick={() => void readStatus()}><RefreshCw />读取状态</Button>
              <span className="font-mono text-sm tabular-nums text-zinc-400">
                {internalPanel
                  ? `亮度 ${status?.brightness ?? "--"}`
                  : `亮度 ${status?.brightness ?? "--"} · 音量 ${status?.volume ?? "--"} · 输入 {status?.input ?? "--"}`}
              </span>
            </div>
            <Separator />
            <div className="grid grid-cols-[80px_1fr_72px] items-center gap-4">
              <Label>亮度</Label>
              <Slider value={[brightness]} max={100} step={1} onValueChange={(next) => setBrightness(next[0] ?? 0)} />
              <span className="text-right font-mono text-sm tabular-nums text-white">{brightness}</span>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" disabled={busy} onClick={() => void writeBrightness()}>写入亮度</Button>
            </div>
            <Separator />
            <div className="grid grid-cols-[80px_1fr] items-center gap-4">
              <Label>输入源</Label>
              <Select value={input} onValueChange={(next) => setInput(next as InputSource)} disabled={internalPanel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {inputOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" disabled={busy || internalPanel} onClick={() => void writeInput()}>切换输入源</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <InfoRow label="显示器" value={info?.displayName ?? "--"} />
            <InfoRow label="Profile" value={activeProfile?.name ?? "--"} />
            <InfoRow label="来源" value={activeProfile ? sourceLabels[activeProfile.source] : "--"} />
            <InfoRow label="匹配方式" value={info?.manualProfileId ? "手动选择" : "自动匹配"} />
            <InfoRow label="路径" value={info ? transportLabel(info.activeTransport, info.displays.find((display) => display.id === info.activeDisplayId)?.system) : "--"} />
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <DialogFooter>
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((current) => Math.max(0, current - 1))}>上一步</Button>
          )}
          {step < steps.length - 1 && (
            <Button disabled={busy || !info || (step === 1 && !selectedProfileId)} onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}>
              下一步<ArrowRight />
            </Button>
          )}
          {step === steps.length - 1 && (
            <Button onClick={() => setOpen(false)}>完成</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
