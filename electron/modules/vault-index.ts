// Resolving the `[[wikilinks]]` Claude writes in a conversation against the
// files the project actually has.
//
// ── What this is for ─────────────────────────────────────────────────────────
// Claude cites its sources in Obsidian's notation — "Fonte: [[Procedura Upload
// Tesi.pdf]] embeddato in fondo alla nota" — and the transcript renders that as
// text. Whether the file exists is precisely the thing the reader wants to know
// and the one thing the page never said: a citation of a note that is really on
// disk and a citation of a note Claude invented look identical. This module is
// the half that can tell them apart, and the chip in the renderer is the half
// that shows it. Opening the file is a by-product — once the link resolves to a
// real path, `shell.openPath` is one line.
//
// ── Why an index, and why it is not shipped to the renderer ──────────────────
// The renderer resolves the memory graph's wikilinks itself, for free, because
// `MemoryData.topics` already carries every topic's content across IPC
// (`src/components/project/memory/graph.ts`). A project directory has no such
// payload, and building one — every path under the root, shipped per chat view —
// would cost a megabyte on a large vault and force a cap, and a cap is what
// turns "this source does not exist" into "this source might not exist". So the
// index stays in the main process next to the fs and the renderer asks about the
// handful of targets one message actually cites. The answer is a name, not a
// listing.
//
// ── What a resolution promises ───────────────────────────────────────────────
// Exact key first, then a UNIQUE path-suffix match, then nothing. There is no
// "contains" fallback: the memory graph has one because it picks among ~30
// topics, where a partial match is nearly always the intended one; here the
// candidate set is a whole project tree, and a wrong hit is worse than a miss —
// it would claim a citation is sourced when it is not. Ambiguity resolves to a
// miss for the same reason, with one exception that mirrors how a vault is
// actually written: an extension-less `[[Nota]]` matching both `Nota.md` and
// `Nota.png` picks the markdown, because that is what the notation means.

import { existsSync, readdirSync, statSync } from 'fs';
import { basename, extname, isAbsolute, join, relative, sep } from 'path';
import { canonicalize } from '../utils';

/** A resolved link: `rel` is relative to the project root, `/`-separated. */
export interface VaultLinkHit {
  target: string;
  rel: string;
  /** `fuzzy` = matched on a path suffix, not on the whole name. */
  match: 'exact' | 'fuzzy';
}

/** An unresolved link: no file in the project answers to that name. */
export interface VaultLinkMiss {
  target: string;
  rel: null;
  match: null;
}

export type VaultLinkAnswer = VaultLinkHit | VaultLinkMiss;

/**
 * Directories a scan must not walk into. Dot-directories are skipped wholesale
 * (`.git`, `.obsidian`, `.claude`, …): nothing a note cites lives there, and
 * `.git` alone is usually larger than the tree around it. The rest are the
 * build and dependency dirs that make a scan of a code project unbounded.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-electron',
  'build',
  'out',
  'target',
  'vendor',
  'coverage',
  '__pycache__',
]);

/**
 * Caps on the walk. They exist so a root chosen by mistake (a home directory,
 * a mounted volume) cannot hang the main process — not to bound the answer:
 * a tree that hits them is one where the wikilinks are not what is wrong.
 */
const MAX_FILES = 60_000;
const MAX_DEPTH = 12;

/**
 * How long a built index is reused. A vault changes while the app is open —
 * Claude itself writes notes — and nothing watches a project root (the chokidar
 * watchers cover `~/.claude` and each project's `.claude/workflows`, not the
 * tree at large). A short TTL costs one cheap walk per half-minute of reading
 * and keeps a note created a moment ago from reading as missing for the rest of
 * the session, which is the failure that would matter.
 */
const INDEX_TTL_MS = 30_000;

/** Roots kept warm at once. A reader moves between a few projects, not many. */
const MAX_CACHED_ROOTS = 4;

interface VaultIndex {
  /** key → relative path, or `null` when two different files answer to it. */
  byKey: Map<string, string | null>;
  /** Same keys, kept in insertion order for the suffix pass. */
  keys: string[];
  fileCount: number;
  truncated: boolean;
  builtAt: number;
}

const cache = new Map<string, VaultIndex>();

/** Test seam: the cache is module-level state and the suite shuffles its order. */
export function resetVaultIndexCache(): void {
  cache.clear();
}

/**
 * The one normalization both sides of a match go through: case, separators and
 * surrounding space. `_` and spaces both fold to `-`, the same rule the memory
 * graph uses, because the same note is written `[[Sync Service]]` in one
 * sentence and `[[sync-service]]` in the next.
 */
function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Strips what Obsidian's notation carries besides the target: `[[Note#Heading]]`
 * points at a section of Note, `[[Note|alias]]` renames it on screen. Both are
 * the same file.
 */
export function wikiLinkTarget(raw: string): string {
  const noAlias = raw.split('|')[0] ?? '';
  const noHeading = noAlias.split('#')[0] ?? '';
  return noHeading.trim();
}

/** Registers one candidate under one key, marking a genuine collision. */
function addKey(candidates: Map<string, string[]>, key: string, rel: string): void {
  if (!key) return;
  const list = candidates.get(key);
  if (!list) candidates.set(key, [rel]);
  else if (!list.includes(rel)) list.push(rel);
}

function stripExt(p: string): string {
  const ext = extname(p);
  return ext ? p.slice(0, -ext.length) : p;
}

/** `readdirSync` with types, or null when the directory cannot be read. */
function readEntries(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

function walk(root: string): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  let truncated = false;

  const visit = (dir: string, depth: number): void => {
    if (truncated || depth > MAX_DEPTH) return;
    const entries = readEntries(dir);
    if (!entries) return; // unreadable directory: not an error, just nothing to index
    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const name = entry.name;
      if (name.startsWith('.')) continue;
      // Only real directories are descended into — a symlinked dir is skipped,
      // which is also what keeps a cycle from turning the walk into a loop.
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        visit(join(dir, name), depth + 1);
        if (truncated) return;
      } else if (entry.isFile()) {
        files.push(relative(root, join(dir, name)).split(sep).join('/'));
      }
    }
  };

  visit(root, 0);
  return { files, truncated };
}

function buildIndex(root: string): VaultIndex {
  const { files, truncated } = walk(root);
  const candidates = new Map<string, string[]>();

  for (const rel of files) {
    const base = basename(rel);
    addKey(candidates, normalizeKey(rel), rel);
    addKey(candidates, normalizeKey(stripExt(rel)), rel);
    addKey(candidates, normalizeKey(base), rel);
    addKey(candidates, normalizeKey(stripExt(base)), rel);
  }

  const byKey = new Map<string, string | null>();
  for (const [key, list] of candidates) {
    if (list.length === 1) {
      byKey.set(key, list[0]);
      continue;
    }
    // `[[Nota]]` next to `Nota.md` and `Nota.png` is not ambiguous in a vault —
    // the notation means the note. Anything else with two answers is a miss.
    const markdown = list.filter(rel => extname(rel).toLowerCase() === '.md');
    byKey.set(key, markdown.length === 1 ? markdown[0] : null);
  }

  return {
    byKey,
    keys: [...byKey.keys()],
    fileCount: files.length,
    truncated,
    builtAt: Date.now(),
  };
}

function indexFor(root: string): VaultIndex {
  const cached = cache.get(root);
  if (cached && Date.now() - cached.builtAt < INDEX_TTL_MS) return cached;
  const fresh = buildIndex(root);
  cache.set(root, fresh);
  if (cache.size > MAX_CACHED_ROOTS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined && oldest !== root) cache.delete(oldest);
  }
  return fresh;
}

/**
 * Resolves each `[[target]]` against the files under `root`.
 *
 * The root must be an existing directory; anything else answers all misses
 * rather than throwing, so a project whose directory has been moved renders as
 * "nothing resolves" instead of as an error banner over the transcript.
 */
export function resolveVaultLinks(root: string, targets: string[]): VaultLinkAnswer[] {
  const miss = (target: string): VaultLinkMiss => ({ target, rel: null, match: null });
  if (!root || targets.length === 0) return targets.map(miss);

  const realRoot = canonicalize(root);
  if (!existsSync(realRoot) || !statSync(realRoot).isDirectory()) return targets.map(miss);

  const index = indexFor(realRoot);

  return targets.map(target => {
    const key = normalizeKey(wikiLinkTarget(target));
    if (!key) return miss(target);

    const exact = index.byKey.get(key);
    if (exact) return { target, rel: exact, match: 'exact' as const };
    if (exact === null) return miss(target); // known, but two files answer to it

    // A citation may name a partial path — `[[Laurea/Procedura Upload Tesi]]`
    // for a file two directories down. Accept it only when one key ends there.
    const suffix = `/${key}`;
    const hits = index.keys.filter(k => k.endsWith(suffix) && index.byKey.get(k));
    if (hits.length !== 1) return miss(target);
    const rel = index.byKey.get(hits[0]);
    return rel ? { target, rel, match: 'fuzzy' as const } : miss(target);
  });
}

/**
 * Turns a resolved `rel` back into an absolute path, or throws.
 *
 * The renderer only ever sends back a `rel` this module handed it, but the
 * check is made here again rather than trusted: containment is asserted after
 * canonicalization, so neither a `..` nor a symlink planted inside the tree can
 * make an in-bounds-looking path open something outside the project. Lives in
 * this module, not at the IPC handler, so the rule is covered by the same unit
 * tests as the resolution.
 */
export function resolveVaultFile(root: string, rel: string): string {
  if (!root) throw new Error('Missing project root');
  if (!rel) throw new Error('Missing file path');
  if (isAbsolute(rel)) throw new Error('Path must be relative to the project');
  const base = canonicalize(root);
  const target = canonicalize(join(base, rel));
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error('Path must be under the project directory');
  }
  if (!existsSync(target) || !statSync(target).isFile()) throw new Error('File not found');
  return target;
}

/** Diagnostics for the tests and for a future "index is huge" warning. */
export function vaultIndexStats(root: string): { fileCount: number; truncated: boolean } | null {
  const index = cache.get(canonicalize(root));
  return index ? { fileCount: index.fileCount, truncated: index.truncated } : null;
}
