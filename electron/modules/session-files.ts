import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';

// Claude Code stores a project's session transcripts in one of TWO layouts:
// `<hash>/sessions/*.jsonl` (newer) or `<hash>/*.jsonl` (older). Every reader
// that enumerates a project's sessions has to probe both, and each one that
// grew its own copy of the probe was one more place to get it wrong — which is
// exactly what happened to `tasks-reader`, the only enumerator that read the
// root alone and therefore reported "no tasks" for every `sessions/`-layout
// project. One implementation, used by all of them.

/**
 * A project's session transcripts, from both native locations.
 *
 * `<hash>/sessions/*.jsonl` wins when that directory exists AND holds
 * transcripts; an existing-but-empty `sessions/` falls through to the root, so a
 * project mid-migration is never reported as session-less.
 *
 * Deliberately NOT recursive: real session files are direct children.
 * `**\/*.jsonl` would also match `{sessionId}/subagents/**\/agent-*.jsonl` and
 * make every sub-agent sidecar look like a session (#95).
 *
 * `onScan` is called once for each directory actually globbed, with that
 * directory's live file list. Callers that keep an incremental parse cache keyed
 * by directory use it to evict the entries of transcripts that have since
 * disappeared — the glob IS the complete set for that directory, so anything
 * cached under it and missing from the list is provably gone.
 */
export async function listProjectSessionFiles(
  projectPath: string,
  onScan?: (dir: string, files: string[]) => void
): Promise<string[]> {
  const sessionsDir = join(projectPath, 'sessions');
  if (existsSync(sessionsDir)) {
    const files = await glob('*.jsonl', { cwd: sessionsDir, absolute: true });
    onScan?.(sessionsDir, files);
    if (files.length > 0) return files;
  }
  const files = await glob('*.jsonl', { cwd: projectPath, absolute: true });
  onScan?.(projectPath, files);
  return files;
}

/**
 * The synchronous sibling of `listProjectSessionFiles`, same rule, same reason
 * to exist.
 *
 * It is here rather than at its one call site because that call site —
 * `resolveRealPath`, which reads a project's authoritative cwd out of a
 * transcript — is precisely where the probe went wrong again: it listed the
 * project root alone, so every `sessions/`-layout project fell back to the lossy
 * `hashToPath` inversion and its real cwd was never learned at all. That is the
 * `tasks-reader` defect a second time, in the one function whose answer names
 * the project everywhere else.
 *
 * Sync because that caller is: it runs on the main process while the window is
 * being built, and the async form would turn a path lookup into a promise every
 * consumer of the registry would have to thread.
 */
export function listProjectSessionFilesSync(projectPath: string): string[] {
  const sessionsDir = join(projectPath, 'sessions');
  const nested = jsonlFilesIn(sessionsDir);
  if (nested.length > 0) return nested;
  return jsonlFilesIn(projectPath);
}

/** The `.jsonl` direct children of `dir`, absolute; [] when it cannot be read. */
function jsonlFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter(name => name.endsWith('.jsonl'))
      .map(name => join(dir, name));
  } catch {
    // Missing or unreadable: indistinguishable from empty for this question.
    return [];
  }
}
