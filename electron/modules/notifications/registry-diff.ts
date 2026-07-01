// Pure diff over successive snapshots of the live-session registry. The registry
// has NO events — it heartbeats a full snapshot every few seconds — so to avoid a
// notification storm we emit only on *state transitions*, not on every read.
//
// Two transitions matter:
//   - any -> `waiting`: the session is blocked on the user (e.g. a permission
//     prompt) → `needs-attention`.
//   - `busy` -> `idle`: the session finished its turn and is back at the prompt
//     waiting for your next input ("the agent is done, your turn") → `completed`.
// Both are deduped: `completed` fires only on the read where the status flips,
// and `needs-attention` fires once per stretch of `waiting` (tracked in a
// notified set, so a session that drops out of one read — a registry file can
// fail a single parse mid-rewrite — and reappears still waiting doesn't
// re-fire). Sessions without a stable id (process-scanner fallback) are
// ignored — we can't track them across reads or navigate to them.
//
// `now`/`mkId` are injected (no Date.now / randomUUID here) so the module stays
// pure and unit-testable, mirroring sessions-registry-reader.ts.

import type { ActiveSession } from '../sessions-registry-reader';
import type { NotificationEvent } from './types';

export interface RegistryDiffState {
  /** Last snapshot keyed by sessionId. */
  prev: Map<string, ActiveSession>;
  /** Ids already notified (or seeded) as `waiting`. Cleared only when the session
   *  is *seen* leaving `waiting`, not when it merely drops out of a snapshot — a
   *  registry file can fail one read (rewritten mid-read) and reappear on the
   *  next, and diffing on `prev` alone would re-fire needs-attention for it. */
  waitingNotified: Set<string>;
  /** False until the first snapshot is recorded — suppresses a startup burst of
   *  "needs-attention" for sessions that were already waiting when the app opened. */
  primed: boolean;
}

export function createRegistryDiffState(): RegistryDiffState {
  return { prev: new Map(), waitingNotified: new Set(), primed: false };
}

export interface DiffDeps {
  now: () => number;
  /** Stable id for a (kind, sessionId, transition) — used for renderer dedup. */
  mkId: () => string;
}

/**
 * Compare the current registry snapshot against the previous one and return the
 * notification events for the transitions that occurred. Mutates `state` in place
 * (records the new snapshot, flips `primed`).
 */
export function diffRegistry(
  curr: ActiveSession[],
  state: RegistryDiffState,
  deps: DiffDeps
): NotificationEvent[] {
  // Only registry entries with a real session id are trackable.
  const currMap = new Map(curr.filter(s => s.source === 'registry' && s.sessionId).map(s => [s.sessionId, s]));

  // Warm-up: first snapshot just seeds the state, emits nothing. Sessions
  // already waiting are marked as notified so they can't fire later (e.g. after
  // transiently dropping out of a read and coming back still waiting).
  if (!state.primed) {
    state.prev = currMap;
    for (const [id, s] of currMap) if (s.status === 'waiting') state.waitingNotified.add(id);
    state.primed = true;
    return [];
  }

  const events: NotificationEvent[] = [];
  for (const [id, s] of currMap) {
    const before = state.prev.get(id);
    // Fired only once per stretch of `waiting`: the notified set (not `prev`)
    // is the memory, so a session that misses one snapshot and reappears still
    // waiting doesn't re-fire. Leaving `waiting` while present re-arms it.
    if (s.status === 'waiting') {
      if (!state.waitingNotified.has(id)) {
        state.waitingNotified.add(id);
        events.push({
          id: deps.mkId(),
          kind: 'needs-attention',
          sessionId: id,
          cwd: s.cwd,
          title: 'A session is waiting for you',
          body: s.waitingFor || undefined,
          createdAt: deps.now(),
          source: 'registry',
        });
      }
    } else if (s.status === 'idle' && before?.status === 'busy') {
      // The session was working and is now back at the prompt: turn finished.
      events.push({
        id: deps.mkId(),
        kind: 'completed',
        sessionId: id,
        cwd: s.cwd,
        title: 'Claude finished — your turn',
        body: projectLabel(s.cwd),
        createdAt: deps.now(),
        source: 'registry',
      });
    }
    // Present and no longer waiting: re-arm needs-attention for this session.
    if (s.status !== 'waiting') state.waitingNotified.delete(id);
  }

  // Forget notified ids missing from two consecutive snapshots (session really
  // gone, not a one-read hiccup) so the set can't grow unbounded.
  for (const id of state.waitingNotified) {
    if (!currMap.has(id) && !state.prev.has(id)) state.waitingNotified.delete(id);
  }

  state.prev = currMap;
  return events;
}

// Last path segment of a cwd, for a compact "which session" hint in the body.
function projectLabel(cwd: string): string | undefined {
  const parts = cwd.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : undefined;
}
