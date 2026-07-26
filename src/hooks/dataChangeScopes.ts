// Renderer half of the scoped `data:changed` protocol: the main process tags
// each watcher event with the namespaces the changed path can affect
// (electron/modules/data-change-scope.ts), and this table says which React
// Query keys each namespace owns. An event only invalidates the groups it can
// have touched — an append to a live chat's transcript has no reason to re-read
// skills, agents or plugins (#148).
//
// Pure, so the payload handling is unit-tested without a DOM.

// A Map, not an object literal: the scope names arrive over IPC and are used to
// look the group up, and `'constructor' in {}` is true through the prototype
// chain — an object would validate that scope and then hand the caller a
// function to iterate (TypeError). A Map has no prototype keys to inherit.
export const SCOPE_KEYS = new Map<string, string[]>([
  ['sessions', ['sessions:project', 'sessions:chat', 'sessions:subagents', 'sessions:subagentTranscript']],
  ['cost', ['cost:summary', 'cost:project']],
  ['plans', ['plans:project']],
  ['tasks', ['tasks:project']],
  ['teams', ['teams:project', 'teams:detail']],
  ['workflows', ['workflows:project', 'workflows:run']],
  ['studio', ['studio:all', 'studio:blueprint']],
  ['plugins', ['plugins:all']],
  ['memory', ['memory:projects', 'memory:project']],
  ['claudeMd', ['claudeMd:hierarchy', 'claudeMd:global']],
  ['rules', ['rules:project']],
  ['skills', ['skills:global', 'skills:all']],
  ['agents', ['agents:global', 'agents:project']],
  ['mcp', ['mcp:global']],
])

export const ALL_SCOPES = [...SCOPE_KEYS.keys()]

/**
 * The scopes to invalidate for one `data:changed` payload.
 *
 * Anything we cannot fully vouch for — absent, not an array, or carrying a
 * single unknown entry — falls back to every scope, which is what the hook did
 * before it was scoped at all. Never narrow on a signal we don't understand: a
 * silently stale view is the worse failure.
 */
export function scopesFromPayload(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) return ALL_SCOPES;
  return scopes.every(s => SCOPE_KEYS.has(s as string)) ? (scopes as string[]) : ALL_SCOPES;
}

/** The query keys owned by a scope; empty for an unknown one. */
export function keysForScope(scope: string): string[] {
  return SCOPE_KEYS.get(scope) ?? [];
}
