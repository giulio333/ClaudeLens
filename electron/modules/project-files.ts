// The project file explorer's two reads: one directory level, and one file as
// text.
//
// ── What this is for ─────────────────────────────────────────────────────────
// The app showed a project's files only through what Claude did to them — a
// Read, an Edit, a diff under a turn. The explorer lets the reader look at the
// tree itself, read-only: this module lists and reads, and nothing here writes,
// renames or deletes.
//
// ── Why one level at a time ──────────────────────────────────────────────────
// A whole-tree payload is what `vault-index.ts` refuses to ship for the same
// reason: a megabyte per project on a large one, and a cap that then has to be
// explained. The tree is expanded by the reader, so it is read the same way —
// a folder when it is opened, never the ones nobody looks at.
//
// ── The fences ───────────────────────────────────────────────────────────────
// The root itself is a renderer-supplied path, so the IPC handlers first ask
// `createProjectRootGuard` whether it is a project the registry knows: proving
// `rel` stays under a root proves nothing when the root is the home directory.
// Both reads then go through `containedPath`, the check `vault:openFile` already
// makes: canonicalized, so neither a `..` nor a symlink planted in the tree
// reaches outside the project. A listed symlink whose target is outside is
// dropped from the listing rather than shown and refused on click. What is
// hidden is `.git` and the build/dependency dirs `vault-index` already skips;
// other dot-directories stay, because `.claude/` is exactly what a reader of a
// Claude Code project wants to see. `.gitignore` is not read: honouring it
// needs git or a parser, and the skip list covers the dirs that make a tree
// unreadable.
//
// A file comes back as text only when it is text — a NUL byte in its head
// makes it `binary` — and below a byte cap, since it crosses IPC as one string
// and is drawn row by row.

import { promises as fsp } from 'fs';
import type { Dirent } from 'fs';
import { extname, join, relative, sep } from 'path';
import { canonicalize } from '../utils';
import { containedPath, SKIP_DIRS } from './vault-index';
import type {
  ProjectDirEntry,
  ProjectDirListing,
  ProjectFileAnswer,
} from '../shared/project-files-types';

/** Entries one listing carries. A folder past it is a generated one. */
export const MAX_DIR_ENTRIES = 2000;

/** Above this a file is `too-large`: rows past it are a renderer stall. */
export const MAX_TEXT_BYTES = 1024 * 1024;

/** How much of the head is sniffed for a NUL byte. */
const SNIFF_BYTES = 8192;

function isHiddenDir(name: string): boolean {
  return name === '.git' || SKIP_DIRS.has(name);
}

/** What the OS leaves in a folder: nobody wrote these, and nobody reads them. */
const OS_LITTER = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', 'Icon\r']);

/** `abs` as a `/`-separated path relative to `base`, the form the renderer keys on. */
function toRel(base: string, abs: string): string {
  return relative(base, abs).split(sep).join('/');
}

function within(base: string, target: string): boolean {
  return target === base || target.startsWith(base + sep);
}

/**
 * An entry's kind, or null when it is not listed: hidden, a socket or a device,
 * a dangling link, or a link out of the root. Only a symlink costs a stat here
 * — a plain entry's kind is on its `Dirent`, so a huge folder is sorted and cut
 * before anything is stat'ed for its size.
 */
async function kindOf(base: string, abs: string, dirent: Dirent): Promise<'dir' | 'file' | null> {
  let kind: 'dir' | 'file' | null = null;
  if (dirent.isSymbolicLink()) {
    if (!within(base, canonicalize(abs))) return null;
    try {
      const st = await fsp.stat(abs);
      kind = st.isDirectory() ? 'dir' : st.isFile() ? 'file' : null;
    } catch {
      return null; // a dangling link
    }
  } else if (dirent.isDirectory()) kind = 'dir';
  else if (dirent.isFile()) kind = 'file';
  if (kind === 'dir' && isHiddenDir(dirent.name)) return null;
  if (kind === 'file' && OS_LITTER.has(dirent.name)) return null;
  return kind;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The entries of `rel` (`''` is the root): folders first, then by name. */
export async function listProjectDir(root: string, rel: string): Promise<ProjectDirListing> {
  const base = canonicalize(root);
  const dir = containedPath(root, rel);
  const dirents = await fsp.readdir(dir, { withFileTypes: true });
  const kinds = await Promise.all(dirents.map(d => kindOf(base, join(dir, d.name), d)));
  const listed = dirents
    .map((d, i) => ({ name: d.name, kind: kinds[i] }))
    .filter((e): e is { name: string; kind: 'dir' | 'file' } => e.kind !== null)
    .sort((a, b) =>
      a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : collator.compare(a.name, b.name)
    );
  const kept = listed.slice(0, MAX_DIR_ENTRIES);
  const entries = await Promise.all(
    kept.map(async ({ name, kind }): Promise<ProjectDirEntry> => {
      const abs = join(dir, name);
      const entry: ProjectDirEntry = {
        name,
        rel: toRel(base, abs),
        kind,
        ext: kind === 'file' ? extname(name).slice(1).toLowerCase() : '',
      };
      if (kind === 'file') {
        try {
          entry.size = (await fsp.stat(abs)).size;
        } catch {
          // Gone between the listing and the stat: listed without a size.
        }
      }
      return entry;
    })
  );
  return { entries, truncated: listed.length > MAX_DIR_ENTRIES };
}

/**
 * The fence on the root itself. `listProjectDir`/`readProjectFile` prove that
 * `rel` stays under `root`, and `root` comes from the renderer: without this a
 * root of the home directory reads `.ssh/id_rsa` as text. So the root must be
 * a project the registry knows — the rule the entity writers apply to a
 * renderer-supplied project path (`assertKnownProjectPath`, #256). The
 * registry walk reads a transcript head per project, so its answer is kept for
 * `ttlMs`, and a miss looks again (a project opened a moment ago) at most once
 * every `retryMs`.
 */
export function createProjectRootGuard(
  discover: () => string[],
  { ttlMs = 30_000, retryMs = 2_000, now = Date.now } = {}
): (root: string) => void {
  let known: ReadonlySet<string> = new Set();
  let at = -Infinity;
  return root => {
    const age = now() - at;
    if (age >= ttlMs || (!known.has(root) && age >= retryMs)) {
      known = new Set(discover());
      at = now();
    }
    if (typeof root !== 'string' || !known.has(root)) {
      throw new Error(`Unknown project path "${root}".`);
    }
  };
}

/** The file at `rel` as text, or the reason it is not shown as text. */
export async function readProjectFile(root: string, rel: string): Promise<ProjectFileAnswer> {
  if (!rel) return { status: 'refused', reason: 'not a file' };
  let path: string;
  try {
    path = containedPath(root, rel);
  } catch (e) {
    return { status: 'refused', reason: (e as Error).message };
  }
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(path, 'r');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'missing' };
    return { status: 'refused', reason: code ?? 'unreadable' };
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return { status: 'refused', reason: 'not a file' };
    if (stat.size > MAX_TEXT_BYTES) return { status: 'too-large', bytes: stat.size };
    const head = Buffer.alloc(Math.min(SNIFF_BYTES, stat.size));
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    if (head.subarray(0, bytesRead).includes(0)) return { status: 'binary', bytes: stat.size };
    const bytes = await handle.readFile();
    return { status: 'ok', text: bytes.toString('utf-8'), bytes: bytes.length };
  } finally {
    await handle.close();
  }
}
