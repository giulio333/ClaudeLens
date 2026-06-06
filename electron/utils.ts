import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve, sep } from 'path';
import os from 'os';

// Respect CLAUDE_CONFIG_DIR if the user has relocated their Claude data dir.
export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? join(os.homedir(), '.claude');

// Allowed charset for user-created entity names (skills, agents). It rejects
// path separators, so a crafted name like "../../tmp/x" can't escape the
// target directory; '.' and '..' are excluded explicitly since they'd pass the
// charset but still traverse.
const ENTITY_NAME_RE = /^[A-Za-z0-9._ -]{1,80}$/;

/**
 * Validate a renderer-supplied entity name before it is interpolated into a
 * write path. Returns the trimmed name, or throws for anything unsafe.
 */
export function validateEntityName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (trimmed === '.' || trimmed === '..' || !ENTITY_NAME_RE.test(trimmed)) {
    throw new Error(
      `Invalid name "${name}": use only letters, numbers, spaces, '.', '_' or '-' (max 80 chars), and not '.'/'..'.`
    );
  }
  return trimmed;
}

/**
 * Defense in depth: assert a built target path stays inside `baseDir` after
 * resolution. Throws otherwise. Pair with validateEntityName at write sites.
 */
export function assertWithin(baseDir: string, target: string): void {
  const base = resolve(baseDir);
  const resolved = resolve(target);
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error(`Refusing to write outside ${base}: ${resolved}`);
  }
}

// Claude Code session ids are UUIDs. Validate before interpolating an id into a
// shell command (resume/attach) so metacharacters can't break out.
const SESSION_ID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

export function hashToPath(hash: string): string {
  // Fallback ingenuo: Claude Code converte sia '/' sia '.' in '-' nel nome cartella,
  // quindi questa inversione è lossy (es. SARA2.0 → SARA2-0 → SARA2/0).
  // Usa resolveRealPath quando possibile per leggere il cwd autoritativo dai .jsonl.
  return '/' + hash.replace(/^-/, '').replace(/-/g, '/');
}

export function pathToHash(realPath: string): string {
  return realPath.replace(/\//g, '-');
}

/**
 * True if `p` looks like an absolute path on any platform. Used to validate the
 * `cwd` read from .jsonl files: POSIX paths start with '/', Windows paths start
 * with a drive letter ('C:\...' / 'C:/...') or a UNC prefix ('\\server\share').
 */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

// Cache per evitare di rileggere lo stesso jsonl più volte nella stessa sessione.
const cwdCache = new Map<string, string>();

/** Invalida la cache del cwd dopo che il contenuto di una cartella è cambiato (es. merge). */
export function invalidateCwdCache(hash?: string): void {
  if (hash) cwdCache.delete(hash);
  else cwdCache.clear();
}

export function resolveRealPath(projectsDir: string, hash: string): string {
  const cached = cwdCache.get(hash);
  if (cached) return cached;

  const projectDir = join(projectsDir, hash);
  try {
    const files = readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const full = join(projectDir, f);
        return { full, mtime: statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    for (const { full } of files) {
      const cwd = readCwdFromJsonl(full);
      if (cwd) {
        cwdCache.set(hash, cwd);
        return cwd;
      }
    }
  } catch {
    // ignore, ricade nel fallback
  }

  return hashToPath(hash);
}

function readCwdFromJsonl(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line) continue;
      const idx = line.indexOf('"cwd"');
      if (idx === -1) continue;
      try {
        const obj = JSON.parse(line);
        if (typeof obj.cwd === 'string' && isAbsolutePath(obj.cwd)) return obj.cwd;
      } catch {
        // riga malformata, continua
      }
    }
  } catch {
    // file illeggibile
  }
  return null;
}
