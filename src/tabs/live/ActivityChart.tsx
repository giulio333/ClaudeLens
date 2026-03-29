// claudelens-app/src/tabs/live/ActivityChart.tsx
import { useState, useEffect } from 'react'
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { LiveEvent } from '../../hooks/useIPC'
import { Bucket, WINDOW_S } from './types'

export function buildBuckets(events: LiveEvent[]): Bucket[] {
  const now = Date.now()
  const buckets: Bucket[] = Array.from({ length: WINDOW_S }, (_, i) => {
    const age = WINDOW_S - 1 - i
    return { t: now - age * 1000, relT: age === 0 ? 'now' : `-${age}s`, call: 0, think: 0, result: 0, err: 0 }
  })

  for (const ev of events) {
    const ageS = Math.floor((now - new Date(ev.timestamp).getTime()) / 1000)
    if (ageS < 0 || ageS >= WINDOW_S) continue
    const b = buckets[WINDOW_S - 1 - ageS]
    if (!b) continue
    if (ev.type === 'tool_use')                       b.call++
    else if (ev.type === 'thinking')                  b.think++
    else if (ev.type === 'tool_result' && !ev.isError) b.result++
    else if (ev.type === 'tool_result' && ev.isError)  b.err++
  }
  return buckets
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
  if (total === 0) return null
  return (
    <div className="px-2.5 py-2 rounded-lg text-[9px]" style={{
      background: 'rgba(3,4,10,0.92)', border: '1px solid rgba(0,229,255,0.15)',
      fontFamily: "'JetBrains Mono',monospace",
    }}>
      <div className="mb-1 font-bold" style={{ color: '#4a5568' }}>{label}</div>
      {payload.filter(p => p.value > 0).map(p => (
        <div key={p.name} className="flex gap-2">
          <span style={{ color: p.color }}>{p.name}</span>
          <span style={{ color: '#787e98' }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export function ActivityChart({ events }: { events: LiveEvent[] }) {
  const [, setTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const data = buildBuckets(events)
  const hasData = events.length > 0

  return (
    <div className="relative h-full">
      {!hasData && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[10px] tracking-widest" style={{ color: '#2e3650' }}>— waiting for events —</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gCall"   x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#00e5ff" stopOpacity={0.55} />
              <stop offset="100%" stopColor="#00e5ff" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gThink"  x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#a855f7" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#a855f7" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gResult" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#22d858" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#22d858" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gErr"    x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#ff453a" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#ff453a" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="relT"
            tick={{ fill: '#2e3650', fontSize: 7.5, fontFamily: "'JetBrains Mono',monospace" }}
            axisLine={{ stroke: 'rgba(0,229,255,0.07)' }}
            tickLine={false}
            interval={14}
          />
          <YAxis hide />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(0,229,255,0.15)', strokeWidth: 1 }} />

          <Area type="monotone" dataKey="err"    name="error"  stackId="1"
            stroke="#ff453a" strokeWidth={1} fill="url(#gErr)"    dot={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="result" name="result" stackId="1"
            stroke="#22d858" strokeWidth={1} fill="url(#gResult)" dot={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="think"  name="think"  stackId="1"
            stroke="#a855f7" strokeWidth={1} fill="url(#gThink)"  dot={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="call"   name="call"   stackId="1"
            stroke="#00e5ff" strokeWidth={1.5} fill="url(#gCall)" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
