// Pure diff over successive snapshots of the live-session registry. The registry
// has NO events — it heartbeats a full snapshot every few seconds — so to avoid a
// notification storm we emit only on *state transitions*, not on every read.
//
// Two transitions matter:
//   - any -> `waiting`: the session is blocked on the user (e.g. a permission
//     prompt) → `needs-attention`.
//   - `busy` -> `idle`: the session finished its turn and is back at the prompt
//     waiting for your next input ("the agent is done, your turn") → `completed`.
// Both are deduped by construction: each fires only on the read where the status
// *flips*, never while it stays in that state. Sessions without a stable id
// (process-scanner fallback) are ignored — we can't track them across reads or
// navigate to them.
//
// `now`/`mkId` are injected (no Date.now / randomUUID here) so the module stays
// pure and unit-testable, mirroring sessions-registry-reader.ts.

import type { ActiveSession } from '../sessions-registry-reader';
import type { NotificationEvent } from './types';

export interface RegistryDiffState {
  /** Last snapshot keyed by sessionId. */
  prev: Map<string, ActiveSession>;
  /** False until the first snapshot is recorded — suppresses a startup burst of
   *  "needs-attention" for sessions that were already waiting when the app opened. */
  primed: boolean;
}

export function createRegistryDiffState(): RegistryDiffState {
  return { prev: new Map(), primed: false };
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

  // Warm-up: first snapshot just seeds `prev`, emits nothing.
  if (!state.primed) {
    state.prev = currMap;
    state.primed = true;
    return [];
  }

  const events: NotificationEvent[] = [];
  for (const [id, s] of currMap) {
    const before = state.prev.get(id);
    // Fired only on the flip *into* waiting — not while it stays waiting.
    if (s.status === 'waiting' && before?.status !== 'waiting') {
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
  }

  state.prev = currMap;
  return events;
}

// Last path segment of a cwd, for a compact "which session" hint in the body.
function projectLabel(cwd: string): string | undefined {
  const parts = cwd.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : undefined;
}
