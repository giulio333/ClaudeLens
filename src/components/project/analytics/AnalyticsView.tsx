import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, AreaChart, Area,
  PieChart, Pie, Cell,
} from 'recharts'
import { useSessionList, usePricingMeta } from '../../../hooks/useIPC'
import { fmt, fmtModel, modelColor } from '../utils'
import { BackButton } from '../shared/BackButton'
import { StatChip } from '../shared/StatChip'

const SIZE_BUCKETS = [
  { label: '< 10k',   min: 0,       max: 10_000 },
  { label: '10–50k',  min: 10_000,  max: 50_000 },
  { label: '50–100k', min: 50_000,  max: 100_000 },
  { label: '100–200k',min: 100_000, max: 200_000 },
  { label: '> 200k',  min: 200_000, max: Infinity },
]

const MAX_SESSIONS = 100

function ChartCard({ title, subtitle, children }: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-[var(--cl-paper-2)] border border-[var(--cl-line)] rounded-xl p-5">
      <div className="mb-4">
        <h3 className="text-[11px] font-semibold text-[var(--cl-ink-3)] uppercase tracking-widest">{title}</h3>
        {subtitle && <p className="text-[11px] text-[var(--cl-ink-3)] mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

export function AnalyticsView({
  project,
  onBack,
}: {
  project: { hash: string; realPath: string }
  onBack: () => void
}) {
  const { data: allSessions, isLoading } = useSessionList(project.hash)
  const { data: pricingMeta } = usePricingMeta()
  const projectName = project.realPath.split('/').pop() ?? project.realPath

  const knownModels = useMemo(() => new Set(pricingMeta?.knownModels ?? []), [pricingMeta])
  // A model is "estimated" when it's not in the pricing table (priced via the
  // fuzzy family fallback or the conservative default), so its cost is approximate.
  const isEstimated = (model: string) => model !== '<synthetic>' && !knownModels.has(model)

  const sessionsToProcess = useMemo(() => {
    const sorted = allSessions
      ? [...allSessions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      : []
    return sorted.slice(-MAX_SESSIONS)
  }, [allSessions])

  const tokenData = sessionsToProcess.map(s => ({
    label: new Date(s.date).toLocaleDateString('en-US', { day: '2-digit', month: 'short' }),
    Input: Math.round(s.inputTokens / 1000),
    Output: Math.round(s.outputTokens / 1000),
  }))

  const modelTotals: Record<string, number> = {}
  sessionsToProcess.forEach(s => Object.entries(s.models).forEach(([m, c]) => {
    modelTotals[m] = (modelTotals[m] ?? 0) + c
  }))
  const pieData = Object.entries(modelTotals).map(([m, count]) => ({
    name: fmtModel(m),
    value: count,
    color: modelColor(m),
    estimated: isEstimated(m),
  }))
  const estimatedCount = pieData.filter(d => d.estimated).length

  const messagesData = sessionsToProcess.map(s => ({
    label: new Date(s.date).toLocaleDateString('en-US', { day: '2-digit', month: 'short' }),
    Messages: s.messageCount,
  }))

  const histData = SIZE_BUCKETS.map(b => ({
    label: b.label,
    Sessions: sessionsToProcess.filter(s => s.totalTokens >= b.min && s.totalTokens < b.max).length,
  }))

  const totalTokens = sessionsToProcess.reduce((a, s) => a + s.totalTokens, 0)
  const totalInput = sessionsToProcess.reduce((a, s) => a + s.inputTokens, 0)
  const totalOutput = sessionsToProcess.reduce((a, s) => a + s.outputTokens, 0)
  const inputPct = totalTokens > 0 ? Math.round((totalInput / (totalInput + totalOutput)) * 100) : 0
  const outputPct = totalTokens > 0 ? 100 - inputPct : 0
  const avgMessages = sessionsToProcess.length > 0
    ? Math.round(sessionsToProcess.reduce((a, s) => a + s.messageCount, 0) / sessionsToProcess.length)
    : 0

  const AXIS = { tick: { fontSize: 10, fill: 'var(--cl-ink-3)' }, tickLine: false, axisLine: false }
  const TOOLTIP_STYLE = {
    fontSize: 12,
    background: 'var(--cl-paper-3)',
    border: '1px solid var(--cl-line)',
    borderRadius: 8,
    color: 'var(--cl-ink)',
  }
  const TOOLTIP_LABEL_STYLE = { color: 'var(--cl-ink-3)' }
  const GRID_STROKE = 'var(--cl-line)'

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-[var(--cl-paper-3)]/95 backdrop-blur-sm border-b border-[var(--cl-line)] px-8 py-4">
        <div className="flex items-center gap-4 mb-3">
          <BackButton label="Overview" onClick={onBack} />
          <span className="text-[var(--cl-ink-2)]">·</span>
          <span className="text-[13px] font-medium text-[var(--cl-ink-3)]">{projectName}</span>
        </div>
        <div className="flex items-end justify-between">
          <h1 className="text-[17px] font-semibold text-[var(--cl-ink)]">Analytics</h1>
          <div className="flex gap-2">
            <StatChip label="Sessions" value={String(sessionsToProcess.length)} />
            <StatChip label="Total tokens" value={fmt(totalTokens)} />
            <StatChip label="Avg msgs / session" value={String(avgMessages)} accent />
          </div>
        </div>
      </div>

      <div className="px-8 py-5 space-y-4">
        {isLoading && <p className="text-sm text-[var(--cl-ink-3)]">Loading data...</p>}
        {!isLoading && sessionsToProcess.length === 0 && (
          <p className="text-sm text-[var(--cl-ink-3)] italic">No sessions found.</p>
        )}

        {sessionsToProcess.length > 0 && (
          <>
            <div className="grid grid-cols-[1fr_260px] gap-4">
              <ChartCard
                title="Tokens per session"
                subtitle={totalTokens > 0 ? `${inputPct}% input · ${outputPct}% output · values ×1,000` : undefined}
              >
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={tokenData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
                    <YAxis {...AXIS} tickFormatter={v => v + 'k'} />
                    <Tooltip
                      formatter={(v, name) => [(Number(v) || 0) + 'k', String(name)]}
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: 'var(--cl-ink-3)' }} />
                    <Bar dataKey="Input" stackId="t" fill="var(--cl-accent)" activeBar={{ fill: 'var(--cl-accent)' }} />
                    <Bar dataKey="Output" stackId="t" fill="var(--cl-violet)" radius={[3, 3, 0, 0]} activeBar={{ fill: 'var(--cl-violet)' }} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Model mix" subtitle="Message count per model">
                {pieData.length > 0 ? (
                  <div className="flex flex-col items-center">
                    <ResponsiveContainer width="100%" height={160}>
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={70}
                          paddingAngle={2}
                          dataKey="value"
                          stroke="none"
                        >
                          {pieData.map((entry, i) => (
                            <Cell
                              key={i}
                              fill={entry.color}
                              opacity={0.9}
                              style={{ outline: 'none', cursor: 'default' }}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v, name) => [fmt(Number(v)) + ' msgs', String(name)]}
                          contentStyle={TOOLTIP_STYLE}
                          labelStyle={{ ...TOOLTIP_LABEL_STYLE, display: 'none' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    {(() => {
                      const total = pieData.reduce((a, x) => a + x.value, 0)
                      return (
                        <div className="flex flex-col gap-1.5 w-full mt-1">
                          {pieData.map(d => (
                            <div key={d.name} className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                              <span className="text-[11px] text-[var(--cl-ink-3)] flex-1">
                                {d.name}
                                {d.estimated && (
                                  <span
                                    className="text-[var(--cl-ink-4)]"
                                    title="Not in the pricing table — cost estimated from model family"
                                  >
                                    {' '}~
                                  </span>
                                )}
                              </span>
                              <span className="text-[11px] font-mono text-[var(--cl-ink-4)]">{fmt(d.value)}</span>
                              <span className="text-[11px] font-mono text-[var(--cl-ink-3)] w-8 text-right">
                                {Math.round((d.value / total) * 100)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                ) : (
                  <p className="text-[12px] text-[var(--cl-ink-3)] italic">No model data.</p>
                )}
                {pricingMeta && (
                  <p className="text-[10px] text-[var(--cl-ink-4)] mt-3 pt-2 border-t border-[var(--cl-line)]">
                    Pricing as of {pricingMeta.lastUpdated}
                    {estimatedCount > 0 && (
                      <> · {estimatedCount} model{estimatedCount > 1 ? 's' : ''} estimated (~)</>
                    )}
                  </p>
                )}
              </ChartCard>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <ChartCard title="Messages per session" subtitle="Trend over time">
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={messagesData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--cl-accent)" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="var(--cl-accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
                    <YAxis {...AXIS} />
                    <Tooltip
                      formatter={(v) => [String(v), 'Messages']}
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      cursor={{ stroke: 'var(--cl-line)', strokeWidth: 1 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="Messages"
                      stroke="var(--cl-accent)"
                      strokeWidth={2}
                      fill="url(#msgGrad)"
                      dot={sessionsToProcess.length <= 15 ? { r: 3, fill: 'var(--cl-accent)', stroke: 'var(--cl-accent)' } : false}
                      activeDot={{ r: 4, fill: 'var(--cl-accent)', stroke: 'var(--cl-paper-3)', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Session size distribution" subtitle="Number of sessions per total token range">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={histData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="label" {...AXIS} />
                    <YAxis {...AXIS} allowDecimals={false} />
                    <Tooltip
                      formatter={(v) => [String(v), 'Sessions']}
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    />
                    <Bar dataKey="Sessions" fill="var(--cl-haiku)" radius={[3, 3, 0, 0]} activeBar={{ fill: 'var(--cl-haiku)' }} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
