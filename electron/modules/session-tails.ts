import { basename, join } from 'path';
import { statSync } from 'fs';
import { glob } from 'glob';
import { CLAUDE_DIR } from '../utils';
import { readAppend, readSessionTitle, type LiveEvent, type TurnUsage } from './transcript-tail';
import { costOfUsage, isModelPriced, readSessionSpend } from './cost-tracker';
import { contextWindowFor } from '../shared/context-window';
import type { ActiveSession } from './sessions-registry-reader';

// What every live session is doing right now, for the Monitor.
//
// The registry (`~/.claude/sessions/<pid>.json`) says a session is `busy` or
// `waiting`; it never says at what. That only exists in the transcript, so this
// module keeps one append-cursor per live session and folds the events into a
// small digest per session.
//
// Two costs are deliberately avoided:
//
//  - No watcher of its own. The main process already watches PROJECTS_DIR
//    recursively, so `onTranscriptChanged` is called with every append of every
//    project and starts with an O(1) Map lookup — a project nobody is running
//    costs one failed lookup, not a read.
//  - No event stream over IPC. However fast a session writes, the renderer
//    receives a digest array, so a tool-heavy turn cannot flood it.
//
// The digest is what the tail OBSERVED, never a guess: a session whose
// transcript has not been written yet reports `activity: null` rather than
// "idle", which would claim knowledge the module does not have.

export interface ToolRef {
  name: string;
  /** Short human-readable argument ("npm test", "…/src/main.ts"); '' when the
   *  tool takes nothing worth showing on one line. */
  arg: string;
}

/** One mark on a session's activity trace. Tool RESULTS are deliberately not
 *  marked: they pair with the call that already has a mark and would double
 *  every action on the track. */
export type TraceKind = 'tool' | 'text';

export interface TraceMark {
  at: number;
  kind: TraceKind;
  /** The tool this mark is, and the one-line subject it acted on — the same pair
   *  `lastTool` carries, kept for every action instead of only the current one.
   *  It is what lets the Monitor print what a session DID (`Edit
   *  MonitorView.tsx`, `Bash npm run typecheck`) rather than a row of anonymous
   *  bars. Both absent on a `text` mark: prose has no name and no subject. */
  tool?: string;
  arg?: string;
  /** The call's `tool_use` id. Carried only so its result can find it again (see
   *  `failed`); nothing renders it. */
  id?: string;
  /** Set when this call's result came back an error.
   *
   *  A failure is an attribute of the call, not a second event: marking the
   *  result too drew two ticks for one action and overstated the rhythm — the
   *  one thing the track exists to measure. The cost of that choice is explicit:
   *  a call whose result arrives after it has aged out of the window cannot be
   *  flagged, and only `errorCount` still knows about it. */
  failed?: boolean;
}

/** A sub-agent this session dispatched and has not seen finish.
 *
 *  Worth its own field because a delegating session is INVISIBLE in its own
 *  transcript: the agent's work goes to `{sessionId}/subagents/agent-*.jsonl`
 *  (sidechain lines `parseJsonlLine` drops), so the parent file gets the
 *  dispatch and then nothing. Measured on a real run: 148 seconds of silence
 *  while the sub-agent made 31 tool calls. Worse, the `Agent` tool is
 *  asynchronous — its result is an immediate "Async agent launched" ack and the
 *  assistant then closes the turn with `end_turn` — so the tail alone concludes
 *  the session is idle and the Monitor said "waiting for your next prompt"
 *  about a session that was working. Keeping the open dispatch is what lets the
 *  cell say WHO it is waiting on instead of guessing.
 *
 *  Deliberately no counters: the sub-agent's own tool tally belongs to the
 *  sub-agent, and mixing it into the parent's would make one session's numbers
 *  answer for two.
 */
export interface DelegateRef {
  /** The dispatch's `tool_use` id — the key its finish notification arrives on. */
  id: string;
  /** The `subagent_type` of the dispatch ("Explore"), the only place the agent's
   *  kind is written: the sidecar transcript carries a codename slug instead. */
  name: string;
  /** Epoch ms of the dispatch. */
  at: number;
}

/** Tools that hand work to a sub-agent. */
const AGENT_TOOLS = new Set(['Agent', 'Task']);

/** The `tool_result` of an async dispatch is an acknowledgement that the agent
 *  STARTED, not that it finished — pairing on the id alone would close the
 *  delegate 31 ms after opening it. */
const ASYNC_LAUNCH_ACK = 'Async agent launched';

function openDelegate(list: DelegateRef[], event: LiveEvent, at: number | null): DelegateRef[] {
  const id = event.toolUseId;
  if (!id || list.some(d => d.id === id)) return list;
  const type = event.toolInput?.subagent_type;
  const name = typeof type === 'string' && type.trim() ? type.trim() : 'an agent';
  return [...list, { id, name, at: at ?? 0 }];
}

function closeDelegate(list: DelegateRef[], id: string | undefined): DelegateRef[] {
  if (!id || !list.length) return list;
  const next = list.filter(d => d.id !== id);
  return next.length === list.length ? list : next;
}

/** How much history a trace keeps. Wider than the window the Monitor draws, so
 *  the strip stays full while a session is quiet instead of emptying from the
 *  left. */
export const TRACE_WINDOW_MS = 150_000;
const TRACE_MAX_MARKS = 160;

export interface SessionActivity {
  sessionId: string;
  /** The title Claude wrote for this conversation (`ai-title` in the
   *  transcript), null until one has been seen. It is the only human name a
   *  session has: the registry's `name` is the project plus two random
   *  characters, so two sessions of one project were told apart by pid alone. */
  title: string | null;
  /** Copied from the registry entry while the session is live. Kept after it
   *  ends because the registry file is gone by then, and a finished cell still
   *  has to say which project it belonged to. */
  cwd: string | null;
  /** Stamped marks of what this session did recently — the data behind the
   *  Monitor's pulse strip. It is the only field that answers "at what RHYTHM is
   *  it working", which is what separates a session mid-tool from a stuck one. */
  recent: TraceMark[];
  /** Absolute path of the tailed transcript; null while it does not exist yet
   *  (the registry file is written at startup, the project dir only at the
   *  first message — a brand-new session is live with nothing on disk). */
  transcriptPath: string | null;
  /** Last state the transcript implied: 'thinking' | 'busy' | 'idle'. Null when
   *  nothing has been read for this session yet. */
  activity: string | null;
  lastTool: ToolRef | null;
  /** Sub-agents dispatched and not yet seen finishing — see `DelegateRef`. */
  delegates: DelegateRef[];
  /** Epoch ms of the last line read. Unlike the registry's `updatedAt` this IS
   *  an activity stamp: it moves with every append. */
  lastActivityAt: number | null;
  toolCount: number;
  errorCount: number;
  model: string | null;
  /** How full the context window is, from the newest assistant turn's prompt.
   *
   *  A LEVEL, not a total: only the latest reading means anything, which is why
   *  it is one object replaced each turn rather than something accumulated. It is
   *  the one fact on this page that is only actionable while the session runs —
   *  a session at 94% is about to compact, and afterwards nobody can tell it
   *  ever was. Null until an assistant turn with usage has been read. */
  context: { used: number; max: number } | null;
  /** Dollars this session has billed. Seeded once from a full (cached) parse of
   *  the transcript, because the tail starts at EOF and a money figure that
   *  silently covers only the last few turns is worse than none. Null until
   *  either the seed or the first priced turn lands. */
  spend: number | null;
  /** True when `spend` was priced through the fuzzy family fallback rather than
   *  an exact table entry — the UI marks those as approximate instead of
   *  quoting a figure it cannot stand behind. */
  spendEstimated: boolean;
  /** Every token this session has billed, all four kinds. */
  tokens: number;
  /** Epoch ms at which the session left the registry; null while it is live.
   *  Retained briefly so the Monitor can show what just finished — a session
   *  that ends the moment you look away would otherwise leave no trace. */
  endedAt: number | null;
}

interface Cursor extends SessionActivity {
  offset: number;
  /** This cursor started at EOF, so the transcript's existing spend is still
   *  behind it — see `seedSpend`. Cursor-only state, stripped before the digest
   *  leaves for the renderer. */
  needsSeed: boolean;
  /** Identities of the turns already billed, so the several lines one turn is
   *  written as are counted once — see `dropRepeats`. Cursor-only for the same
   *  reason as the two above: it is bookkeeping about the read, not something
   *  the digest says about the session. */
  seenUsage: string[];
}

const cursors = new Map<string, Cursor>(); // keyed by sessionId
const byPath = new Map<string, string>(); // transcript path → sessionId
const ended = new Map<string, Cursor>(); // recently gone, pruned by age

/** How long a finished session stays in the digest. Long enough to notice a run
 *  that ended while you were in another window, short enough that the Monitor
 *  keeps meaning "now". */
export const RECENT_WINDOW_MS = 10 * 60_000;

/**
 * Forget the finished sessions that have aged out of the retention window.
 *
 * Called from the READ and not only from `syncSessionTails`, because that sync
 * runs on a registry event and the registry has no heartbeat: it is rewritten on
 * status transitions only. When the last session ends — or the ones left are all
 * parked in `waiting` — no further event arrives, so an expiry that waits for one
 * never happens, and the Monitor keeps a card reading "3h ago" on a page whose
 * whole subject is the last few minutes. Pruning where the digest is read makes
 * the window hold whatever wakes the module.
 */
function pruneEnded(now: number): void {
  for (const [sessionId, cursor] of ended) {
    if (now - (cursor.endedAt ?? 0) > RECENT_WINDOW_MS) ended.delete(sessionId);
  }
}

function projectsDir(): string {
  return join(CLAUDE_DIR, 'projects');
}

/** Session ids come from a file name written by another process: keep them to
 *  the UUID alphabet before they reach a glob pattern or a path join. */
function isSafeSessionId(id: string): boolean {
  return /^[a-zA-Z0-9-]+$/.test(id) && id.length > 0;
}

function emptyActivity(sessionId: string): Cursor {
  return {
    sessionId,
    title: null,
    cwd: null,
    recent: [],
    transcriptPath: null,
    activity: null,
    lastTool: null,
    delegates: [],
    lastActivityAt: null,
    toolCount: 0,
    errorCount: 0,
    model: null,
    context: null,
    spend: null,
    spendEstimated: false,
    tokens: 0,
    endedAt: null,
    offset: 0,
    needsSeed: false,
    seenUsage: [],
  };
}

/**
 * The one-line argument of a tool call.
 *
 * Deliberately a small allow-list rather than a generic JSON dump: the Monitor
 * row has one line, and `{"file_path":"/Users/…/very/long/path.ts","offset":…}`
 * spends it saying nothing. A tool whose input has no obvious subject gets '' —
 * the tool name alone is then the honest answer.
 */
export function toolArg(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  const path = input.file_path ?? input.path ?? input.notebook_path;
  if (typeof path === 'string' && path) {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return (parts.length > 2 ? '…/' : '') + parts.slice(-2).join('/');
  }
  for (const key of ['command', 'pattern', 'query', 'prompt', 'description', 'url']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      const flat = value.replace(/\s+/g, ' ').trim();
      return flat.length > 64 ? flat.slice(0, 63) + '…' : flat;
    }
  }
  return '';
}

/**
 * How many turn identities the fold remembers, so a turn written as several
 * lines is billed once (see `dropRepeats`).
 *
 * A fixed window rather than the whole set `cost-tracker` keeps: that one is
 * bounded by a file it parses and then forgets, while a cursor here lives as
 * long as the session does, and one entry per turn ever made is memory that only
 * grows. Sixteen is three times the widest turn measured (5 lines) and the
 * repeats are contiguous — over 11 real transcripts, 500 multi-line turns, not
 * one was interleaved with another's lines.
 */
const USAGE_MEMORY = 16;

/**
 * Drop the turns this cursor has already billed.
 *
 * Claude Code writes one JSONL line per content block of an assistant turn and
 * each line repeats the same message-level usage — so `readAppend` hands up two
 * to five entries for one turn, and summing them bills it as many times. It cost
 * the Monitor 1.86× the tokens the project views quote for the same transcript,
 * and the same figure could not be wrong in both places: `cost-tracker` has
 * deduped on this identity since issue #56, and the tail's whole claim to price
 * a turn is that it uses that module's table on that module's terms.
 *
 * `seen` is caller-owned and mutated in place, like the offset the caller
 * advances: the repeated lines can straddle two appends, so the memory has to
 * outlive the batch, and it must not travel to the renderer with the digest.
 */
function dropRepeats(turns: TurnUsage[], seen: string[]): TurnUsage[] {
  return turns.filter(turn => {
    // No id at all: the entry is the only identity there is, so it is its own turn.
    if (!turn.usageKey) return true;
    if (seen.includes(turn.usageKey)) return false;
    seen.push(turn.usageKey);
    if (seen.length > USAGE_MEMORY) seen.splice(0, seen.length - USAGE_MEMORY);
    return true;
  });
}

/**
 * Fold one append's assistant turns into the digest's two derived figures.
 *
 * They are different KINDS of quantity and are treated as such: the context is a
 * level, so only the newest turn's prompt counts and each reading replaces the
 * last; the spend and the token tally are totals, so every turn adds to them.
 * Reading the prompt as a total (or the bill as a level) is the mistake this
 * split exists to make impossible.
 *
 * It is also why a repeated line is dropped BEFORE either figure is touched
 * rather than only before the totals: the level is unharmed by the repeats (they
 * carry the same prompt), so an append that turns out to be nothing but repeats
 * has nothing new to say about the session at all.
 *
 * Each turn is priced with ITS OWN model and timestamp, not the session's: a
 * `/model` switch mid-session is real, and so is a model whose published rate
 * changed on a date the session straddles.
 */
function foldTurns(prev: SessionActivity, allTurns: TurnUsage[], seen: string[]): SessionActivity {
  const turns = dropRepeats(allTurns, seen);
  if (!turns.length) return prev;

  let spend = prev.spend ?? 0;
  let tokens = prev.tokens;
  let estimated = prev.spendEstimated;

  for (const turn of turns) {
    const model = turn.model ?? prev.model ?? undefined;
    spend += costOfUsage(turn, model, turn.at ? new Date(turn.at).toISOString() : undefined);
    tokens += turn.inputTokens + turn.outputTokens + turn.cacheWriteTokens + turn.cacheReadTokens;
    if (!isModelPriced(model)) estimated = true;
  }

  const last = turns[turns.length - 1];
  const used = last.inputTokens + last.cacheReadTokens + last.cacheWriteTokens;
  return {
    ...prev,
    spend,
    tokens,
    spendEstimated: estimated,
    context: { used, max: contextWindowFor(last.model ?? prev.model ?? undefined, used) },
  };
}

/**
 * Fold tail events into the running digest. Pure: the caller owns the state,
 * `seen` included — it is the memory that lets a turn split across two appends
 * be billed once (see `dropRepeats`). Omitting it dedupes within the batch only,
 * which is what a caller with no cursor of its own can honestly offer.
 *
 * Order matters — a batch usually ends with the event that best describes the
 * session (the tool it just started), so later events win over earlier ones.
 */
export function foldEvents(
  prev: SessionActivity,
  events: LiveEvent[],
  turns: TurnUsage[] = [],
  seen: string[] = []
): SessionActivity {
  let next = foldTurns(prev, turns, seen);
  const marks = [...prev.recent];

  for (const event of events) {
    const stamp = Date.parse(event.timestamp);
    const at = Number.isNaN(stamp) ? next.lastActivityAt : stamp;
    next = { ...next, lastActivityAt: at, model: event.model ?? next.model };

    // Computed once per event and shared by `lastTool` and the mark below: the
    // two used to derive the same string twice from the same input.
    const arg = event.type === 'tool_use' ? toolArg(event.toolInput) : '';

    switch (event.type) {
      case 'status_change':
        next = { ...next, activity: event.content ?? next.activity };
        break;
      case 'session_title':
        // Rewritten on every turn, so the freshest one wins. Never marks the
        // strip: naming the conversation is not work the session did.
        next = { ...next, title: event.content ?? next.title };
        break;
      case 'tool_use':
        next = {
          ...next,
          activity: 'busy',
          toolCount: next.toolCount + 1,
          lastTool: { name: event.toolName ?? 'unknown', arg },
          delegates: AGENT_TOOLS.has(event.toolName ?? '')
            ? openDelegate(next.delegates, event, at)
            : next.delegates,
        };
        // Name and subject ride on the mark: it is what lets the Monitor print
        // the session's last actions as a readable tape instead of a row of
        // anonymous bars.
        if (at)
          marks.push({
            at,
            kind: 'tool',
            tool: event.toolName ?? 'unknown',
            ...(arg ? { arg } : {}),
            id: event.toolUseId,
          });
        break;
      case 'tool_result':
        // The tool that just finished stops being what the session is doing;
        // the next tool_use (or the turn's end) sets that. Keeping it would
        // leave the cell reading "Bash · npm test" long after it returned.
        next = {
          ...next,
          lastTool: null,
          errorCount: next.errorCount + (event.isError ? 1 : 0),
          // A real result closes its dispatch; the async launch ack does not.
          delegates: (event.content ?? '').includes(ASYNC_LAUNCH_ACK)
            ? next.delegates
            : closeDelegate(next.delegates, event.toolUseId),
        };
        // A failure is not an event of its own — it is a verdict on the call
        // that is already on the track. Paired by id rather than by "the last
        // tool", which parallel calls make wrong.
        if (event.isError && event.toolUseId) {
          const i = marks.findIndex(m => m.id === event.toolUseId);
          if (i !== -1) marks[i] = { ...marks[i], failed: true };
        }
        break;
      // Text and thinking do NOT set the activity. `parseJsonlLine` emits a
      // line's `status_change` BEFORE that line's content blocks, so an
      // assistant message closing a turn arrives as `idle` followed by its own
      // `text` — deriving state from the text here overwrote the conclusion with
      // "thinking" and left every finished turn reading as if it were still
      // running. The status events already encode the whole machine (a user line
      // means Claude is answering, `end_turn` means it stopped, `tool_use` means
      // it is running one), so this only marks the trace and drops the tool.
      case 'text':
      case 'thinking':
        next = { ...next, lastTool: null };
        if (at) marks.push({ at, kind: 'text' });
        break;
      case 'user_message':
        // A finished async agent comes back as a user line carrying the id of
        // the dispatch that launched it — the one event that closes a delegate
        // in the parent transcript.
        next = {
          ...next,
          lastTool: null,
          delegates: closeDelegate(next.delegates, event.toolUseId),
        };
        if (at) marks.push({ at, kind: 'text' });
        break;
    }
  }

  // Prune against the newest mark rather than the wall clock: this stays pure,
  // and the renderer buckets against the real `now` anyway, so anything older
  // than its window falls off the left on its own.
  const newest = marks.length ? marks[marks.length - 1].at : 0;
  const kept = marks.filter(m => newest - m.at <= TRACE_WINDOW_MS).slice(-TRACE_MAX_MARKS);
  return { ...next, recent: kept };
}

/** Locate a session's transcript across both native layouts, without deriving
 *  the project folder name from the cwd: that rule (`/` and `.` both collapse
 *  to `-`) belongs to Claude Code, and getting it wrong would silently tail
 *  nothing. Asking the filesystem for the id costs one shallow glob, paid once
 *  per session, not per event. */
async function findTranscript(sessionId: string): Promise<string | null> {
  if (!isSafeSessionId(sessionId)) return null;
  const root = projectsDir();
  // Relative patterns with an explicit cwd: a pattern built with path.join
  // would contain `\` on Windows, which glob reads as an escape (#59).
  const matches = await glob([`*/${sessionId}.jsonl`, `*/sessions/${sessionId}.jsonl`], {
    cwd: root,
    absolute: true,
  });
  if (matches.length === 0) return null;
  // A session id is unique; if two layouts somehow both have it, the freshest wins.
  return matches
    .map(f => {
      try {
        return { f, mtime: statSync(f).mtimeMs };
      } catch {
        return { f, mtime: 0 };
      }
    })
    .sort((a, b) => b.mtime - a.mtime)[0].f;
}

/**
 * Everything this session had already billed before the cursor existed.
 *
 * The cursor starts at EOF — the Monitor reports what happens from now on — so
 * without this a session that was already running would report the cost of its
 * last few turns as its total. A money figure that is silently partial is worse
 * than none, so it is read once from `readSessionSpend` (the same cached
 * `parseSession` the project views use: an unchanged transcript costs one
 * `stat`) and the tail adds every turn after it.
 *
 * `needsSeed` gates it for two reasons. It must happen exactly once — a second
 * seed would double the whole history — and it must not happen at all for a
 * cursor adopted at offset 0, which reads the file itself. It also survives a
 * failed read, so the next sync tries again instead of leaving the session
 * without a figure for the rest of its life.
 */
async function seedSpend(cursor: Cursor): Promise<void> {
  if (!cursor.needsSeed || !cursor.transcriptPath) return;
  try {
    const seed = await readSessionSpend(cursor.transcriptPath);
    cursor.spend = seed.costUsd;
    cursor.tokens = seed.tokens;
    cursor.spendEstimated = !isModelPriced(seed.model);
    cursor.model = cursor.model ?? seed.model ?? null;
    cursor.needsSeed = false;
  } catch {
    // Unreadable right now: `needsSeed` stays set, so the next sync retries and
    // until then the lane prints no figure rather than a partial one.
  }
}

/**
 * Reconcile the tracked cursors with the live registry: open one for each new
 * session, drop the ones whose session is gone.
 *
 * A new cursor starts at the transcript's current size — the Monitor reports
 * what happens from now on, and re-parsing a multi-MB history to answer "what
 * is it doing" would pay the exact cost this design avoids.
 */
export async function syncSessionTails(
  sessions: ActiveSession[],
  now: number = Date.now()
): Promise<void> {
  const live = new Set(sessions.map(s => s.sessionId).filter(Boolean));

  for (const [sessionId, cursor] of cursors) {
    if (live.has(sessionId)) continue;
    cursors.delete(sessionId);
    // Stop tailing immediately (the path mapping goes), but keep the digest
    // around so the Monitor's "recently ended" lane has something to show.
    if (cursor.transcriptPath) byPath.delete(cursor.transcriptPath);
    ended.set(sessionId, { ...cursor, endedAt: now });
  }

  pruneEnded(now);

  for (const session of sessions) {
    if (!session.sessionId) continue; // process-scan fallback entries carry none
    // A session id can come back (a resumed transcript keeps its id): it is live
    // again, so it leaves the ended set with its counters intact.
    const revived = ended.get(session.sessionId);
    if (revived) ended.delete(session.sessionId);

    let cursor = cursors.get(session.sessionId);
    if (!cursor) {
      cursor = revived ? { ...revived, endedAt: null } : emptyActivity(session.sessionId);
      cursors.set(session.sessionId, cursor);
    }
    cursor.cwd = session.cwd;

    if (cursor.transcriptPath) {
      // A revived cursor kept its path but lost its mapping when it ended:
      // without this the file would be watched and never read again.
      byPath.set(cursor.transcriptPath, session.sessionId);
      // The seed is retried here, not only where the path is first found: this
      // branch is the one every later sync takes, so a read that failed once
      // would otherwise leave the session without a spend figure for its whole
      // life.
      await seedSpend(cursor);
      continue;
    }

    const path = await findTranscript(session.sessionId);
    if (!path) continue; // not written yet: adopted later, see onTranscriptChanged
    cursor.transcriptPath = path;
    try {
      cursor.offset = statSync(path).size;
    } catch {
      cursor.offset = 0;
    }
    // The cursor starts at EOF, so the title record is behind it: read it once,
    // here, or a session already running when the Monitor opened stays nameless
    // until its next turn. Appends keep it current from now on.
    cursor.title = cursor.title ?? readSessionTitle(path);
    // Same reasoning, with money at stake — see `seedSpend`. Only a cursor that
    // starts at EOF has a history behind it to seed; one adopted at offset 0
    // reads the whole file itself and must NOT be seeded, or every turn would be
    // billed twice.
    cursor.needsSeed = true;
    await seedSpend(cursor);
    byPath.set(path, session.sessionId);
  }
}

/**
 * Consume an append to a watched file. Returns true when it belonged to a
 * tracked session (i.e. the caller should push a fresh digest).
 *
 * Also the adoption point for a session that had no transcript when it was
 * first synced: the file arrives as an event whose name IS the session id, so
 * the match costs one Map lookup and no glob. Such a cursor starts at 0 —
 * the file is new, so its whole content is "from now on".
 */
export function onTranscriptChanged(path: string): boolean {
  let sessionId = byPath.get(path);
  if (!sessionId) {
    if (!path.endsWith('.jsonl')) return false;
    const candidate = basename(path, '.jsonl');
    const cursor = cursors.get(candidate);
    if (!cursor || cursor.transcriptPath) return false;
    cursor.transcriptPath = path;
    cursor.offset = 0;
    byPath.set(path, candidate);
    sessionId = candidate;
  }

  const cursor = cursors.get(sessionId);
  if (!cursor || !cursor.transcriptPath) return false;

  try {
    const read = readAppend(cursor.transcriptPath, cursor.offset);
    cursor.offset = read.offset;
    // A `turns`-only append is real: the assistant line that closes a turn can
    // carry usage without producing an event the digest keeps (its status change
    // repeats the current one). Returning early on `events` alone would drop the
    // context reading and the turn's cost.
    if (read.events.length === 0 && read.turns.length === 0) return read.reset;
    Object.assign(cursor, foldEvents(cursor, read.events, read.turns, cursor.seenUsage));
    return true;
  } catch {
    // Deleted or unreadable mid-read: keep the cursor, the next append retries.
    return false;
  }
}

/** Current digest for every tracked session, live ones first, plus the ones
 *  that ended inside the retention window (`endedAt` set).
 *
 *  This is the one place every delivery route passes through — the `live:getActivity`
 *  handler and both push sites — which is why the retention is enforced here (see
 *  `pruneEnded`) rather than only where a session is seen to end. `now` is a
 *  parameter for the same reason it is one on `syncSessionTails`: the tests drive
 *  the clock explicitly. */
export function getSessionActivity(now: number = Date.now()): SessionActivity[] {
  pruneEnded(now);
  const strip = ({
    offset: _offset,
    needsSeed: _needsSeed,
    seenUsage: _seenUsage,
    ...activity
  }: Cursor): SessionActivity => activity;
  return [...[...cursors.values()].map(strip), ...[...ended.values()].map(strip)];
}

/** Drop all state (tests, and the app's own teardown). */
export function resetSessionTails(): void {
  cursors.clear();
  byPath.clear();
  ended.clear();
}
