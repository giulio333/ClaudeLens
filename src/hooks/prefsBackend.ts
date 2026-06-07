// Bridges the localStorage-backed UI-state hooks (pinned projects/sessions,
// session tags) to the on-disk store in ~/.claudelens/preferences.json.
//
// localStorage stays the synchronous in-memory cache the hooks read from; disk
// is the durable source of truth. Every write is mirrored to disk, and on
// startup `hydratePrefs()` loads disk into localStorage. Under the packaged
// `file://` origin Chromium doesn't persist localStorage reliably, which made
// pins/tags "reset" on reinstall — disk persistence fixes that.

// localStorage key → the custom event each hook dispatches so same-window
// listeners re-read after an external (hydration) write.
const KEY_EVENTS: Record<string, string> = {
  'cl-pinned-projects': 'cl-pinned-projects-changed',
  'cl-pinned-sessions': 'cl-pinned-sessions-changed',
  'cl-session-tags': 'cl-session-tags-changed',
  'cl-memory-tags': 'cl-memory-tags-changed',
  'cl-theme': 'cl-theme-changed',
}

function hasBackend(): boolean {
  return typeof window !== 'undefined' && !!window.electronAPI?.prefs
}

// Fire-and-forget mirror of a hook write to the on-disk store. `value` is the
// already-parsed structure (array/object), not the JSON string.
export function persistToDisk(key: string, value: unknown): void {
  if (!hasBackend()) return
  window.electronAPI.prefs.set(key, value).catch(() => {
    /* best-effort: localStorage already holds the value for this session */
  })
}

// Load on-disk prefs into localStorage once at startup. For each known key:
// - disk has a value  → disk wins; hydrate localStorage and notify the hooks
// - disk is empty      → migrate any pre-existing localStorage value to disk
//   (preserves pins/tags created by older, localStorage-only builds)
export async function hydratePrefs(): Promise<void> {
  if (!hasBackend() || typeof localStorage === 'undefined') return
  let disk: Record<string, unknown>
  try {
    const res = await window.electronAPI.prefs.getAll()
    if (res.error || !res.data) return
    disk = res.data
  } catch {
    return
  }

  for (const [key, event] of Object.entries(KEY_EVENTS)) {
    const diskVal = disk[key]
    if (diskVal !== undefined && diskVal !== null) {
      try {
        localStorage.setItem(key, JSON.stringify(diskVal))
        window.dispatchEvent(new CustomEvent(event))
      } catch { /* ignore */ }
    } else {
      const local = localStorage.getItem(key)
      if (local) {
        try { persistToDisk(key, JSON.parse(local)) } catch { /* ignore */ }
      }
    }
  }
}
