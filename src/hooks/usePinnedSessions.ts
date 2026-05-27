import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'cl-pinned-sessions'
const EVENT = 'cl-pinned-sessions-changed'

function pinKey(projectHash: string, sessionFilename: string): string {
  return `${projectHash}::${sessionFilename}`
}

function read(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function write(next: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function usePinnedSessions() {
  const [pinned, setPinned] = useState<Set<string>>(() => read())

  useEffect(() => {
    const sync = () => setPinned(read())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const togglePin = useCallback((projectHash: string, sessionFilename: string) => {
    const key = pinKey(projectHash, sessionFilename)
    const next = new Set(read())
    if (next.has(key)) next.delete(key)
    else next.add(key)
    write(next)
    setPinned(next)
  }, [])

  const isPinned = useCallback(
    (projectHash: string, sessionFilename: string) => pinned.has(pinKey(projectHash, sessionFilename)),
    [pinned],
  )

  return { pinned, isPinned, togglePin }
}
