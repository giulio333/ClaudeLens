import { fmtModel, modelColor } from '../utils'

export function ModelChip({ model, pct }: { model: string; pct: number }) {
  const color = modelColor(model)
  return (
    <div
      className="relative flex items-center gap-2 rounded-lg border border-[#252836] bg-[#161a26] px-3 py-1.5 overflow-hidden"
    >
      <div
        className="absolute inset-y-0 left-0 rounded-l-lg"
        style={{ width: `${pct}%`, background: color, opacity: 0.08 }}
      />
      <span className="relative text-[12px] font-semibold" style={{ color }}>{fmtModel(model)}</span>
      <span className="relative text-[11px] font-mono text-zinc-400">{pct}%</span>
    </div>
  )
}

export function ModelUsageBadge({ models }: { models: Record<string, number> }) {
  const entries = Object.entries(models).filter(([k]) => k !== '<synthetic>')
  if (entries.length === 0) return null

  const total = entries.reduce((s, [, c]) => s + c, 0)
  const sorted = entries.sort((a, b) => b[1] - a[1])

  return (
    <div className="flex items-center gap-1.5">
      {sorted.map(([model, count]) => (
        <ModelChip
          key={model}
          model={model}
          pct={sorted.length === 1 ? 100 : Math.round((count / total) * 100)}
        />
      ))}
    </div>
  )
}
