// Keeps Agent Studio's project-local workflow watchers aligned with Claude's
// project registry. Registry transcripts are created before their first complete
// JSONL record, so add and change events must be treated as one debounced update.
//
// That "and change" is why this coordinator needs `isResolved`. A project's
// transcript path is indistinguishable from a *newly created* project's, and a
// live session appends to it continuously — so without the predicate every
// append re-ran the sync, and the sync ends in an unscoped `data:changed` that
// invalidates every React Query cache. The scoped-invalidation work (#148) was
// therefore inert during exactly the workload it was written for: a live chat.
//
// The predicate states the coordinator's actual job — react while a project's
// authoritative cwd is still unknown, go quiet once it has been read.

import { isAbsolute, relative, sep } from 'path';

export function projectHashForRegistryEvent(projectsDir: string, eventPath: string): string | null {
  const rel = relative(projectsDir, eventPath);
  if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;

  const parts = rel.split(sep);
  if (parts.length === 1) return parts[0];

  // A transcript, in EITHER native layout: `<hash>/<id>.jsonl` and
  // `<hash>/sessions/<id>.jsonl` are the same event — the write that finally
  // carries the project's cwd. Matching the root alone meant a `sessions/`-layout
  // project never got the one event this coordinator exists for, so its cwd was
  // still the lossy guess and its project-local `.claude/workflows/` was never
  // watched.
  //
  // Nothing deeper qualifies: `<hash>/<id>/subagents/agent-*.jsonl` (and its
  // `sessions/` twin) is a sub-agent sidecar, which says nothing new about the
  // project that its parent transcript has not already said.
  if (!parts[parts.length - 1].endsWith('.jsonl')) return null;
  if (parts.length === 2) return parts[0];
  if (parts.length === 3 && parts[1] === 'sessions') return parts[0];
  return null;
}

export function createProjectWorkflowWatchSync({
  projectsDir,
  invalidate,
  sync,
  isResolved,
  delayMs = 100,
}: {
  projectsDir: string;
  invalidate: (hash: string) => void;
  sync: () => void;
  /**
   * True when `hash` already has an authoritative cwd. Events for such a
   * project are dropped: there is nothing left to learn from them, and the
   * sync they would trigger is a full-cache invalidation. Omitted = every
   * event is processed, the behaviour before the predicate existed.
   */
  isResolved?: (hash: string) => boolean;
  delayMs?: number;
}): { onEvent: (eventPath: string) => void } {
  const pendingHashes = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    for (const hash of pendingHashes) invalidate(hash);
    pendingHashes.clear();
    sync();
  };

  return {
    onEvent(eventPath: string) {
      const hash = projectHashForRegistryEvent(projectsDir, eventPath);
      if (!hash) return;
      // Checked on arrival, not at flush time: the point is to never arm the
      // timer for a settled project, so a busy session stays entirely silent.
      if (isResolved?.(hash)) return;

      pendingHashes.add(hash);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
  };
}
