import { useCallback } from 'react'
import { usePersistentState } from './usePersistentState'

const STORAGE_KEY = 'cl-pinned-projects'
const EVENT = 'cl-pinned-projects-changed'

// On-disk format (unchanged): a JSON array of project-hash pin keys, surfaced
// in-memory as a Set. usePersistentState handles the localStorage + disk-mirror
// + cross-tab/same-tab sync; this hook only owns the Set<->array
// (de)serialization and the toggle/lookup helpers.

// Module-level (stable identities) so usePersistentState's read/write — and the
// sync effect that depends on them — subscribe once, matching the original
// hand-rolled effect's empty-deps behavior (no per-render listener churn).
function emptyPins(): Set<string> {
  return new Set()
}

function deserialize(raw: string): Set<string> {
  const arr = JSON.parse(raw)
  return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
}

// Persist the parsed array form (not the Set), matching the legacy writer.
function serialize(set: Set<string>): string[] {
  return [...set]
}

export function usePinnedProjects() {
  const { value: pinned, read, commit } = usePersistentState<Set<string>>({
    storageKey: STORAGE_KEY,
    eventName: EVENT,
    fallback: emptyPins,
    deserialize,
    serialize,
  })

  const togglePin = useCallback(
    (hash: string) => {
      const next = new Set(read())
      if (next.has(hash)) next.delete(hash)
      else next.add(hash)
      commit(next)
    },
    [read, commit],
  )

  const isPinned = useCallback((hash: string) => pinned.has(hash), [pinned])

  return { pinned, isPinned, togglePin }
}
