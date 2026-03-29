import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, AreaChart, Area,
  PieChart, Pie, Cell,
} from 'recharts'
import { useSessionList } from '../../../hooks/useIPC'
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
    <div className="bg-[#161a26] border border-[#252836] rounded-xl p-5">
      <div className="mb-4">
        <h3 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-widest">{title}</h3>
        {subtitle && <p className="text-[11px] text-zinc-400 mt-0.5">{subtitle}</p>}
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
  const projectName = project.realPath.split('/').pop() ?? project.realPath

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
  }))

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

  const AXIS = { tick: { fontSize: 10, fill: '#787e98' }, tickLine: false, axisLine: false }
  const TOOLTIP_STYLE = {
    fontSize: 12,
    background: '#1c2235',
    border: '1px solid #252836',
    borderRadius: 8,
    color: '#e0e2f0',
  }
  const TOOLTIP_LABEL_STYLE = { color: '#9096b0' }
  const GRID_STROKE = '#252836'

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-[#0d0f14]/95 backdrop-blur-sm border-b border-[#252836] px-8 py-4">
        <div className="flex items-center gap-4 mb-3">
          <BackButton label="Overview" onClick={onBack} />
          <span className="text-zinc-300">·</span>
          <span className="text-[13px] font-medium text-[#9096b0]">{projectName}</span>
        </div>
        <div className="flex items-end justify-between">
          <h1 className="text-[17px] font-semibold text-[#e0e2f0]">Analytics</h1>
          <div className="flex gap-2">
            <StatChip label="Sessions" value={String(sessionsToProcess.length)} />
            <StatChip label="Total tokens" value={fmt(totalTokens)} />
            <StatChip label="Avg msgs / session" value={String(avgMessages)} accent />
          </div>
        </div>
      </div>

      <div className="px-8 py-5 space-y-4">
        {isLoading && <p className="text-sm text-zinc-400">Loading data...</p>}
        {!isLoading && sessionsToProcess.length === 0 && (
          <p className="text-sm text-zinc-400 italic">No sessions found.</p>
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
                    <Legend wrapperStyle={{ fontSize: 11, color: '#9096b0' }} />
                    <Bar dataKey="Input" stackId="t" fill="#4f46e5" activeBar={{ fill: '#6366f1' }} />
                    <Bar dataKey="Output" stackId="t" fill="#7c3aed" radius={[3, 3, 0, 0]} activeBar={{ fill: '#9333ea' }} />
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
                              <span className="text-[11px] text-[#787e98] flex-1">{d.name}</span>
                              <span className="text-[11px] font-mono text-[#555c75]">{fmt(d.value)}</span>
                              <span className="text-[11px] font-mono text-zinc-400 w-8 text-right">
                                {Math.round((d.value / total) * 100)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                ) : (
                  <p className="text-[12px] text-zinc-400 italic">No model data.</p>
                )}
              </ChartCard>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <ChartCard title="Messages per session" subtitle="Trend over time">
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={messagesData} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="msgGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
                    <YAxis {...AXIS} />
                    <Tooltip
                      formatter={(v) => [String(v), 'Messages']}
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                      cursor={{ stroke: '#252836', strokeWidth: 1 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="Messages"
                      stroke="#4f46e5"
                      strokeWidth={2}
                      fill="url(#msgGrad)"
                      dot={sessionsToProcess.length <= 15 ? { r: 3, fill: '#4f46e5', stroke: '#4f46e5' } : false}
                      activeDot={{ r: 4, fill: '#6366f1', stroke: '#1c2235', strokeWidth: 2 }}
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
                    <Bar dataKey="Sessions" fill="#0d9488" radius={[3, 3, 0, 0]} activeBar={{ fill: '#14b8a6' }} />
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
