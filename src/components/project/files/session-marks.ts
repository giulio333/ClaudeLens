import type { TouchedFile } from '../chat/utils';

/** What a session did to a file, as the explorer marks it. A deleted file is
 *  not in the tree, so it only ever reaches a folder, as an edit. */
export type FileMark = 'read' | 'edited' | 'created';

export interface SessionMarks {
  /** By path relative to the project root, `/`-separated. */
  files: Map<string, FileMark>;
  /** Every folder above a marked file, carrying its strongest mark — a closed
   *  folder is where the reader decides whether to look inside. */
  dirs: Map<string, FileMark>;
  /** Calls that wrote the file. A count that moves is the file changing under
   *  the viewer, which keys its re-read. */
  writes: Map<string, number>;
}

const RANK: Record<FileMark, number> = { read: 0, edited: 1, created: 2 };

function stronger(a: FileMark | undefined, b: FileMark): FileMark {
  return a && RANK[a] >= RANK[b] ? a : b;
}

const slashes = (p: string) => p.replace(/\\/g, '/');

/**
 * `path` relative to `root`, or null when it is not under it. A relative path
 * is taken as the tool wrote it, against the root; an absolute one must start
 * with the root. No canonicalization here — the renderer has no filesystem —
 * so a path written through a symlinked alias of the root is missed, which
 * costs a mark and never puts one on the wrong file.
 */
export function relToRoot(path: string, root: string): string | null {
  const p = slashes(path);
  const r = slashes(root).replace(/\/+$/, '');
  const absolute = p.startsWith('/') || /^[A-Za-z]:\//.test(p);
  const rel = absolute ? (p.startsWith(r + '/') ? p.slice(r.length + 1) : null) : p;
  if (!rel) return null;
  const parts = rel.split('/').filter(s => s && s !== '.');
  if (parts.includes('..') || parts.length === 0) return null;
  return parts.join('/');
}

/**
 * The explorer's marks for the files one session touched, under `root`.
 * `touched` is the file tools and the shell edits (`touchedFiles`); `shellReads`
 * the files shell commands read (`contextFiles`, the Lens rail's own reader),
 * which `touchedFiles` does not see and which outnumber `Read` calls by far.
 * A shell read is the weakest mark, so an edit of the same file still wins.
 */
export function sessionMarks(
  touched: TouchedFile[],
  root: string,
  shellReads: Iterable<string> = []
): SessionMarks {
  const files = new Map<string, FileMark>();
  const dirs = new Map<string, FileMark>();
  const writes = new Map<string, number>();
  const markDirs = (rel: string, mark: FileMark) => {
    const parts = rel.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      dirs.set(dir, stronger(dirs.get(dir), mark));
    }
  };
  for (const path of shellReads) {
    const rel = relToRoot(path, root);
    if (!rel) continue;
    files.set(rel, stronger(files.get(rel), 'read'));
    markDirs(rel, 'read');
  }
  for (const t of touched) {
    const rel = relToRoot(t.path, root);
    if (!rel) continue;
    const mark: FileMark = t.action === 'deleted' ? 'edited' : t.action;
    // A deleted file is not in the tree, whatever was done to it before.
    if (t.action === 'deleted') files.delete(rel);
    else files.set(rel, stronger(files.get(rel), mark));
    const writeCalls = t.sources.filter(s => s.kind === 'bash' || s.group.use.name !== 'Read');
    if (writeCalls.length) writes.set(rel, writeCalls.length);
    markDirs(rel, mark);
  }
  return { files, dirs, writes };
}
