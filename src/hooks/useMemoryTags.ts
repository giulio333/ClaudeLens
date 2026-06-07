import { useCallback, useEffect, useMemo, useState } from 'react'
import { persistToDisk } from './prefsBackend'

const STORAGE_KEY = 'cl-memory-tags'
const EVENT = 'cl-memory-tags-changed'

export type MemoryTag = {
  name: string
  createdAt: string
}

type ProjectTagState = {
  tags: MemoryTag[]
  memoryTags: Record<string, string[]>
}

type RootState = Record<string, ProjectTagState>

function emptyProject(): ProjectTagState {
  return { tags: [], memoryTags: {} }
}

function read(): RootState {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function write(next: RootState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch { /* ignore */ }
  persistToDisk(STORAGE_KEY, next)
  window.dispatchEvent(new CustomEvent(EVENT))
}

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-')
}

export function useMemoryTags(projectHash: string) {
  const [root, setRoot] = useState<RootState>(() => read())

  useEffect(() => {
    const sync = () => setRoot(read())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const project = root[projectHash] ?? emptyProject()
  const tags = project.tags
  const memoryTags = project.memoryTags

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const tagList of Object.values(memoryTags)) {
      for (const tag of tagList) counts[tag] = (counts[tag] ?? 0) + 1
    }
    return counts
  }, [memoryTags])

  const update = useCallback((updater: (prev: ProjectTagState) => ProjectTagState) => {
    const current = read()
    const prev = current[projectHash] ?? emptyProject()
    const next = updater(prev)
    const updated = { ...current, [projectHash]: next }
    write(updated)
    setRoot(updated)
  }, [projectHash])

  const deleteTag = useCallback((name: string) => {
    update(prev => {
      const cleaned: Record<string, string[]> = {}
      for (const [filename, list] of Object.entries(prev.memoryTags)) {
        const filtered = list.filter(t => t !== name)
        if (filtered.length > 0) cleaned[filename] = filtered
      }
      return { tags: prev.tags.filter(t => t.name !== name), memoryTags: cleaned }
    })
  }, [update])

  const renameTag = useCallback((oldName: string, rawNewName: string): boolean => {
    const newName = normalize(rawNewName)
    if (!newName || oldName === newName) return false
    let ok = false
    update(prev => {
      if (!prev.tags.some(t => t.name === oldName)) return prev
      if (prev.tags.some(t => t.name === newName)) return prev
      ok = true
      const nextTags = prev.tags.map(t => t.name === oldName ? { ...t, name: newName } : t)
      const nextMemoryTags: Record<string, string[]> = {}
      for (const [filename, list] of Object.entries(prev.memoryTags)) {
        nextMemoryTags[filename] = list.map(t => t === oldName ? newName : t)
      }
      return { tags: nextTags, memoryTags: nextMemoryTags }
    })
    return ok
  }, [update])

  const tagsForMemory = useCallback(
    (filename: string): string[] => memoryTags[filename] ?? [],
    [memoryTags],
  )

  const toggleTagOnMemory = useCallback((filename: string, rawName: string) => {
    const name = normalize(rawName)
    if (!name) return
    update(prev => {
      const tagExists = prev.tags.some(t => t.name === name)
      const nextTags = tagExists
        ? prev.tags
        : [...prev.tags, { name, createdAt: new Date().toISOString() }]
      const current = prev.memoryTags[filename] ?? []
      const nextList = current.includes(name)
        ? current.filter(t => t !== name)
        : [...current, name]
      const nextMemoryTags = { ...prev.memoryTags }
      if (nextList.length === 0) delete nextMemoryTags[filename]
      else nextMemoryTags[filename] = nextList
      return { tags: nextTags, memoryTags: nextMemoryTags }
    })
  }, [update])

  return { tags, tagCounts, tagsForMemory, deleteTag, renameTag, toggleTagOnMemory }
}
