// Persistent ClaudeLens UI preferences (pinned projects/sessions, session tags).
//
// These are *ClaudeLens* state, not Claude data, so they live in a dedicated
// `~/.claudelens/` directory — deliberately separate from `~/.claude/`. They
// used to be kept in the renderer's `localStorage`, but under the packaged
// `file://` origin Chromium does not persist `localStorage` reliably, so the
// data appeared to reset on reinstall. Storing it on disk via this module makes
// it survive app updates and reinstalls.

import os from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';

const PREFS_DIR = join(os.homedir(), '.claudelens');
const PREFS_FILE = join(PREFS_DIR, 'preferences.json');

// Only ClaudeLens-namespaced keys are accepted, so the renderer can't bloat the
// file with arbitrary content.
const KEY_RE = /^cl-[a-z0-9-]+$/;

export type Prefs = Record<string, unknown>;

export function readPrefs(): Prefs {
  try {
    if (!existsSync(PREFS_FILE)) return {};
    const parsed = JSON.parse(readFileSync(PREFS_FILE, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Prefs) : {};
  } catch {
    return {};
  }
}

export function setPref(key: string, value: unknown): void {
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    throw new Error(`Invalid preference key: ${JSON.stringify(key)}`);
  }
  const current = readPrefs();
  current[key] = value;
  mkdirSync(PREFS_DIR, { recursive: true });
  // Atomic write: serialize to a temp file in the same dir, then rename, so a
  // crash mid-write can't leave a truncated/corrupt preferences.json.
  const tmp = `${PREFS_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf-8');
  renameSync(tmp, PREFS_FILE);
}
