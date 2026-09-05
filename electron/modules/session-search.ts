// Full-text search across every conversation on disk.
//
// ClaudeLens holds every transcript Claude Code has ever written and, until
// now, offered no way to ask *where* something happened: the search popover
// navigates (projects, sessions by title, skills, agents, MCP), it does not
// look inside. This module is the "look inside" half.
//
// ── Why there is no index ────────────────────────────────────────────────────
// The obvious design is an inverted index kept warm between queries. It is the
// wrong one here for a measurable reason: the expensive half of reading a
// transcript is not the I/O, it is `JSON.parse` per line — and that half can be
// skipped outright. A query's text, if it occurs in a message at all, occurs
// VERBATIM in the raw JSONL (Claude Code writes it with `JSON.stringify`, which
// leaves printable ASCII alone), so a raw substring test on the file's bytes
// rejects the vast majority of transcripts without parsing a single line. What
// is left to parse is only what actually matches. An index, by contrast, would
// have to hold the transcripts themselves — a 92 MB history in the main process
// for a feature the user reaches occasionally — and be invalidated on every
// append of every live session.
//
// The reject must never produce a FALSE NEGATIVE, and that is what
// `prefilterNeedle` is for: it hands back only the longest run of the query
// that is guaranteed to survive JSON encoding unchanged (no quote, no
// backslash, no control character, nothing outside printable ASCII, since a
// producer is free to write `é` as `é`). A query with no such run of
// usable length disables the reject for that call and every transcript is
// parsed — slower, never wrong. `searchStats()` reports how many files each
// path took.
//
// ── What is searched ─────────────────────────────────────────────────────────
// The user's prompts and the assistant's prose, through the SAME parse the
// transcript view uses (`parseChatSessionText`), so a hit is by construction a
// message the app is willing to render. Thinking blocks are opt-in; tool inputs
// and tool results are deliberately out (a `Read` result is the file's whole
// content, so including them would make every search a grep over the user's
// source tree, reported as if they had said it). Sidechain lines stay excluded,
// the same rule the transcript view applies to sub-agent traffic.
//
// ── What a hit promises ──────────────────────────────────────────────────────
// A hit names a message by `uuid`, never by position. The transcript view reads
// through the Agent SDK, which TRUNCATES at the compaction boundary, while this
// reads the file: a hit in pre-`/compact` history is real, on disk, and not
// something the view can scroll to. Carrying an index would have made that
// mismatch silent — an off-by-a-few jump to the wrong turn. With a uuid the
// renderer either finds the message or knows it cannot, and says so.

import { readFile, stat } from 'fs/promises';
import { basename, join } from 'path';
import { glob } from 'glob';
import { listProjectSessionFiles } from './session-files';
import { parseChatSessionText } from './session-reader';
import { readSessionTitle } from './transcript-tail';
import type { ChatMessage } from '../shared/chat-types';

/** Shortest query we will run. One character matches everything; two is already
 *  a deliberate act. */
export const MIN_QUERY_LENGTH = 2;
/** Longest query we accept. A prompt pasted whole is not a search. */
export const MAX_QUERY_LENGTH = 200;
/** Characters of context kept around a match on each side. */
const SNIPPET_RADIUS = 90;
/** Below this, a prefilter run is too common to reject anything — parse instead. */
const MIN_PREFILTER_RUN = 3;

export interface SearchRequest {
  text: string;
  /** Restrict to one project's history. Absent = every project. */
  projectHash?: string;
  /** Include assistant `thinking` blocks. Off by default: reasoning is verbose
   *  and rarely what someone is looking for. */
  includeThinking?: boolean;
  /** Cap on sessions returned. */
  maxSessions?: number;
  /** Cap on hits kept per session, so one long conversation can't fill the page. */
  maxHitsPerSession?: number;
}

export interface SearchHit {
  /** The message the match is in. The join key with whatever the view loaded —
   *  see the note on the compaction boundary above. */
  messageUuid: string;
  role: 'user' | 'assistant';
  /** Empty when the transcript line carried none. */
  timestamp: string;
  /** `thinking` marks a hit inside an assistant reasoning block. */
  kind: 'text' | 'thinking';
  /** Context around the match, with ellipses where it was cut. */
  snippet: string;
  /** Offset and length of the match INSIDE `snippet`, for highlighting. */
  matchStart: number;
  matchLength: number;
}

export interface SearchSessionResult {
  projectHash: string;
  /** The project's real cwd when it could be resolved; absent = unnamed rather
   *  than misnamed (the hash inversion is a guess — see `resolveRealPath`). */
  projectPath?: string;
  /** The transcript id, i.e. the filename without `.jsonl`. */
  sessionId: string;
  /** The conversation's own name (`/title` if set, else the generated one). */
  sessionTitle?: string;
  /** Last write to the transcript, epoch ms — what the results are ordered by. */
  mtime: number;
  /** Matches found in this session. `hits` may be shorter (see `maxHitsPerSession`). */
  hitCount: number;
  hits: SearchHit[];
}

export interface SearchOutcome {
  results: SearchSessionResult[];
  /** Transcripts considered. */
  scanned: number;
  /** Transcripts that survived the cheap reject and were parsed. */
  parsed: number;
  /** True when a cap stopped the scan: there are more matches than are shown. */
  truncated: boolean;
  /** Whether the raw substring reject was usable for this query at all. */
  prefiltered: boolean;
  elapsedMs: number;
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Escape a query for use as a literal inside a RegExp. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The longest run of `query` that a JSON encoder is guaranteed to write
 * verbatim, or `null` when none is long enough to be worth rejecting on.
 *
 * Only printable ASCII minus `"` and `\` qualifies. Everything else is excluded
 * not because it always gets escaped but because it MAY: `JSON.stringify`
 * leaves `é` alone, a different writer may emit `é`, and the reject has to
 * be right for both. Splitting on the unsafe characters instead of giving up on
 * the whole query keeps the reject alive for the common case of an accented
 * word inside an otherwise plain phrase.
 */
export function prefilterNeedle(query: string): string | null {
  let best = '';
  let run = '';
  for (const ch of query) {
    const code = ch.codePointAt(0) ?? 0;
    const safe = code >= 0x20 && code <= 0x7e && ch !== '"' && ch !== '\\';
    if (safe) {
      run += ch;
      if (run.length > best.length) best = run;
    } else {
      run = '';
    }
  }
  return best.length >= MIN_PREFILTER_RUN ? best : null;
}

/** One match: where it starts in the searched text, and how long it actually
 *  is — which is not always the needle's length, since a case-insensitive match
 *  can fold characters of different widths. Highlighting the needle's length
 *  instead would draw the box off the word. */
export interface Match {
  index: number;
  length: number;
}

/**
 * Matches of `needle` in `text`, case-insensitive. `matches` stops at `limit`;
 * `total` keeps counting to the end, because the caller shows a few hits and
 * has to say honestly how many there were.
 */
export function findMatches(
  text: string,
  needle: string,
  limit: number
): { matches: Match[]; total: number } {
  const matches: Match[] = [];
  let total = 0;
  if (!needle) return { matches, total };
  // A literal-escaped pattern with the `i` flag: the regex engine does the case
  // folding, so the offsets stay valid against the ORIGINAL string. Lowercasing
  // both sides and using indexOf would be cheaper and subtly wrong — a few
  // characters change length when folded, and every offset after one of them
  // would point a highlight at the wrong place.
  const re = new RegExp(escapeRegExp(needle), 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    total++;
    if (matches.length < limit) matches.push({ index: m.index, length: m[0].length });
    // A zero-length match is impossible for a non-empty literal, but advancing
    // defensively costs nothing and an infinite loop here would hang the main
    // process.
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return { matches, total };
}

/**
 * A window of `text` around the match, cut on word boundaries where one is
 * near, with the match's offset re-expressed against the window.
 */
export function makeSnippet(
  text: string,
  matchStart: number,
  matchLength: number,
  radius = SNIPPET_RADIUS
): { snippet: string; matchStart: number; matchLength: number } {
  // Collapse the runs of whitespace a transcript is full of (indented code, a
  // blank line between paragraphs) so a one-line snippet carries words rather
  // than layout. Done on the window, not the whole message, and the match is
  // re-found inside it so the offset can't drift.
  const from = Math.max(0, matchStart - radius);
  const to = Math.min(text.length, matchStart + matchLength + radius);
  const head = text.slice(from, matchStart).replace(/\s+/g, ' ');
  const match = text.slice(matchStart, matchStart + matchLength).replace(/\s+/g, ' ');
  const tail = text.slice(matchStart + matchLength, to).replace(/\s+/g, ' ');

  const prefix = from > 0 ? '…' : '';
  const suffix = to < text.length ? '…' : '';
  return {
    snippet: `${prefix}${head}${match}${tail}${suffix}`,
    matchStart: prefix.length + head.length,
    matchLength: match.length,
  };
}

/** The searchable text of a message, per block, with the block kind kept. */
function searchableBlocks(
  msg: ChatMessage,
  includeThinking: boolean
): { kind: 'text' | 'thinking'; text: string }[] {
  const out: { kind: 'text' | 'thinking'; text: string }[] = [];
  for (const b of msg.content) {
    if (b.type === 'text') out.push({ kind: 'text', text: b.text });
    else if (b.type === 'thinking' && includeThinking)
      out.push({ kind: 'thinking', text: b.thinking });
  }
  return out;
}

/**
 * Every match in a parsed transcript, newest-relevant order preserved (file
 * order). Pure, so the matching rules are testable without a filesystem.
 */
export function searchMessages(
  messages: ChatMessage[],
  needle: string,
  opts: { includeThinking?: boolean; maxHits?: number } = {}
): { hits: SearchHit[]; total: number } {
  const maxHits = opts.maxHits ?? 5;
  const hits: SearchHit[] = [];
  let total = 0;

  for (const msg of messages) {
    for (const block of searchableBlocks(msg, opts.includeThinking === true)) {
      // Only as many offsets as we will show, but the whole block is still
      // scanned: `total` is what tells the user the page is a sample, so it
      // cannot be the size of the sample.
      const remaining = Math.max(0, maxHits - hits.length);
      const { matches, total: blockTotal } = findMatches(block.text, needle, remaining);
      total += blockTotal;
      for (const match of matches) {
        const snip = makeSnippet(block.text, match.index, match.length);
        hits.push({
          messageUuid: msg.uuid,
          role: msg.role,
          timestamp: msg.timestamp,
          kind: block.kind,
          snippet: snip.snippet,
          matchStart: snip.matchStart,
          matchLength: snip.matchLength,
        });
      }
    }
  }

  return { hits, total };
}

// ── The scan ────────────────────────────────────────────────────────────────

export interface SearchStats {
  /** Transcripts considered. */
  scanned: number;
  /** Transcripts the reject let through, and which were therefore parsed. */
  parsed: number;
  /** Transcripts the raw substring test dismissed without parsing a line. */
  rejected: number;
}

let stats: SearchStats = { scanned: 0, parsed: 0, rejected: 0 };

/** Counters for the last completed search — the reject's hit rate is the one
 *  number that says whether this design is still holding. */
export function searchStats(): SearchStats {
  return { ...stats };
}

/** Module state, so a test can state its own starting point (the suite runs in
 *  randomised order). `searchSessions` resets these itself on entry. */
export function resetSearchStats(): void {
  stats = { scanned: 0, parsed: 0, rejected: 0 };
}

/** Normalize and validate a request's text. Throws on what we refuse to run. */
export function normalizeQuery(text: unknown): string {
  const q = typeof text === 'string' ? text.trim() : '';
  if (q.length < MIN_QUERY_LENGTH) {
    throw new Error(`Search needs at least ${MIN_QUERY_LENGTH} characters.`);
  }
  if (q.length > MAX_QUERY_LENGTH) {
    throw new Error(`Search is limited to ${MAX_QUERY_LENGTH} characters.`);
  }
  return q;
}

/**
 * Search every transcript under `projectsDir` (or one project's, with
 * `projectHash`).
 *
 * `resolveProjectPath` is injected rather than imported so this module stays
 * testable against a temporary directory — and so a project whose cwd is only a
 * lossy guess can be left unnamed by the caller that knows (`hasResolvedCwd`),
 * instead of being labelled with a path that was inferred from its folder name.
 */
export async function searchSessions(
  projectsDir: string,
  request: SearchRequest,
  resolveProjectPath?: (hash: string) => string | undefined
): Promise<SearchOutcome> {
  const startedAt = Date.now();
  const needle = normalizeQuery(request.text);
  const maxSessions = request.maxSessions ?? 60;
  const maxHitsPerSession = request.maxHitsPerSession ?? 5;

  const prefilter = prefilterNeedle(needle);
  const prefilterLower = prefilter?.toLowerCase() ?? null;

  stats = { scanned: 0, parsed: 0, rejected: 0 };

  const hashes = request.projectHash
    ? [request.projectHash]
    : (await glob('[!.]*', { cwd: projectsDir })).sort();

  // Every transcript of every project first, so the scan can run newest-first:
  // a cap that stops early must stop on the OLDEST conversations, not on
  // whichever project the glob happened to reach last.
  const candidates: { hash: string; file: string; mtime: number }[] = [];
  for (const hash of hashes) {
    let files: string[];
    try {
      files = await listProjectSessionFiles(join(projectsDir, hash));
    } catch {
      // A project folder that vanished mid-scan is one project's worth of
      // results missing, never the whole search failing.
      continue;
    }
    for (const file of files) {
      const mtime = await safeMtime(file);
      candidates.push({ hash, file, mtime });
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);

  const results: SearchSessionResult[] = [];
  let truncated = false;

  for (const candidate of candidates) {
    if (results.length >= maxSessions) {
      truncated = true;
      break;
    }
    stats.scanned++;

    let raw: string;
    try {
      raw = await readFile(candidate.file, 'utf-8');
    } catch {
      // Deleted, or a dataless iCloud placeholder: one transcript missing from
      // the results, not a failed search.
      continue;
    }

    // The cheap reject. `toLowerCase` on a multi-MB string allocates a copy, but
    // it is one pass over bytes against the per-line `JSON.parse` it replaces.
    if (prefilterLower && !raw.toLowerCase().includes(prefilterLower)) {
      stats.rejected++;
      continue;
    }

    stats.parsed++;
    const messages = parseChatSessionText(raw);
    const { hits, total } = searchMessages(messages, needle, {
      includeThinking: request.includeThinking,
      maxHits: maxHitsPerSession,
    });
    if (hits.length === 0) continue;

    const sessionId = basename(candidate.file).replace(/\.jsonl$/, '');
    results.push({
      projectHash: candidate.hash,
      projectPath: resolveProjectPath?.(candidate.hash),
      sessionId,
      sessionTitle: readSessionTitle(candidate.file)?.title,
      mtime: candidate.mtime,
      hitCount: total,
      hits,
    });
  }

  return {
    results,
    scanned: stats.scanned,
    parsed: stats.parsed,
    truncated,
    prefiltered: prefilter !== null,
    elapsedMs: Date.now() - startedAt,
  };
}

async function safeMtime(file: string): Promise<number> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    // Same rule as `resolveRealPath`: a file that vanished between the listing
    // and the stat is worth mtime 0, not the loss of the whole enumeration.
    return 0;
  }
}
