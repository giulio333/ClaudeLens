// SVG sub-components for the session timeline (file name kept; original
// React Flow node components removed).

import type { Heartbeat, Lane, ToolEvent, UserMark } from './buildGraph'
import { fmtAxisTime, timeTicks, type TimeScale } from './useForceLayout'

export const LANE_HEIGHT = 28
export const LANE_PAD = 4
export const HEADER_HEIGHT = 80          // heartbeat + axis at the top
export const LANE_LABEL_WIDTH = 220
export const RIGHT_PAD = 24
export const TOP_PAD = 18

export function HeartbeatStrip({
  heartbeat,
  domain,
  width,
  height,
  scale,
}: {
  heartbeat: Heartbeat
  domain: { start: number; end: number }
  width: number
  height: number
  scale: TimeScale
}) {
  const { bins, binMs } = heartbeat
  if (bins.length === 0) return null

  const max = Math.max(...bins, 1)
  // Build a smooth area path (bezier-ish) from binned counts.
  const points: { x: number; y: number }[] = bins.map((v, i) => {
    const t = domain.start + (i + 0.5) * binMs
    return {
      x: scale(t),
      y: height - (v / max) * (height - 4) - 2,
    }
  })

  const baseY = height
  const path =
    `M ${points[0]?.x ?? 0} ${baseY} ` +
    points.map(p => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') +
    ` L ${points[points.length - 1]?.x ?? width} ${baseY} Z`

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')

  return (
    <g className="cl-tl-heartbeat">
      <defs>
        <linearGradient id="cl-tl-heart-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--cl-accent)" stopOpacity="0.30" />
          <stop offset="100%" stopColor="var(--cl-accent)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={path} fill="url(#cl-tl-heart-grad)" stroke="none" />
      <path d={linePath} fill="none" stroke="var(--cl-accent)" strokeWidth="1.2" strokeLinejoin="round" />
    </g>
  )
}

export function TimeAxis({
  domain,
  width,
  y,
  scale,
}: {
  domain: { start: number; end: number }
  width: number
  y: number
  scale: TimeScale
}) {
  const ticks = timeTicks(domain, 7)
  return (
    <g className="cl-tl-axis">
      <line x1={0} y1={y} x2={width} y2={y} stroke="var(--cl-line)" strokeWidth="1" />
      {ticks.map(t => {
        const x = scale(t)
        if (x < 0 || x > width) return null
        return (
          <g key={t} transform={`translate(${x}, ${y})`}>
            <line x1={0} y1={0} x2={0} y2={4} stroke="var(--cl-ink-4)" strokeWidth="1" />
            <text
              x={0}
              y={16}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize="10"
              fill="var(--cl-ink-3)"
            >
              {fmtAxisTime(t, domain)}
            </text>
          </g>
        )
      })}
    </g>
  )
}

export function UserMarkers({
  marks,
  scale,
  height,
  onHover,
}: {
  marks: UserMark[]
  scale: TimeScale
  height: number
  onHover?: (m: UserMark | null) => void
}) {
  return (
    <g className="cl-tl-usermarks">
      {marks.map(m => {
        const x = scale(m.t)
        return (
          <g
            key={m.id}
            transform={`translate(${x}, 0)`}
            onMouseEnter={() => onHover?.(m)}
            onMouseLeave={() => onHover?.(null)}
            style={{ cursor: 'pointer' }}
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={height}
              stroke={m.isCommand ? 'var(--cl-ink-3)' : 'var(--cl-ink-2)'}
              strokeWidth="1"
              strokeDasharray="3 4"
              opacity="0.55"
            />
            <circle
              cx={0}
              cy={6}
              r={4}
              fill={m.isCommand ? 'var(--cl-paper-2)' : 'var(--cl-ink)'}
              stroke="var(--cl-paper)"
              strokeWidth="2"
            />
          </g>
        )
      })}
    </g>
  )
}

const TOOL_GLYPH: Record<string, string> = {
  Read: 'R', Write: 'W', Edit: 'E',
  Bash: 'B', Glob: 'G', Grep: 'g',
  WebFetch: 'w', WebSearch: 's',
  Agent: 'A', Task: 'T', Skill: 'S',
  NotebookEdit: 'N',
}

function glyph(name: string): string {
  return TOOL_GLYPH[name] ?? '·'
}

export function LaneRow({
  lane,
  index,
  scale,
  totalWidth,
  selected,
  onSelectLane,
  onSelectEvent,
  hoveredEventId,
  setHoveredEventId,
}: {
  lane: Lane
  index: number
  scale: TimeScale
  totalWidth: number
  selected: boolean
  onSelectLane: (id: string | null) => void
  onSelectEvent: (e: ToolEvent) => void
  hoveredEventId: string | null
  setHoveredEventId: (id: string | null) => void
}) {
  const yTop = HEADER_HEIGHT + TOP_PAD + index * LANE_HEIGHT
  const yCenter = yTop + LANE_HEIGHT / 2

  return (
    <g
      className={`cl-tl-lane is-${lane.kind}${selected ? ' is-selected' : ''}`}
      onClick={() => onSelectLane(selected ? null : lane.id)}
    >
      {/* Zebra row background */}
      <rect
        x={0}
        y={yTop}
        width={totalWidth}
        height={LANE_HEIGHT - LANE_PAD}
        rx={6}
        fill={index % 2 === 0 ? 'var(--cl-paper)' : 'var(--cl-paper-2)'}
        opacity={selected ? 0.9 : 0.55}
      />
      {selected && (
        <rect
          x={0}
          y={yTop}
          width={totalWidth}
          height={LANE_HEIGHT - LANE_PAD}
          rx={6}
          fill="none"
          stroke="var(--cl-accent)"
          strokeWidth="1"
          opacity="0.6"
        />
      )}

      {/* Horizontal baseline */}
      <line
        x1={LANE_LABEL_WIDTH}
        y1={yCenter}
        x2={totalWidth - RIGHT_PAD}
        y2={yCenter}
        stroke="var(--cl-line-soft)"
        strokeWidth="1"
        strokeDasharray="1 4"
      />

      {/* Events */}
      {lane.events.map(ev => {
        const x = scale(ev.t)
        if (x < LANE_LABEL_WIDTH - 4 || x > totalWidth - RIGHT_PAD + 4) return null
        const isHovered = hoveredEventId === ev.id
        const r = isHovered ? 8 : 6
        const fill = ev.toolIsError ? 'var(--cl-danger)' : eventColor(lane.kind, ev.toolName)
        return (
          <g
            key={ev.id}
            transform={`translate(${x}, ${yCenter})`}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => setHoveredEventId(ev.id)}
            onMouseLeave={() => setHoveredEventId(null)}
            onClick={(e) => { e.stopPropagation(); onSelectEvent(ev) }}
          >
            <circle r={r + 2} fill="var(--cl-paper)" />
            <circle
              r={r}
              fill={fill}
              stroke={isHovered ? 'var(--cl-ink)' : 'var(--cl-paper-2)'}
              strokeWidth={isHovered ? 1.5 : 1}
            />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="var(--font-mono)"
              fontSize="9"
              fontWeight="600"
              fill="var(--cl-on-accent)"
              pointerEvents="none"
            >
              {glyph(ev.toolName)}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function eventColor(kind: Lane['kind'], _toolName: string): string {
  switch (kind) {
    case 'file': return 'var(--cl-accent)'
    case 'memory': return 'var(--cl-violet)'
    case 'bash': return 'var(--cl-ink-2)'
    case 'web': return 'var(--cl-haiku)'
    case 'agent': return 'var(--cl-accent)'
    case 'other': return 'var(--cl-ink-3)'
  }
}

export function LaneLabels({
  lanes,
  selectedLane,
  onSelectLane,
}: {
  lanes: Lane[]
  selectedLane: string | null
  onSelectLane: (id: string | null) => void
}) {
  return (
    <div className="cl-tl-labels" style={{ width: LANE_LABEL_WIDTH }}>
      {lanes.map((lane, i) => {
        const top = HEADER_HEIGHT + TOP_PAD + i * LANE_HEIGHT
        const selected = lane.id === selectedLane
        return (
          <button
            type="button"
            key={lane.id}
            className={`cl-tl-label is-${lane.kind}${selected ? ' is-selected' : ''}`}
            style={{ top, height: LANE_HEIGHT - LANE_PAD }}
            onClick={() => onSelectLane(selected ? null : lane.id)}
            title={lane.fullPath ?? lane.label}
          >
            <span className="cl-tl-label-kind">
              {lane.kind === 'file' && (lane.ext || 'file')}
              {lane.kind === 'memory' && 'mem'}
              {lane.kind === 'bash' && 'sh'}
              {lane.kind === 'web' && 'www'}
              {lane.kind === 'agent' && 'sub'}
              {lane.kind === 'other' && '·'}
            </span>
            <span className="cl-tl-label-text">{lane.label}</span>
            <span className="cl-tl-label-count">{lane.events.length}</span>
          </button>
        )
      })}
    </div>
  )
}
