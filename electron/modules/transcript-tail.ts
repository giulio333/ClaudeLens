import { openSync, fstatSync, readSync, closeSync } from 'fs';

// Reading the tail of a session transcript: the byte-level half of the Live
// views. Extracted from `live-monitor.ts`, where it lived inside a chokidar
// callback and therefore could not be tested — the parts most likely to be
// wrong (a line straddling two chunks, a multi-byte char split across them, a
// truncated file leaving the cursor past EOF) had no coverage at all.
//
// Both callers append-read the same way: `live-monitor` for the one session a
// user is watching, `session-tails` for every live session at once.

/** Which record named the session. Claude Code writes THREE: `agent-name` for
 *  the name the user typed with `/rename`, `custom-title` for the one they set
 *  with `/title` (the command `/rename` replaced — the records live on in older
 *  transcripts), and `ai-title` for the one it generated. They are not
 *  interchangeable — the generated one is rewritten on later turns, so without
 *  knowing which is which a name the user chose gets silently overwritten by
 *  the next auto-title. */
export type SessionTitleSource = 'agent' | 'custom' | 'ai';

/** The precedence, in one place because two call sites resolve it: the head
 *  scan that seeds a name and the fold that keeps it fresh. It is Claude Code's
 *  own (`registry name ?? customTitle ?? aiTitle`) — a name the user typed beats
 *  the generated one however late that one was written, and `/rename` beats the
 *  retired `/title` because it is the only way left to set one. */
const TITLE_RANK: Record<SessionTitleSource, number> = { agent: 2, custom: 1, ai: 0 };

/** Whether a title record should replace the one already held. Equal ranks pass:
 *  within a source the freshest record wins, since all three are rewritten and
 *  the newest is current. */
export function outranksTitle(
  incoming: SessionTitleSource,
  current: SessionTitleSource | null
): boolean {
  return current === null || TITLE_RANK[incoming] >= TITLE_RANK[current];
}

export interface LiveEvent {
  id: string;
  timestamp: string;
  type:
    | 'tool_use'
    | 'tool_result'
    | 'text'
    | 'thinking'
    | 'user_message'
    | 'status_change'
    | 'session_title';
  toolName?: string;
  toolInput?: Record<string, unknown>;
  content?: string;
  isError?: boolean;
  model?: string;
  /** The `tool_use` block id — carried on the call, on its result, and on the
   *  `<task-notification>` that reports an async agent finishing (where the
   *  transcript writes it as `<tool-use-id>`). It is what lets a consumer pair a
   *  dispatch with its end without guessing from arrival order. */
  toolUseId?: string;
  /** Set on `session_title` only: which record carried the name. A consumer
   *  folding successive appends needs it to keep a user's `/title` from being
   *  clobbered by a later auto-title. */
  titleSource?: SessionTitleSource;
}

/**
 * One assistant turn's billed usage, as the transcript records it.
 *
 * Kept OFF `LiveEvent` deliberately. A single assistant line yields several
 * events (a status change, its text, each tool call), so hanging the usage on
 * them would either double-count it or force every consumer of the union — the
 * Live view included — to learn a new event type it has no use for. It is an
 * attribute of the line, so it rides alongside the events, one entry per line
 * that carried one, in file order.
 *
 * Two readings come out of it, and they are not the same quantity: the PROMPT
 * (input + both cache figures) is what occupies the context window and is a
 * level — only the newest line's value means anything. Everything billed,
 * output included, is a total and accumulates.
 *
 * Which is why `usageKey` is here: one turn is written as SEVERAL lines (one per
 * content block) that each repeat the same message-level usage, so a consumer
 * that treats every entry as a turn bills the turn once per block. The level is
 * unharmed — the repeats carry the same figure — but the totals are not. See
 * `parseTurnUsage`.
 */
export interface TurnUsage {
  /** Epoch ms of the line; 0 when it carried no parsable timestamp. */
  at: number;
  model?: string;
  /** Stable identity of this turn's message-level usage (`message.id` +
   *  `requestId`), so a caller accumulating totals can count each turn once.
   *  Undefined when the line carries neither id — then the entry is all the
   *  identity there is and it counts as its own turn. */
  usageKey?: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface AppendRead {
  events: LiveEvent[];
  /** Billed usage of each assistant line in this append, in file order. */
  turns: TurnUsage[];
  /** New absolute cursor: bytes up to and including the last complete line. */
  offset: number;
  /** Malformed or oversized lines skipped in this read. */
  dropped: number;
  /** True when the file had shrunk below the incoming offset and was re-read. */
  reset: boolean;
}

// Cap for a single readSync allocation; larger appends loop.
const MAX_READ_BYTES = 4 * 1024 * 1024; // 4 MB
// A single JSONL line above this is treated as corrupt and dropped.
const MAX_LINE_BYTES = 16 * 1024 * 1024; // 16 MB

/**
 * Read everything appended to `filePath` since byte `from`.
 *
 * The trailing partial line (no newline yet — a record still being written) is
 * deliberately left unconsumed: the returned `offset` stops at the last
 * newline, so the next call re-reads those bytes once the line is complete.
 * That is why the byte buffer is assembled before decoding — cutting UTF-8 at
 * a chunk boundary would corrupt a multi-byte character.
 *
 * A file that shrank below `from` (truncated or recreated) is re-read from 0
 * rather than skipped: leaving the cursor past EOF would silently swallow every
 * later append until the file grew back past the stale offset.
 *
 * `chunkSize` exists so tests can force the boundary cases with a few bytes
 * instead of a 4 MB fixture; production always uses the default.
 */
export function readAppend(filePath: string, from: number, chunkSize = MAX_READ_BYTES): AppendRead {
  const events: LiveEvent[] = [];
  const turns: TurnUsage[] = [];
  let dropped = 0;
  let reset = false;

  const fd = openSync(filePath, 'r');
  try {
    const size = fstatSync(fd).size;
    let start = from;
    if (size < start) {
      start = 0;
      reset = true;
    }
    if (size <= start) return { events, turns, offset: start, dropped, reset };

    let offset = start;
    let consumed = start; // bytes up to and including the last newline
    let pending = Buffer.alloc(0);

    const emitLine = (lineBuf: Buffer) => {
      const line = lineBuf.toString('utf-8').trim();
      if (!line) return;
      try {
        const json = JSON.parse(line) as Record<string, unknown>;
        events.push(...parseJsonlLine(json));
        const usage = parseTurnUsage(json);
        if (usage) turns.push(usage);
      } catch {
        dropped++;
      }
    };

    while (offset < size) {
      const want = Math.min(chunkSize, size - offset);
      const buf = Buffer.alloc(want);
      const n = readSync(fd, buf, 0, want, offset);
      if (n <= 0) break;
      offset += n;
      pending = pending.length ? Buffer.concat([pending, buf.subarray(0, n)]) : buf.subarray(0, n);

      let nl: number;
      while ((nl = pending.indexOf(0x0a)) !== -1) {
        emitLine(pending.subarray(0, nl));
        consumed += nl + 1;
        pending = pending.subarray(nl + 1);
      }

      // An unterminated, oversized line is corrupt rather than pending: drop it
      // instead of buffering without bound.
      if (pending.length > MAX_LINE_BYTES) {
        dropped++;
        consumed += pending.length;
        pending = Buffer.alloc(0);
      }
    }

    return { events, turns, offset: consumed, dropped, reset };
  } finally {
    closeSync(fd);
  }
}

/**
 * The billed usage of one transcript line, or null when it carries none.
 *
 * Sidechain lines are skipped for the same reason the digest keeps no counters
 * for a sub-agent: those tokens are the sub-agent's, and folding them into the
 * parent would make one session's context reading and one session's bill answer
 * for two. (A sub-agent's prompt is its own — adding it to the parent's would
 * report a window fuller than it is and could invent a compaction that is not
 * coming.)
 *
 * Every field is read defensively: this is an undocumented internal format, and
 * a usage block that gained or lost a key must cost us a zero, never a NaN
 * propagating into a dollar figure.
 *
 * The `usageKey` it stamps is the same identity `cost-tracker` dedupes on, and
 * for the same reason (issue #56): Claude Code writes one line per content block
 * of an assistant turn and each repeats the whole message envelope, usage
 * included. Measured over 11 real transcripts, up to 5 lines carry one turn's
 * usage and 28 of 33 turns in one of them were written twice — a tail summing
 * every entry reported 1.86× the tokens the project views quote for the same
 * file. The key is produced here rather than deduped here on purpose: this
 * function sees one line, and the repeats can straddle two appends, so only a
 * caller with memory across reads can drop them.
 */
export function parseTurnUsage(json: Record<string, unknown>): TurnUsage | null {
  if (json.type !== 'assistant') return null;
  if (json.isMeta === true || json.isSidechain === true) return null;

  const msg = json.message as Record<string, unknown> | undefined;
  const usage = msg?.usage as Record<string, unknown> | undefined;
  if (!usage) return null;

  const num = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

  const inputTokens = num(usage.input_tokens);
  const outputTokens = num(usage.output_tokens);
  const cacheWriteTokens = num(usage.cache_creation_input_tokens);
  const cacheReadTokens = num(usage.cache_read_input_tokens);
  // A line whose usage block is present but empty is not a turn: counting it
  // would stamp the session's activity without any work having happened.
  if (!inputTokens && !outputTokens && !cacheWriteTokens && !cacheReadTokens) return null;

  const messageId = typeof msg?.id === 'string' ? msg.id : '';
  const requestId = typeof json.requestId === 'string' ? json.requestId : '';

  const stamp = Date.parse(String(json.timestamp ?? ''));
  return {
    at: Number.isNaN(stamp) ? 0 : stamp,
    model: typeof msg?.model === 'string' ? msg.model : undefined,
    usageKey: messageId || requestId ? `${messageId}:${requestId}` : undefined,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
  };
}

/** A session's name as one transcript record carries it. */
export interface SessionTitle {
  title: string;
  source: SessionTitleSource;
}

/** The title, if any, that an already-parsed transcript line carries. The one
 *  place that knows which record types name a session and under which key, so
 *  the streaming path (`parseJsonlLine`) and the head scan (`readSessionTitle`)
 *  cannot drift apart on it — they read the same two records and resolve them
 *  the same way. The cap is what the name is FOR: one line on a card, and a
 *  record is undocumented, so an unbounded one would ride every append over
 *  IPC. */
const TITLE_MAX = 120;
/** The record types that name a session, each with the key holding the name. */
const TITLE_RECORDS: Record<string, { key: string; source: SessionTitleSource }> = {
  'agent-name': { key: 'agentName', source: 'agent' },
  'custom-title': { key: 'customTitle', source: 'custom' },
  'ai-title': { key: 'aiTitle', source: 'ai' },
};
/** The same record types as a substring test, for the head scan's cheap reject.
 *  Derived from the table so a record added there is never missed here. */
const TITLE_RECORD_MARKERS = Object.keys(TITLE_RECORDS).map(type => `"${type}"`);
function readTitleRecord(json: Record<string, unknown>): SessionTitle | null {
  const record = typeof json.type === 'string' ? TITLE_RECORDS[json.type] : undefined;
  if (!record) return null;
  const raw = json[record.key];
  const title = typeof raw === 'string' ? raw.trim() : '';
  if (!title) return null;
  return { title: title.slice(0, TITLE_MAX), source: record.source };
}

/** Translate one transcript line into the flat events the Live views render. */
export function parseJsonlLine(json: Record<string, unknown>): LiveEvent[] {
  const events: LiveEvent[] = [];

  // The session's human title. Claude Code writes it as its own record type —
  // `{"type":"ai-title","aiTitle":"…"}` for the name it generates and
  // `{"type":"custom-title","customTitle":"…"}` for the one the user sets with
  // `/title` — so it is neither a message nor in the registry, where `name` is
  // only the derived "<project>-xx". It therefore sits ahead of the
  // user/assistant filter below, which would otherwise drop the one field that
  // tells two sessions of the same project apart. The record carries no
  // timestamp: an empty one leaves the digest's activity stamp alone (Date.parse
  // fails, the fold keeps the old value) instead of dating the session to now.
  //
  // BOTH records, not just the generated one: reading `ai-title` alone left the
  // Monitor unable to name a session the user had renamed, while the sessions
  // list — which reads `customTitle || aiTitle` — showed that name. Two
  // surfaces disagreeing about which session is which is the whole problem the
  // title exists to solve, and after `/clear` (a new session id in the same
  // process, with the previous one still on screen for its retention window)
  // it leaves two cards of one project with nothing to tell them apart.
  const titleRecord = readTitleRecord(json);
  if (titleRecord) {
    return [
      {
        id: `title-${titleRecord.title.slice(0, 24)}`,
        timestamp: String(json.timestamp ?? ''),
        type: 'session_title',
        content: titleRecord.title,
        titleSource: titleRecord.source,
      },
    ];
  }
  // A title record that carried no usable name is still a title record: fall
  // through to nothing rather than to the message parsing below.
  if (typeof json.type === 'string' && json.type in TITLE_RECORDS) return events;

  if (json.type !== 'user' && json.type !== 'assistant') return events;
  if (json.isMeta === true || json.isSidechain === true) return events;

  const msg = json.message as Record<string, unknown> | undefined;
  if (!msg) return events;

  const role = msg.role as string;
  const model = msg.model as string | undefined;
  const ts = String(json.timestamp ?? new Date().toISOString());
  const baseId = `${ts}-${Math.random().toString(36).slice(2, 8)}`;

  // Status derived from stop_reason (assistant). `stop_reason: null` is the
  // draft written mid-stream and always followed by the real one — ignoring it
  // avoids a thinking→idle flash inside a React batch.
  if (json.type === 'assistant') {
    const stopReason = msg.stop_reason as string | null | undefined;
    if (stopReason === 'end_turn') {
      events.push({ id: `${baseId}-st`, timestamp: ts, type: 'status_change', content: 'idle' });
    } else if (stopReason === 'tool_use') {
      events.push({ id: `${baseId}-st`, timestamp: ts, type: 'status_change', content: 'busy' });
    }
  }

  // Any user message means Claude starts answering — covers free text and the
  // tool_result that resumes a turn.
  if (json.type === 'user') {
    events.push({ id: `${baseId}-st`, timestamp: ts, type: 'status_change', content: 'thinking' });
  }

  if (typeof msg.content === 'string' && role === 'user') {
    // A finished async agent reports back as a plain user line carrying
    // `<tool-use-id>`, the id of the dispatch that launched it. The id has to be
    // read BEFORE the tags are stripped for display, or the pairing is lost.
    const taskEnd = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(msg.content);
    const text = msg.content.replace(/<[^>]+>/g, '').trim();
    if (text) {
      events.push({
        id: baseId,
        timestamp: ts,
        type: 'user_message',
        content: text.slice(0, 300),
        toolUseId: taskEnd ? taskEnd[1].trim() : undefined,
      });
    }
    return events;
  }

  if (!Array.isArray(msg.content)) return events;

  for (const block of msg.content as Record<string, unknown>[]) {
    if (block.type === 'text' && role === 'assistant') {
      const text = ((block.text as string) ?? '').trim();
      if (text) {
        events.push({
          id: `${baseId}-t`,
          timestamp: ts,
          type: 'text',
          content: text.slice(0, 400),
          model,
        });
      }
    } else if (block.type === 'thinking') {
      const text = ((block.thinking as string) ?? '').trim();
      if (text) {
        events.push({
          id: `${baseId}-th`,
          timestamp: ts,
          type: 'thinking',
          content: text.slice(0, 300),
          model,
        });
      }
    } else if (block.type === 'tool_use') {
      events.push({
        id: `${baseId}-tu-${String(block.id ?? '').slice(-4)}`,
        timestamp: ts,
        type: 'tool_use',
        toolName: String(block.name ?? 'unknown'),
        toolInput: block.input as Record<string, unknown>,
        toolUseId: block.id ? String(block.id) : undefined,
        model,
      });
    } else if (block.type === 'tool_result') {
      const content =
        typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? (block.content as { text?: string }[]).map(c => c.text ?? '').join(' ')
            : '';
      events.push({
        id: `${baseId}-tr-${String(block.tool_use_id ?? '').slice(-4)}`,
        timestamp: ts,
        type: 'tool_result',
        content: content.slice(0, 400),
        isError: Boolean(block.is_error),
        toolUseId: block.tool_use_id ? String(block.tool_use_id) : undefined,
      });
    }
  }

  return events;
}

/** How much of a transcript is scanned, at EACH END, for the session title. The
 *  record is written early in a session and rewritten on every turn — so the
 *  tail keeps it fresh from here on, and reading a whole multi-MB history just
 *  to name a card is the cost these modules exist to avoid. */
const TITLE_SCAN_BYTES = 256 * 1024;

/** The title records in one already line-safe slice of a transcript, resolved
 *  against what an earlier slice found. Within a source the last record wins
 *  (all three are rewritten, and the newest is current), and across sources a
 *  name the user typed outranks a generated one however late that one was
 *  written. */
function scanTitles(text: string, best: SessionTitle | null): SessionTitle | null {
  for (const line of text.split('\n')) {
    // Cheap reject first: parsing every line of a transcript slice to find one
    // record would make this as expensive as the scan it replaces.
    if (!TITLE_RECORD_MARKERS.some(marker => line.includes(marker))) continue;
    try {
      const found = readTitleRecord(JSON.parse(line) as Record<string, unknown>);
      if (found && outranksTitle(found.source, best?.source ?? null)) best = found;
    } catch {
      // Not JSON, so not a title.
    }
  }
  return best;
}

/** `length` bytes from `position`, as whole lines. Both ends are trimmed to a
 *  newline: a slice that does not start at 0 opens mid-record (and possibly
 *  mid-character), and one that ends before EOF — or at a record still being
 *  written — closes the same way. Handing either fragment to `JSON.parse` is
 *  what the trimming avoids. */
function readLines(fd: number, position: number, length: number): string {
  if (length <= 0) return '';
  const buffer = Buffer.alloc(length);
  const read = readSync(fd, buffer, 0, length, position);
  const text = buffer.subarray(0, read).toString('utf8');
  const newline = text.indexOf('\n');
  if (position !== 0 && newline < 0) return '';
  const from = position === 0 ? 0 : newline + 1;
  const cut = text.lastIndexOf('\n');
  return cut < 0 ? text.slice(from) : text.slice(from, cut);
}

/**
 * The session's human title, read from an existing transcript.
 *
 * A tail cursor starts at EOF, so the title record is already behind it: a
 * session that was running before the Monitor opened would otherwise stay
 * nameless until its next turn. Returns null when the file holds no title
 * record where it looks, or cannot be read — an unnamed card says so, it never
 * invents a name.
 *
 * It reads BOTH ENDS, and that is the point rather than an optimisation. The
 * generated title is written early, but a RENAME lands where the user typed it,
 * which on a long session is far past any affordable head scan: in the
 * transcript this was built from, `agent-name` first appears at byte 294718,
 * past a 256 KB head, while `ai-title` sits at 120065. Reading the head alone
 * therefore named a renamed session with the title it had before — on the one
 * surface whose whole job is telling concurrent sessions apart. The meta block
 * is re-emitted every few turns, so the end of the file carries the current
 * name; the head is kept because it is where a short session's only record is.
 *
 * Returns the SOURCE alongside the name, because the caller folds later appends
 * onto this value and the three records do not rank equally: `ai-title` is
 * rewritten on subsequent turns, so a `/rename` seeded here has to be able to
 * refuse the next generated one.
 */
export function readSessionTitle(
  filePath: string,
  maxBytes = TITLE_SCAN_BYTES
): SessionTitle | null {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const size = fstatSync(fd).size;
    if (size <= 0) return null;
    let best = scanTitles(readLines(fd, 0, Math.min(size, maxBytes)), null);
    // The second slice exists only on a file long enough to have one, and `from`
    // never walks back into the head: the two windows meet at most once, so no
    // line is scanned twice and a mid-sized file is still read whole.
    if (size > maxBytes) {
      const from = Math.max(maxBytes, size - maxBytes);
      best = scanTitles(readLines(fd, from, size - from), best);
    }
    return best;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
