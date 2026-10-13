// The user's scratchpad for a session: one Markdown file per session id under
// ClaudeLens's own state dir. Claude never reads it; the transcript stays untouched.

import { randomUUID } from 'crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

export const MAX_NOTES_BYTES = 256 * 1024;

const writes = new Map<string, Promise<unknown>>();

export function resetNotesWrites(): void {
  writes.clear();
}

function validateSessionId(sessionId: unknown): asserts sessionId is string {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) {
    throw new Error('Invalid session id.');
  }
}

function validateText(text: unknown): asserts text is string {
  if (typeof text !== 'string' || text.includes('\0')) throw new Error('Invalid notes text.');
  if (Buffer.byteLength(text) > MAX_NOTES_BYTES) throw new Error('Notes are too long.');
}

async function assertSafePath(path: string, directory: boolean): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) {
      throw new Error('Notes paths must be regular files and directories, not symbolic links.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function notesPath(root: string, sessionId: unknown): Promise<string> {
  validateSessionId(sessionId);
  await assertSafePath(dirname(root), true);
  await assertSafePath(root, true);
  const file = join(root, `${sessionId}.md`);
  await assertSafePath(file, false);
  return file;
}

/** The session's notes, or '' when it has none. */
export async function readSessionNotes(root: string, sessionId: unknown): Promise<string> {
  const file = await notesPath(root, sessionId);
  try {
    const info = await lstat(file);
    if (info.size > MAX_NOTES_BYTES) throw new Error('Notes file is too large.');
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

/** Replace the session's notes. Blank text removes the file, so an emptied
 *  scratchpad leaves nothing behind. Writes to one file are serialized. */
export function writeSessionNotes(root: string, sessionId: unknown, text: unknown): Promise<null> {
  validateSessionId(sessionId);
  validateText(text);
  const key = join(root, sessionId);
  const operation = (writes.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const file = await notesPath(root, sessionId);
      if (!text.trim()) {
        await unlink(file).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        });
        return null;
      }
      await mkdir(root, { recursive: true, mode: 0o700 });
      await notesPath(root, sessionId);
      const temporary = join(root, `.notes-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      return null;
    });
  writes.set(key, operation);
  void operation
    .finally(() => {
      if (writes.get(key) === operation) writes.delete(key);
    })
    .catch(() => undefined);
  return operation;
}
