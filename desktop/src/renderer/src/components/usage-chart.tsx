import { useId, useState } from "react"
import { formatAmount } from "../usage-format"

interface ChartPoint { timestamp: number; value: number }

export function UsageChart({ points, label, unit, percent = false }: { points: ChartPoint[]; label: string; unit: string; percent?: boolean }) {
  const id = useId().replace(/:/g, "")
  const [hovered, setHovered] = useState<number | null>(null)
  const width = 720
  const height = 160
  const left = 42
  const right = 706
  const top = 14
  const bottom = 128
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last) return <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">等待本地采样，数据产生后显示趋势</div>
  const maximum = percent ? 100 : Math.max(1, ...points.map((point) => point.value)) * 1.1
  const span = last.timestamp - first.timestamp
  const coordinates = points.map((point, index) => ({
    ...point,
    x: span > 0 ? left + (point.timestamp - first.timestamp) / span * (right - left) : (left + right) / 2,
    y: bottom - Math.min(maximum, Math.max(0, point.value)) / maximum * (bottom - top),
    index,
  }))
  const path = coordinates.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")
  const selected = coordinates[hovered ?? coordinates.length - 1] ?? coordinates.at(-1)!
  const time = (timestamp: number) => new Date(timestamp * 1000).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
  return <div>
    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground" aria-live="polite"><span>{time(selected.timestamp)}</span><span>{formatAmount(selected.value, unit)} {unit}</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" role="img" aria-label={`${label}，${points.length} 个采样点`} onMouseLeave={() => setHovered(null)}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity="0.2" /><stop offset="100%" stopColor="#34d399" stopOpacity="0" /></linearGradient></defs>
      {[0, 0.5, 1].map((fraction) => {
        const y = bottom - fraction * (bottom - top)
        return <g key={fraction}><line x1={left} x2={right} y1={y} y2={y} stroke="currentColor" className="text-border" strokeDasharray="4 5" /><text x={left - 8} y={y + 4} textAnchor="end" fill="currentColor" className="text-muted-foreground" fontSize="10">{formatAmount(maximum * fraction, percent ? "%" : "tokens")}</text></g>
      })}
      <path d={`${path} L${coordinates.at(-1)!.x},${bottom} L${coordinates[0]!.x},${bottom} Z`} fill={`url(#${id})`} />
      <path d={path} fill="none" stroke="#34d399" strokeWidth="2" strokeLinejoin="round" />
      <line x1={selected.x} x2={selected.x} y1={top} y2={bottom} stroke="#34d399" opacity="0.25" />
      <circle cx={selected.x} cy={selected.y} r="4" fill="#34d399" />
      <rect x={left} y={top} width={right - left} height={bottom - top} fill="transparent" onMouseMove={(event) => {
        const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect()
        const x = (event.clientX - rect.left) / rect.width * width
        const closest = coordinates.reduce((previous, point) => Math.abs(point.x - x) < Math.abs(previous.x - x) ? point : previous)
        setHovered(closest.index)
      }} />
      <text x={left} y={height - 5} fill="currentColor" className="text-muted-foreground" fontSize="10">{time(first.timestamp)}</text>
      {points.length > 1 ? <text x={right} y={height - 5} textAnchor="end" fill="currentColor" className="text-muted-foreground" fontSize="10">{time(last.timestamp)}</text> : null}
    </svg>
    <input className="mt-1 h-3 w-full accent-emerald-400" type="range" min={0} max={Math.max(0, points.length - 1)} value={hovered ?? points.length - 1} onChange={(event) => setHovered(Number(event.target.value))} aria-label={`查看${label}采样点`} disabled={points.length < 2} />
  </div>
}
