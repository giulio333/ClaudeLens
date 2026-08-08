import { existsSync } from 'fs';
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
