// Keeps Agent Studio's project-local workflow watchers aligned with Claude's
// project registry. Registry transcripts are created before their first complete
// JSONL record, so add and change events must be treated as one debounced update.

import { isAbsolute, relative, sep } from 'path';

export function projectHashForRegistryEvent(projectsDir: string, eventPath: string): string | null {
  const rel = relative(projectsDir, eventPath);
  if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;

  const parts = rel.split(sep);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2 && parts[1].endsWith('.jsonl')) return parts[0];
  return null;
}

export function createProjectWorkflowWatchSync({
  projectsDir,
  invalidate,
  sync,
  delayMs = 100,
}: {
  projectsDir: string;
  invalidate: (hash: string) => void;
  sync: () => void;
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

      pendingHashes.add(hash);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
  };
}
