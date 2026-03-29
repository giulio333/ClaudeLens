// claudelens-app/src/tabs/live/types.ts

import type { LiveEvent } from '../../hooks/useIPC'

export type Bucket = {
  t: number
  relT: string
  call: number
  think: number
  result: number
  err: number
}

export type UsedItem = {
  id: string
  category: 'mcp' | 'agent'
  label: string
  server?: string
  status: 'running' | 'done' | 'error'
  duration?: number
}

export const VISIBLE_TYPES: Set<LiveEvent['type']> = new Set(['tool_use', 'tool_result', 'thinking'])
export const MAX_EVENTS = 300
export const CHART_H = 110
export const WINDOW_S = 90
