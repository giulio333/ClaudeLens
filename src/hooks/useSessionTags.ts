import { useNamespacedTags, type NamespacedTag } from './useNamespacedTags';

const STORAGE_KEY = 'cl-session-tags';
const EVENT = 'cl-session-tags-changed';

// Per-session tags are a namespaced-tags store keyed by the session `.jsonl`
// filename. See useNamespacedTags for the shared logic; this wrapper only pins
// the storage key/event/field and re-exposes the engine under the public names
// this hook has always returned (so consumers stay unchanged).

export type SessionTag = NamespacedTag;

export function useSessionTags(projectHash: string) {
  const {
    tags,
    tagCounts,
    tagsFor,
    createTag,
    deleteTag,
    renameTag,
    toggleTag,
    removeTagFromItem,
  } = useNamespacedTags(projectHash, {
    storageKey: STORAGE_KEY,
    eventName: EVENT,
    itemsField: 'sessionTags',
  });

  return {
    tags,
    tagCounts,
    tagsForSession: tagsFor,
    createTag,
    deleteTag,
    renameTag,
    toggleTagOnSession: toggleTag,
    removeTagFromSession: removeTagFromItem,
  };
}
