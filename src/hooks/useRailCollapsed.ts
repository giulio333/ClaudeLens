import { useCallback } from 'react';
import { usePersistentState } from './usePersistentState';

// Collapsed/expanded state of the project rail (the vertical nav column that
// replaced the horizontal subtab bar). Persisted like the other UI-state hooks
// so the rail keeps its width across launches.
//
// Module-level identities so usePersistentState's read/write callbacks stay
// referentially stable across renders.
const STORAGE_KEY = 'cl-rail-collapsed';
const EVENT_NAME = 'cl-rail-collapsed-changed';
const fallback = () => false;
const deserialize = (raw: string) => raw === 'true';
const serialize = (value: boolean) => value;

export function useRailCollapsed(): { collapsed: boolean; toggle: () => void } {
  const { value, read, commit } = usePersistentState<boolean>({
    storageKey: STORAGE_KEY,
    eventName: EVENT_NAME,
    fallback,
    deserialize,
    serialize,
  });
  // Read-modify-write on the freshest value, like the pin/tag hooks: two rails
  // can never be mounted at once today, but the contract stays the same.
  const toggle = useCallback(() => commit(!read()), [commit, read]);
  return { collapsed: value, toggle };
}
