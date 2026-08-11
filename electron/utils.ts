import {
  readdirSync,
  readFileSync,
  statSync,
  realpathSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
} from 'fs';
import { dirname, join, resolve, sep } from 'path';
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
 * Resolve the canonical (symlink-followed) path of `p`. The path itself may not
 * exist yet (we're about to create it), so we realpath the deepest existing
 * ancestor and re-append the not-yet-existing tail. This makes containment
 * checks immune to a planted symlink in the middle of the path.
 */
export function canonicalize(p: string): string {
  let cur = resolve(p);
  const tail: string[] = [];
  // Walk up until we hit a path that exists, collecting the trailing segments.
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break; // reached the root
    tail.unshift(cur.slice(parent.length + 1));
    cur = parent;
  }
  try {
    const realBase = realpathSync(cur);
    return tail.length ? join(realBase, ...tail) : realBase;
  } catch {
    return resolve(p);
  }
}

/**
 * Defense in depth: assert a built target path stays inside `baseDir` after
 * resolution. Throws otherwise. Pair with validateEntityName at write sites.
 *
 * Both the base and the target are canonicalized (symlinks resolved) before the
 * containment check, so a symlink planted inside the supposedly-confined tree
 * can't redirect the real write/delete target outside it.
 */
export function assertWithin(baseDir: string, target: string): void {
  const base = canonicalize(baseDir);
  const resolved = canonicalize(target);
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error(`Refusing to write outside ${base}: ${resolve(target)}`);
  }
}

// Claude Code session ids are UUIDs. Validate before interpolating an id into a
// shell command (resume/attach) so metacharacters can't break out.
const SESSION_ID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

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

/**
 * True quando il cwd autoritativo di `hash` è già stato letto da un transcript.
 *
 * La cache è popolata SOLO da una lettura riuscita: il fallback lossy di
 * `hashToPath` non viene mai memorizzato, quindi "in cache" significa
 * esattamente "risolto dal disco, non stimato dal nome cartella". È il segnale
 * che serve a chi osserva il registry per capire se su un progetto c'è ancora
 * qualcosa da imparare.
 */
export function hasResolvedCwd(hash: string): boolean {
  return cwdCache.has(hash);
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

// Il `cwd` sta nel primo record `user` del transcript, che nella pratica cade
// entro i primi KB: leggere l'intero .jsonl per estrarlo costa quanto il file
// (misurato: 6 MB -> 15 ms e +12 MB di heap transitorio per la stringa e lo
// split, per progetto, in sincrono sul main process all'avvio). Leggiamo prima
// una testa di 64 KB; il file intero resta il fallback perché quel primo record
// può essere enorme (un messaggio utente con un incolla grosso) e portare il
// `cwd` oltre il chunk — nel campione locale ~5% dei transcript, worst case
// 1,4 MB. Senza fallback quei progetti ricadrebbero sul lossy `hashToPath`.
const CWD_HEAD_BYTES = 64 * 1024;

function findCwdInJsonl(content: string): string | null {
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
  return null;
}

function readCwdFromJsonl(filePath: string): string | null {
  let fd: number | undefined;
  let readWholeFile = false;
  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(CWD_HEAD_BYTES);
    const n = readSync(fd, buf, 0, CWD_HEAD_BYTES, 0);
    readWholeFile = n < CWD_HEAD_BYTES;
    const chunk = buf.subarray(0, n).toString('utf-8');
    // Se il chunk non è tutto il file l'ultima riga è troncata a metà: scartarla
    // evita un JSON.parse fallito su un record in realtà valido. Tagliare
    // sull'ultimo '\n' scarta anche l'eventuale carattere UTF-8 spezzato dal
    // confine del buffer ('\n' non compare mai dentro una sequenza multi-byte).
    const complete = readWholeFile ? chunk : chunk.slice(0, chunk.lastIndexOf('\n') + 1);
    const fromHead = findCwdInJsonl(complete);
    if (fromHead) return fromHead;
  } catch {
    // testa illeggibile: ritenta con la lettura piena, che ha il suo catch
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // il descrittore resta chiuso dal GC, non c'è recupero utile
      }
    }
  }

  // La testa era già tutto il file: rileggerlo non troverebbe nulla di nuovo.
  if (readWholeFile) return null;

  try {
    return findCwdInJsonl(readFileSync(filePath, 'utf-8'));
  } catch {
    // file illeggibile
  }
  return null;
}

/**
 * Locate the Agent SDK's native CLI binary when running from a packaged app.
 *
 * The SDK resolves its platform binary (`@anthropic-ai/claude-agent-sdk-
 * {platform}-{arch}/claude`) relative to its own module path — inside an
 * Electron package that lands in `app.asar`, which is a *file*, so the SDK's
 * `child_process.spawn` fails with ENOTDIR (Electron does not rewrite spawn
 * paths into the asar). electron-builder ships the binary outside the archive
 * (`asarUnpack`); this returns that `app.asar.unpacked` path to pass as
 * `pathToClaudeCodeExecutable`. Returns undefined in dev (real node_modules on
 * disk), where the SDK's own resolution — including musl detection — works.
 */
export function resolveClaudeExecutablePath(): string | undefined {
  try {
    const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
    const pkgJson = require.resolve(`${pkg}/package.json`);
    if (!pkgJson.includes(`app.asar${sep}`)) return undefined;
    const binary = process.platform === 'win32' ? 'claude.exe' : 'claude';
    return join(dirname(pkgJson), binary).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
  } catch {
    return undefined;
  }
}

// Framing tags Claude Code wraps around technical/system content in transcripts.
// We strip these (rather than any `<...>`) so prose containing code or generics —
// `if (a < b && c > d)`, `List<String>` — survives intact (issue #93).
const FRAMING_TAGS = [
  'command-name',
  'command-message',
  'command-args',
  'command-contents',
  'local-command-stdout',
  'local-command-stderr',
  'local-command-caveat',
  'system-reminder',
].join('|');

const FRAMING_TAG_RE = new RegExp(`<\\/?(?:${FRAMING_TAGS})\\b[^>]*>`, 'gi');

/**
 * Remove only the known Claude Code framing tags from a transcript string,
 * leaving user prose (including `<`/`>` from code) untouched.
 */
export function stripFramingTags(text: string): string {
  return text.replace(FRAMING_TAG_RE, '');
}
