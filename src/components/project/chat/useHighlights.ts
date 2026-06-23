import { useCallback, useMemo } from 'react'
import { usePersistentState } from '../../../hooks/usePersistentState'
import { Highlight, HighlightColor, HighlightStore } from './highlights'

// Disk-backed store (via usePersistentState → ~/.claudelens/preferences.json) of
// per-session text highlights. Keyed by session id so a session's highlights load
// with it and never leak across sessions. The storage key must also be registered
// in prefsBackend's KEY_EVENTS so hydration at startup wakes this hook.
const STORAGE_KEY = 'cl-highlights'
const EVENT_NAME = 'cl-highlights-changed'

export type NewHighlight = Omit<Highlight, 'id' | 'createdAt'>

export interface HighlightsApi {
  highlights: Highlight[]
  addHighlight: (h: NewHighlight) => void
  removeHighlight: (id: string) => void
  setHighlightColor: (id: string, color: HighlightColor) => void
}

export function useHighlights(sessionId: string): HighlightsApi {
  const { value, read, commit } = usePersistentState<HighlightStore>({
    storageKey: STORAGE_KEY,
    eventName: EVENT_NAME,
    fallback: () => ({}),
    deserialize: raw => JSON.parse(raw) as HighlightStore,
    serialize: v => v,
  })

  const highlights = useMemo(() => value[sessionId] ?? [], [value, sessionId])

  // Read-modify-write the freshest store so concurrent writers (other windows,
  // hydration) aren't clobbered — mirrors the pinned/tags hooks' pattern.
  const mutate = useCallback(
    (fn: (list: Highlight[]) => Highlight[]) => {
      const store = read()
      const next = fn(store[sessionId] ?? [])
      const updated: HighlightStore = { ...store }
      if (next.length > 0) updated[sessionId] = next
      else delete updated[sessionId]
      commit(updated)
    },
    [read, commit, sessionId],
  )

  const addHighlight = useCallback(
    (h: NewHighlight) => {
      const full: Highlight = { ...h, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
      mutate(list => [...list, full])
    },
    [mutate],
  )

  const removeHighlight = useCallback(
    (id: string) => mutate(list => list.filter(h => h.id !== id)),
    [mutate],
  )

  const setHighlightColor = useCallback(
    (id: string, color: HighlightColor) =>
      mutate(list => list.map(h => (h.id === id ? { ...h, color } : h))),
    [mutate],
  )

  return { highlights, addHighlight, removeHighlight, setHighlightColor }
}
