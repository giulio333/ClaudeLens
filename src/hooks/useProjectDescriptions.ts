import { useCallback } from 'react';
import { usePersistentState } from './usePersistentState';

const STORAGE_KEY = 'cl-project-descriptions';
const EVENT = 'cl-project-descriptions-changed';

// The user's own wording for a project, keyed by project hash. It lives here —
// ClaudeLens' own prefs store — and NOT in the project's CLAUDE.md: that file
// belongs to the repo and to Claude Code, and editing a description in this app
// must never rewrite it. The CLAUDE.md is only a source to derive a default
// from (`projects:getDescription`); an entry here overrides it, and deleting
// the entry falls back to the derived text.
//
// On-disk format: a plain object { [hash]: text }.

function emptyDescriptions(): Record<string, string> {
  return {};
}

function deserialize(raw: string): Record<string, string> {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [hash, text] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof text === 'string' && text.trim()) out[hash] = text;
  }
  return out;
}

function serialize(value: Record<string, string>): Record<string, string> {
  return value;
}

export function useProjectDescriptions() {
  const {
    value: descriptions,
    read,
    commit,
  } = usePersistentState<Record<string, string>>({
    storageKey: STORAGE_KEY,
    eventName: EVENT,
    fallback: emptyDescriptions,
    deserialize,
    serialize,
  });

  // An empty string is how the UI says "drop my wording": it clears the entry
  // so the CLAUDE.md-derived text takes over again, rather than storing a blank
  // description that would read as "this project has none".
  const setDescription = useCallback(
    (hash: string, text: string) => {
      const next = { ...read() };
      const trimmed = text.trim();
      if (trimmed) next[hash] = trimmed;
      else delete next[hash];
      commit(next);
    },
    [read, commit]
  );

  const descriptionFor = useCallback((hash: string) => descriptions[hash] ?? null, [descriptions]);

  return { descriptions, descriptionFor, setDescription };
}
