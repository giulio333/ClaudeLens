import { useCallback } from 'react';
import { usePersistentState } from './usePersistentState';

const STORAGE_KEY = 'cl-pinned-sessions';
const EVENT = 'cl-pinned-sessions-changed';

function pinKey(projectHash: string, sessionFilename: string): string {
  return `${projectHash}::${sessionFilename}`;
}

// On-disk format (unchanged): a JSON array of `${projectHash}::${filename}` pin
// keys, surfaced in-memory as a Set. usePersistentState handles the
// localStorage + disk-mirror + cross-tab/same-tab sync; this hook only owns the
// Set<->array (de)serialization and the toggle/lookup helpers.

// Module-level (stable identities) so usePersistentState's read/write — and the
// sync effect that depends on them — subscribe once, matching the original
// hand-rolled effect's empty-deps behavior (no per-render listener churn).
function emptyPins(): Set<string> {
  return new Set();
}

function deserialize(raw: string): Set<string> {
  const arr = JSON.parse(raw);
  return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
}

// Persist the parsed array form (not the Set), matching the legacy writer.
function serialize(set: Set<string>): string[] {
  return [...set];
}

export function usePinnedSessions() {
  const {
    value: pinned,
    read,
    commit,
  } = usePersistentState<Set<string>>({
    storageKey: STORAGE_KEY,
    eventName: EVENT,
    fallback: emptyPins,
    deserialize,
    serialize,
  });

  const togglePin = useCallback(
    (projectHash: string, sessionFilename: string) => {
      const key = pinKey(projectHash, sessionFilename);
      const next = new Set(read());
      if (next.has(key)) next.delete(key);
      else next.add(key);
      commit(next);
    },
    [read, commit]
  );

  const isPinned = useCallback(
    (projectHash: string, sessionFilename: string) =>
      pinned.has(pinKey(projectHash, sessionFilename)),
    [pinned]
  );

  return { pinned, isPinned, togglePin };
}
