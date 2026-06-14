import { useCallback, useMemo } from 'react'
import { usePersistentState } from './usePersistentState'

// Shared engine behind useSessionTags and useMemoryTags. Both stored the exact
// same shape — a per-project record of `{ tags, <itemsField> }` — under their
// own localStorage key/event, with identical create/delete/rename/toggle logic;
// the only differences were the storage key, the change-event name, and the name
// of the per-item map field on disk (`sessionTags` vs `memoryTags`).
//
// This hook keeps that on-disk format byte-for-byte identical: `itemsField`
// parameterizes the persisted field name, so existing user data is read/written
// unchanged. It exposes neutral member names (`tags`, `tagCounts`, `tagsFor`,
// `createTag`, `deleteTag`, `renameTag`, `toggleTag`, `removeTagFromItem`); the
// thin wrappers re-expose them under each hook's original public names.

export type NamespacedTag = {
  name: string
  createdAt: string
}

// The persisted per-project state. The per-item map field is named dynamically
// (`itemsField`), so its concrete type is `Record<string, string[]>` regardless
// of key — keeping the JSON identical to the legacy hand-rolled shape.
type ProjectTagState = {
  tags: NamespacedTag[]
} & Record<string, NamespacedTag[] | Record<string, string[]>>

type RootState = Record<string, ProjectTagState>

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-')
}

export type NamespacedTagsApi = {
  tags: NamespacedTag[]
  tagCounts: Record<string, number>
  tagsFor: (filename: string) => string[]
  createTag: (rawName: string) => string | null
  deleteTag: (name: string) => void
  renameTag: (oldName: string, rawNewName: string) => boolean
  toggleTag: (filename: string, rawName: string) => void
  removeTagFromItem: (filename: string, name: string) => void
}

export function useNamespacedTags(
  projectHash: string,
  config: { storageKey: string; eventName: string; itemsField: string },
): NamespacedTagsApi {
  const { storageKey, eventName, itemsField } = config

  // Build a fresh empty project state with the dynamically-named items field.
  const emptyProject = useCallback(
    (): ProjectTagState => ({ tags: [], [itemsField]: {} }) as ProjectTagState,
    [itemsField],
  )

  // Typed accessor for the dynamically-named per-item map field.
  const itemsOf = useCallback(
    (project: ProjectTagState): Record<string, string[]> =>
      (project[itemsField] as Record<string, string[]>) ?? {},
    [itemsField],
  )

  const fallback = useCallback((): RootState => ({}), [])

  const deserialize = useCallback((raw: string): RootState => {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  }, [])

  const serialize = useCallback((value: RootState): unknown => value, [])

  const { value: root, read, commit } = usePersistentState<RootState>({
    storageKey,
    eventName,
    fallback,
    deserialize,
    serialize,
  })

  const project = root[projectHash] ?? emptyProject()
  const tags = project.tags
  const items = itemsOf(project)

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const tagList of Object.values(items)) {
      for (const tag of tagList) counts[tag] = (counts[tag] ?? 0) + 1
    }
    return counts
  }, [items])

  // Read-modify-write a single project's state, always re-reading from storage
  // first (matching the legacy `update`: concurrent writers don't clobber).
  const update = useCallback(
    (updater: (prev: ProjectTagState) => ProjectTagState) => {
      const current = read()
      const prev = current[projectHash] ?? emptyProject()
      const next = updater(prev)
      const updated = { ...current, [projectHash]: next }
      commit(updated)
    },
    [read, commit, projectHash, emptyProject],
  )

  const createTag = useCallback(
    (rawName: string): string | null => {
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
    },
    [update],
  )

  const deleteTag = useCallback(
    (name: string) => {
      update(prev => {
        const cleaned: Record<string, string[]> = {}
        for (const [filename, list] of Object.entries(itemsOf(prev))) {
          const filtered = list.filter(t => t !== name)
          if (filtered.length > 0) cleaned[filename] = filtered
        }
        return {
          tags: prev.tags.filter(t => t.name !== name),
          [itemsField]: cleaned,
        } as ProjectTagState
      })
    },
    [update, itemsOf, itemsField],
  )

  const renameTag = useCallback(
    (oldName: string, rawNewName: string): boolean => {
      const newName = normalize(rawNewName)
      if (!newName || oldName === newName) return false
      let ok = false
      update(prev => {
        if (!prev.tags.some(t => t.name === oldName)) return prev
        if (prev.tags.some(t => t.name === newName)) return prev
        ok = true
        const nextTags = prev.tags.map(t => (t.name === oldName ? { ...t, name: newName } : t))
        const nextItems: Record<string, string[]> = {}
        for (const [filename, list] of Object.entries(itemsOf(prev))) {
          nextItems[filename] = list.map(t => (t === oldName ? newName : t))
        }
        return { tags: nextTags, [itemsField]: nextItems } as ProjectTagState
      })
      return ok
    },
    [update, itemsOf, itemsField],
  )

  const tagsFor = useCallback(
    (filename: string): string[] => items[filename] ?? [],
    [items],
  )

  const toggleTag = useCallback(
    (filename: string, rawName: string) => {
      const name = normalize(rawName)
      if (!name) return
      update(prev => {
        const tagExists = prev.tags.some(t => t.name === name)
        const nextTags = tagExists
          ? prev.tags
          : [...prev.tags, { name, createdAt: new Date().toISOString() }]
        const prevItems = itemsOf(prev)
        const current = prevItems[filename] ?? []
        const nextList = current.includes(name)
          ? current.filter(t => t !== name)
          : [...current, name]
        const nextItems = { ...prevItems }
        if (nextList.length === 0) delete nextItems[filename]
        else nextItems[filename] = nextList
        return { tags: nextTags, [itemsField]: nextItems } as ProjectTagState
      })
    },
    [update, itemsOf, itemsField],
  )

  const removeTagFromItem = useCallback(
    (filename: string, name: string) => {
      update(prev => {
        const prevItems = itemsOf(prev)
        const current = prevItems[filename] ?? []
        if (!current.includes(name)) return prev
        const nextList = current.filter(t => t !== name)
        const nextItems = { ...prevItems }
        if (nextList.length === 0) delete nextItems[filename]
        else nextItems[filename] = nextList
        return { ...prev, [itemsField]: nextItems } as ProjectTagState
      })
    },
    [update, itemsOf, itemsField],
  )

  return {
    tags,
    tagCounts,
    tagsFor,
    createTag,
    deleteTag,
    renameTag,
    toggleTag,
    removeTagFromItem,
  }
}
