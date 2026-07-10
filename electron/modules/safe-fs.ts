import { promises as fsp } from 'fs';

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Read a text file without ever blocking the main process. Project paths can
 * live on iCloud Drive / network volumes: a dataless (evicted) file makes the
 * kernel materialize it on first read, which can stall for a long time and
 * fail with ECANCELED — a readFileSync there freezes the whole app. The async
 * read stalls at most a libuv worker thread, and the timeout caps how long a
 * caller waits before treating the file as unreadable.
 */
export async function readTextFile(
  filePath: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  return withTimeout(
    fsp.readFile(filePath, 'utf-8'),
    timeoutMs,
    `Read timed out after ${timeoutMs}ms (file not materialized?): ${filePath}`,
  );
}

/**
 * Cap any promise whose underlying work may touch stalled files (e.g. the Agent
 * SDK resolving the settings cascade of a project on iCloud). Rejects with
 * `message` after `timeoutMs`; the underlying work is not cancelled.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
