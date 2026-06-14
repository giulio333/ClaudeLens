import { useCallback, useEffect, useState } from 'react'
import { persistToDisk } from './prefsBackend'

// Shared primitive for the localStorage-backed UI-state hooks
// (pinned projects/sessions, namespaced tags). It encapsulates the pattern they
// all repeated verbatim:
//   - read/parse a value from localStorage (with a typed fallback on any error)
//   - mirror every write to localStorage + the on-disk prefs store (persistToDisk)
//   - notify same-window listeners via a CustomEvent, and cross-tab listeners via
//     the native 'storage' event, re-reading on either
//
// The stored shape is opaque to this primitive: callers supply `serialize`
// (in-memory value → JSON-safe structure) and `deserialize` (raw localStorage
// string → in-memory value). This keeps the on-disk format and parsing logic
// byte-for-byte identical to the hand-rolled hooks it replaces.
//
// IMPORTANT: `eventName` must match the entry in prefsBackend's KEY_EVENTS for
// the same `storageKey`, so hydratePrefs() can wake this hook at startup.

export type PersistentStateConfig<T> = {
  storageKey: string
  eventName: string
  // Produce the fallback value used when localStorage is unavailable, empty, or
  // unparseable. Called fresh each time (so a mutable default like a Set/object
  // is never shared between reads).
  fallback: () => T
  // raw localStorage string → in-memory value. Should be total: any malformed
  // input must resolve to `fallback()` rather than throw (read() wraps this in
  // try/catch, but defensive parsing keeps the intent local).
  deserialize: (raw: string) => T
  // in-memory value → JSON-safe structure persisted to disk (the parsed form,
  // not the JSON string) and stringified into localStorage.
  serialize: (value: T) => unknown
}

type PersistentState<T> = {
  // Current in-memory value (kept in React state, synced across events).
  value: T
  // Read the freshest value straight from storage (bypassing React state).
  // Mirrors the original hooks' read-modify-write callbacks, which always
  // re-read disk before mutating so concurrent writers don't clobber each other.
  read: () => T
  // Persist `next` (localStorage + disk), broadcast the change event, and update
  // local React state in one shot.
  commit: (next: T) => void
}

export function usePersistentState<T>(config: PersistentStateConfig<T>): PersistentState<T> {
  const { storageKey, eventName, fallback, deserialize, serialize } = config

  const read = useCallback((): T => {
    if (typeof localStorage === 'undefined') return fallback()
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return fallback()
      return deserialize(raw)
    } catch {
      return fallback()
    }
  }, [storageKey, fallback, deserialize])

  const write = useCallback((next: T) => {
    const payload = serialize(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload))
    } catch { /* ignore */ }
    persistToDisk(storageKey, payload)
    window.dispatchEvent(new CustomEvent(eventName))
  }, [storageKey, eventName, serialize])

  const [value, setValue] = useState<T>(() => read())

  useEffect(() => {
    const sync = () => setValue(read())
    window.addEventListener(eventName, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(eventName, sync)
      window.removeEventListener('storage', sync)
    }
  }, [eventName, read])

  const commit = useCallback((next: T) => {
    write(next)
    setValue(next)
  }, [write])

  return { value, read, commit }
}
