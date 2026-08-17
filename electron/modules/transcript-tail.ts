import { openSync, fstatSync, readSync, closeSync } from 'fs';

// Reading the tail of a session transcript: the byte-level half of the Live
// views. Extracted from `live-monitor.ts`, where it lived inside a chokidar
// callback and therefore could not be tested — the parts most likely to be
// wrong (a line straddling two chunks, a multi-byte char split across them, a
// truncated file leaving the cursor past EOF) had no coverage at all.
//
// Both callers append-read the same way: `live-monitor` for the one session a
// user is watching, `session-tails` for every live session at once.

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
 */
export interface TurnUsage {
  /** Epoch ms of the line; 0 when it carried no parsable timestamp. */
  at: number;
  model?: string;
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

  const stamp = Date.parse(String(json.timestamp ?? ''));
  return {
    at: Number.isNaN(stamp) ? 0 : stamp,
    model: typeof msg?.model === 'string' ? msg.model : undefined,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
  };
}

/** Translate one transcript line into the flat events the Live views render. */
export function parseJsonlLine(json: Record<string, unknown>): LiveEvent[] {
  const events: LiveEvent[] = [];

  // The session's human title. Claude Code writes it as its own record type
  // (`{"type":"ai-title","aiTitle":"…"}`) and rewrites it on every turn, so it
  // is neither a message nor in the registry — where `name` is only the derived
  // "<project>-xx". It therefore sits ahead of the user/assistant filter below,
  // which would otherwise drop the one field that tells two sessions of the same
  // project apart. The record carries no timestamp: an empty one leaves the
  // digest's activity stamp alone (Date.parse fails, the fold keeps the old
  // value) instead of dating the session to now.
  if (json.type === 'ai-title') {
    const title = typeof json.aiTitle === 'string' ? json.aiTitle.trim() : '';
    if (!title) return events;
    return [
      {
        id: `title-${title.slice(0, 24)}`,
        timestamp: String(json.timestamp ?? ''),
        type: 'session_title',
        content: title.slice(0, 120),
      },
    ];
  }

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

/** How much of a transcript's head is scanned for the session title. The record
 *  is written early in a session and rewritten on every turn — so the tail keeps
 *  it fresh from here on, and reading a whole multi-MB history just to name a
 *  card is the cost these modules exist to avoid. */
const TITLE_SCAN_BYTES = 256 * 1024;

/**
 * The session's human title, read from the head of an existing transcript.
 *
 * A tail cursor starts at EOF, so the `ai-title` record is already behind it: a
 * session that was running before the Monitor opened would otherwise stay
 * nameless until its next turn. Returns null when the file has no title record
 * in its head, or cannot be read — an unnamed card falls back to the pid, it
 * never invents a name.
 */
export function readSessionTitle(filePath: string, maxBytes = TITLE_SCAN_BYTES): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const length = Math.min(fstatSync(fd).size, maxBytes);
    if (length <= 0) return null;
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, 0);
    const text = buffer.subarray(0, read).toString('utf8');
    // With a byte cap the read usually stops mid-line: drop that fragment rather
    // than hand a truncated JSON object to the parser.
    const cut = text.lastIndexOf('\n');
    const lines = (cut < 0 ? text : text.slice(0, cut)).split('\n');
    let title: string | null = null;
    for (const line of lines) {
      // Cheap reject first: parsing every line of a transcript head to find one
      // record would make this as expensive as the scan it replaces.
      if (!line.includes('"ai-title"')) continue;
      try {
        const json = JSON.parse(line) as { type?: string; aiTitle?: unknown };
        if (json.type === 'ai-title' && typeof json.aiTitle === 'string' && json.aiTitle.trim()) {
          // Keep walking: the title is rewritten, and the last one is current.
          title = json.aiTitle.trim().slice(0, 120);
        }
      } catch {
        // Not JSON, so not a title.
      }
    }
    return title;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
