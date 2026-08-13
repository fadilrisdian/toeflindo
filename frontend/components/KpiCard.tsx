'use client'

interface KpiCardProps {
  label: string
  value: number | null | undefined
  target: number
  suffix?: string
}

export default function KpiCard({ label, value, target, suffix = '' }: KpiCardProps) {
  const display = value != null ? value.toFixed(1) : '—'
  const pct = value != null ? Math.min(100, (value / (target || 6)) * 100) : 0
  const color = value == null ? '#9ca3af' : value >= target ? '#2a7a7a' : value >= target - 1 ? '#f59e0b' : '#ef4444'

  return (
    <div className="card p-5">
      <div className="text-xs text-[#6b7280] font-medium mb-2">{label}</div>
      <div className="flex items-end gap-2 mb-3">
        <span className="text-3xl font-bold" style={{ color }}>{display}</span>
        <span className="text-sm text-[#9ca3af] mb-0.5">{suffix} / {target}</span>
      </div>
      <div className="h-1.5 bg-[#f0f0f0] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}
