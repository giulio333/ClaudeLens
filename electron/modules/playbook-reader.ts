import { lstat, open, readdir, realpath, stat } from 'fs/promises';
import { basename, isAbsolute, join, relative } from 'path';
import { setImmediate } from 'timers/promises';
import type { PromptCandidates } from '../shared/playbook-types';
import {
  detectPromptCandidates,
  humanPromptText,
  promptFingerprint,
  type PromptSession,
} from './playbook-detector';
import { readPlaybook, validatePlaybookHash } from './playbook-store';
import { listProjectSessionFiles } from './session-files';
import { withTimeout } from './safe-fs';
import { parseChatSessionText } from './session-reader';
import { mergeTranscriptExtras, parseTranscriptExtras } from './transcript-extras';

export interface PlaybookScanLimits {
  maxSessions?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxPromptBytes?: number;
  maxElapsedMs?: number;
}

async function containedPath(root: string, path: string): Promise<string> {
  const canonical = await realpath(path);
  const rel = relative(root, canonical);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
    throw new Error('Transcript path is outside the project history.');
  }
  return canonical;
}

/** Read at most the budget, even when the file grows after its stat. */
async function boundedRead(file: string, cap: number): Promise<string | null> {
  if ((await lstat(file)).isSymbolicLink()) return null;
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > cap) return null;
    const buffer = Buffer.alloc(info.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const result = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    if (bytes > cap || bytes > info.size) return null;
    return buffer.toString('utf8', 0, bytes);
  } finally {
    await handle.close();
  }
}

/** The extras reader also understands agent queues. Exclude their source rows
 * before merging, and refuse peer-origin prose even without its usual isMeta. */
function humanSessionRows(raw: string): string {
  return raw
    .split('\n')
    .filter(line => {
      if (!/"isSidechain"\s*:\s*true|"kind"\s*:\s*"(?:peer|auto-continuation)"/.test(line))
        return true;
      try {
        const row = JSON.parse(line) as { isSidechain?: boolean; origin?: { kind?: string } };
        return (
          row.isSidechain !== true &&
          row.origin?.kind !== 'peer' &&
          row.origin?.kind !== 'auto-continuation'
        );
      } catch {
        return true;
      }
    })
    .join('\n');
}

/** On demand only. No index, filesystem watcher, timer, or persisted candidates. */
export async function scanPromptCandidates(
  projectsRoot: string,
  storeRoot: string,
  hash: unknown,
  limits: PlaybookScanLimits = {}
): Promise<PromptCandidates> {
  const started = Date.now();
  validatePlaybookHash(hash);
  const store = await readPlaybook(storeRoot, hash);
  const excluded = new Set([
    ...store.dismissed,
    ...store.templates.map(item => promptFingerprint(item.text)),
  ]);
  let project: string;
  try {
    const root = await realpath(projectsRoot);
    const requested = join(root, hash);
    if ((await lstat(requested)).isSymbolicLink())
      throw new Error('Project history cannot be a symbolic link.');
    project = await containedPath(root, requested);
    // glob treats unreadable directories as empty; verify readability explicitly.
    await readdir(project);
  } catch (error) {
    // A fresh chat has a project before Claude Code writes its first transcript.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { candidates: [], scannedSessions: 0, truncated: false, skippedSessions: 0 };
    }
    throw error;
  }
  const nested = join(project, 'sessions');
  try {
    if ((await lstat(nested)).isSymbolicLink())
      throw new Error('Session history cannot be a symbolic link.');
    if ((await stat(nested)).isDirectory()) await readdir(await containedPath(project, nested));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const files = (
    await withTimeout(listProjectSessionFiles(project), 5000, 'Reading project sessions timed out.')
  ).sort();
  const maxSessions = limits.maxSessions ?? 500;
  const maxFileBytes = limits.maxFileBytes ?? 16 * 1024 * 1024;
  const maxTotalBytes = limits.maxTotalBytes ?? 128 * 1024 * 1024;
  const maxPromptBytes = limits.maxPromptBytes ?? 8 * 1024 * 1024;
  const maxElapsedMs = limits.maxElapsedMs ?? 10_000;
  const sessions: PromptSession[] = [];
  let bytesRead = 0;
  let promptBytes = 0;
  let skippedSessions = 0;
  let truncated = files.length > maxSessions;
  for (const file of files.slice(0, maxSessions)) {
    if (
      bytesRead >= maxTotalBytes ||
      promptBytes >= maxPromptBytes ||
      Date.now() - started >= maxElapsedMs
    ) {
      truncated = true;
      break;
    }
    try {
      const raw = await withTimeout(
        (async () => {
          if ((await lstat(file)).isSymbolicLink()) return null;
          return boundedRead(
            await containedPath(project, file),
            Math.min(maxFileBytes, maxTotalBytes - bytesRead)
          );
        })(),
        Math.max(1, Math.min(3000, maxElapsedMs - (Date.now() - started))),
        'Transcript read timed out.'
      );
      if (raw === null) {
        skippedSessions++;
        continue;
      }
      bytesRead += Buffer.byteLength(raw);
      const source = humanSessionRows(raw);
      const messages = mergeTranscriptExtras(
        parseChatSessionText(source),
        parseTranscriptExtras(source)
      );
      const human = messages.filter(message => humanPromptText(message) !== null);
      promptBytes += human.reduce(
        (total, message) => total + Buffer.byteLength(humanPromptText(message)!),
        0
      );
      sessions.push({ sessionId: basename(file, '.jsonl'), messages: human });
    } catch (error) {
      skippedSessions++;
      // Stop after a stalled filesystem read; do not accumulate blocked workers.
      if (error instanceof Error && error.message === 'Transcript read timed out.') {
        truncated = true;
        break;
      }
    }
    await setImmediate();
  }
  return {
    candidates: detectPromptCandidates(sessions, excluded),
    scannedSessions: sessions.length,
    truncated: truncated || skippedSessions > 0,
    skippedSessions,
  };
}
