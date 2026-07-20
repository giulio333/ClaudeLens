// Timeline model — builds the swimlane data structure from processed messages.
// Renamed-by-content from the original force-directed graph builder; folder
// name kept to avoid touching imports during the redesign.

import type { ProcessedMessage } from '../utils'

export type LaneKind = 'file' | 'bash' | 'web' | 'memory' | 'agent' | 'other'

export type ToolEvent = {
  id: string
  t: number               // unix ms
  toolName: string
  toolInput: Record<string, unknown>
  toolIsError: boolean
  laneId: string
  processedIndex: number
  toolGroupIndex: number
}

export type Lane = {
  id: string
  label: string
  kind: LaneKind
  events: ToolEvent[]
  // For file lanes, the full path before shortening (used in tooltips/filtering)
  fullPath?: string
  // Sub-extension for file lanes (drives the small badge)
  ext?: string
}

export type UserMark = {
  id: string
  t: number
  label: string            // first line / preview of the user prompt
  isCommand: boolean
  processedIndex: number
}

export type AssistantMark = {
  id: string
  t: number
  processedIndex: number
  hasTools: boolean
  hasThinking: boolean
}

export type Heartbeat = {
  bins: number[]           // count of events per bin
  binMs: number            // size of each bin in ms
}

export type TimelineModel = {
  lanes: Lane[]
  userMarks: UserMark[]
  assistantMarks: AssistantMark[]
  heartbeat: Heartbeat
  domain: { start: number; end: number }
}

function shortenPath(path: string, max = 36): string {
  if (path.length <= max) return path
  const parts = path.split(/[\\/]/)
  const tail = parts[parts.length - 1] ?? path
  return tail.length <= max ? `…/${tail}` : `${tail.slice(0, max - 1)}…`
}

function fileExt(path: string): string {
  const tail = path.split(/[\\/]/).pop() ?? ''
  const idx = tail.lastIndexOf('.')
  return idx > 0 ? tail.slice(idx + 1).toLowerCase() : ''
}

function classifyTool(name: string, input: Record<string, unknown>): { kind: LaneKind; laneId: string; label: string; ext?: string; fullPath?: string } {
  // File-touching tools: a per-file lane
  if (name === 'Read' || name === 'Write' || name === 'Edit') {
    const path = typeof input.file_path === 'string' ? input.file_path : null
    if (path) {
      // Normalize backslashes so the check works on Windows paths too
      const normalizedPath = path.replace(/\\/g, '/')
      const isMemory = normalizedPath.includes('/.claude/') && normalizedPath.includes('/memory/')
      return {
        kind: isMemory ? 'memory' : 'file',
        laneId: isMemory ? `memory:${path}` : `file:${path}`,
        label: shortenPath(path),
        ext: fileExt(path),
        fullPath: path,
      }
    }
  }
  if (name === 'NotebookEdit') {
    const path = typeof input.notebook_path === 'string' ? input.notebook_path : null
    if (path) {
      return { kind: 'file', laneId: `file:${path}`, label: shortenPath(path), ext: fileExt(path), fullPath: path }
    }
  }
  if (name === 'Glob' || name === 'Grep') {
    // Group all search tools into one lane: usually exploratory
    return { kind: 'other', laneId: 'search', label: 'Search (Glob/Grep)' }
  }
  if (name === 'Bash') {
    return { kind: 'bash', laneId: 'bash', label: 'Bash' }
  }
  if (name === 'WebFetch' || name === 'WebSearch') {
    return { kind: 'web', laneId: 'web', label: 'Web' }
  }
  if (name === 'Agent' || name === 'Task') {
    return { kind: 'agent', laneId: 'agent', label: 'Sub-agents' }
  }
  return { kind: 'other', laneId: `tool:${name}`, label: name }
}

function previewLine(text: string, max = 80): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

function firstText(processed: ProcessedMessage): string | null {
  const b = processed.msg.content.find(x => x.type === 'text')
  return b && b.type === 'text' ? b.text : null
}

export function buildTimeline(processed: ProcessedMessage[]): TimelineModel {
  // Build a sortable list of all timestamps so we can compute the domain.
  const stamps: number[] = []
  for (const p of processed) {
    const t = Date.parse(p.msg.timestamp)
    if (Number.isFinite(t)) stamps.push(t)
  }
  if (stamps.length === 0) {
    return {
      lanes: [],
      userMarks: [],
      assistantMarks: [],
      heartbeat: { bins: [], binMs: 1000 },
      domain: { start: 0, end: 1 },
    }
  }

  // Compute min/max in a single linear pass. Spreading `stamps` into
  // Math.min/max would pass each element as an argument, and engines cap the
  // argument count — very long sessions throw a RangeError and the graph fails
  // to render (issue #62).
  let start = stamps[0]
  let end = stamps[0]
  for (const t of stamps) {
    if (t < start) start = t
    if (t > end) end = t
  }
  // Pad domain by 2% on each side so first/last events aren't flush with edge.
  const span = Math.max(end - start, 1000)
  const padded = { start: start - span * 0.02, end: end + span * 0.02 }

  const laneMap = new Map<string, Lane>()
  const userMarks: UserMark[] = []
  const assistantMarks: AssistantMark[] = []

  // Counters to spread events horizontally even when they share a timestamp.
  let eventCounter = 0

  processed.forEach((p, pIdx) => {
    const t = Date.parse(p.msg.timestamp)
    if (!Number.isFinite(t)) return

    if (p.msg.role === 'user') {
      const text = firstText(p)
      const label = p.command
        ? `/${p.command.command}${p.command.args ? ' ' + p.command.args : ''}`
        : text
          ? previewLine(text, 70)
          : '(user)'
      userMarks.push({
        id: `u-${pIdx}`,
        t,
        label,
        isCommand: Boolean(p.command),
        processedIndex: pIdx,
      })
    } else {
      assistantMarks.push({
        id: `a-${pIdx}`,
        t,
        processedIndex: pIdx,
        hasTools: p.toolGroups.length > 0,
        hasThinking: p.msg.content.some(b => b.type === 'thinking'),
      })
    }

    p.toolGroups.forEach((group, gIdx) => {
      const cls = classifyTool(group.use.name, group.use.input as Record<string, unknown>)
      let lane = laneMap.get(cls.laneId)
      if (!lane) {
        lane = {
          id: cls.laneId,
          label: cls.label,
          kind: cls.kind,
          events: [],
          fullPath: cls.fullPath,
          ext: cls.ext,
        }
        laneMap.set(cls.laneId, lane)
      }
      lane.events.push({
        id: `e-${eventCounter++}`,
        t,
        toolName: group.use.name,
        toolInput: group.use.input as Record<string, unknown>,
        toolIsError: Boolean(group.result?.isError),
        laneId: cls.laneId,
        processedIndex: pIdx,
        toolGroupIndex: gIdx,
      })
    })
  })

  // Sort lanes: file/memory lanes by event count desc, then bash/agent/web/search/other.
  const lanes = Array.from(laneMap.values()).sort((a, b) => {
    const kindOrder = (k: LaneKind) => {
      switch (k) {
        case 'file': return 0
        case 'memory': return 1
        case 'bash': return 2
        case 'agent': return 3
        case 'web': return 4
        case 'other': return 5
      }
    }
    const ka = kindOrder(a.kind)
    const kb = kindOrder(b.kind)
    if (ka !== kb) return ka - kb
    return b.events.length - a.events.length
  })

  // Heartbeat — turn density (assistant + user marks) bucketed into ~80 bins.
  const binCount = 80
  const binMs = Math.max(span / binCount, 1)
  const bins = new Array(binCount).fill(0) as number[]
  for (const m of [...userMarks, ...assistantMarks]) {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((m.t - start) / binMs)))
    bins[idx] = (bins[idx] ?? 0) + 1
  }

  return {
    lanes,
    userMarks,
    assistantMarks,
    heartbeat: { bins, binMs },
    domain: padded,
  }
}
