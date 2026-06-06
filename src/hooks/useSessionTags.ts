import { useCallback, useEffect, useMemo, useState } from 'react'
import { persistToDisk } from './prefsBackend'

const STORAGE_KEY = 'cl-session-tags'
const EVENT = 'cl-session-tags-changed'

export type SessionTag = {
  name: string
  createdAt: string
}

type ProjectTagState = {
  tags: SessionTag[]
  sessionTags: Record<string, string[]>
}

type RootState = Record<string, ProjectTagState>

function emptyProject(): ProjectTagState {
  return { tags: [], sessionTags: {} }
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

export function useSessionTags(projectHash: string) {
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
  const sessionTags = project.sessionTags

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const tagList of Object.values(sessionTags)) {
      for (const tag of tagList) counts[tag] = (counts[tag] ?? 0) + 1
    }
    return counts
  }, [sessionTags])

  const update = useCallback((updater: (prev: ProjectTagState) => ProjectTagState) => {
    const current = read()
    const prev = current[projectHash] ?? emptyProject()
    const next = updater(prev)
    const updated = { ...current, [projectHash]: next }
    write(updated)
    setRoot(updated)
  }, [projectHash])

  const createTag = useCallback((rawName: string): string | null => {
    const name = normalize(rawName)
    if (!name) return null
    let created: string | null = name
    update(prev => {
      if (prev.tags.some(t => t.name === name)) {
        created = name
        return prev
      }
      return { ...prev, tags: [...prev.tags, { name, createdAt: new Date().toISOString() }] }
    })
    return created
  }, [update])

  const deleteTag = useCallback((name: string) => {
    update(prev => {
      const cleanedSessionTags: Record<string, string[]> = {}
      for (const [filename, list] of Object.entries(prev.sessionTags)) {
        const filtered = list.filter(t => t !== name)
        if (filtered.length > 0) cleanedSessionTags[filename] = filtered
      }
      return {
        tags: prev.tags.filter(t => t.name !== name),
        sessionTags: cleanedSessionTags,
      }
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
      const nextSessionTags: Record<string, string[]> = {}
      for (const [filename, list] of Object.entries(prev.sessionTags)) {
        nextSessionTags[filename] = list.map(t => t === oldName ? newName : t)
      }
      return { tags: nextTags, sessionTags: nextSessionTags }
    })
    return ok
  }, [update])

  const tagsForSession = useCallback(
    (filename: string): string[] => sessionTags[filename] ?? [],
    [sessionTags],
  )

  const toggleTagOnSession = useCallback((filename: string, rawName: string) => {
    const name = normalize(rawName)
    if (!name) return
    update(prev => {
      const tagExists = prev.tags.some(t => t.name === name)
      const nextTags = tagExists
        ? prev.tags
        : [...prev.tags, { name, createdAt: new Date().toISOString() }]
      const current = prev.sessionTags[filename] ?? []
      const nextList = current.includes(name)
        ? current.filter(t => t !== name)
        : [...current, name]
      const nextSessionTags = { ...prev.sessionTags }
      if (nextList.length === 0) delete nextSessionTags[filename]
      else nextSessionTags[filename] = nextList
      return { tags: nextTags, sessionTags: nextSessionTags }
    })
  }, [update])

  const removeTagFromSession = useCallback((filename: string, name: string) => {
    update(prev => {
      const current = prev.sessionTags[filename] ?? []
      if (!current.includes(name)) return prev
      const nextList = current.filter(t => t !== name)
      const nextSessionTags = { ...prev.sessionTags }
      if (nextList.length === 0) delete nextSessionTags[filename]
      else nextSessionTags[filename] = nextList
      return { ...prev, sessionTags: nextSessionTags }
    })
  }, [update])

  return {
    tags,
    tagCounts,
    tagsForSession,
    createTag,
    deleteTag,
    renameTag,
    toggleTagOnSession,
    removeTagFromSession,
  }
}
