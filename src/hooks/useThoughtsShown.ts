import { useCallback } from 'react';
import { usePersistentState } from './usePersistentState';

// Whether the transcript narrates what Claude says it is doing — the paced line
// above the control pill (see chat/thoughts.ts).
//
// Persisted like the other UI-state hooks. The stored flag is the NEGATIVE
// ("hidden") so that an absent preference — a fresh install, or a build older
// than this feature — reads as on, which is the default the line is designed
// for: it costs no layout and says nothing when there is nothing to say.
//
// Module-level identities so usePersistentState's callbacks stay referentially
// stable across renders.
const STORAGE_KEY = 'cl-thoughts-hidden';
const EVENT_NAME = 'cl-thoughts-hidden-changed';
const fallback = () => false;
const deserialize = (raw: string) => raw === 'true';
const serialize = (value: boolean) => value;

export function useThoughtsShown(): { shown: boolean; toggle: () => void } {
  const { value, read, commit } = usePersistentState<boolean>({
    storageKey: STORAGE_KEY,
    eventName: EVENT_NAME,
    fallback,
    deserialize,
    serialize,
  });
  // Read-modify-write on the freshest value, like the rail/pin hooks.
  const toggle = useCallback(() => commit(!read()), [commit, read]);
  return { shown: !value, toggle };
}
