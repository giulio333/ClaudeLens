import { useNamespacedTags, type NamespacedTag } from './useNamespacedTags'

const STORAGE_KEY = 'cl-memory-tags'
const EVENT = 'cl-memory-tags-changed'

// Memory-topic tags are a namespaced-tags store keyed by the topic `.md`
// filename. See useNamespacedTags for the shared logic; this wrapper pins the
// storage key/event/field and exposes the engine under this hook's original
// public names. Note: useMemoryTags never exposed `createTag` or a
// remove-from-item helper, so they are intentionally not re-exported here.

export type MemoryTag = NamespacedTag

export function useMemoryTags(projectHash: string) {
  const { tags, tagCounts, tagsFor, deleteTag, renameTag, toggleTag } = useNamespacedTags(
    projectHash,
    {
      storageKey: STORAGE_KEY,
      eventName: EVENT,
      itemsField: 'memoryTags',
    },
  )

  return {
    tags,
    tagCounts,
    tagsForMemory: tagsFor,
    deleteTag,
    renameTag,
    toggleTagOnMemory: toggleTag,
  }
}
