// This machine's half of reading a remote session (#294): the frames the host's
// watcher sends (`remote-watch.ts`), the transcript they rebuild, and what Lens
// and Mission Control draw from it. Pure — no fs, no process — and the rows it
// holds live in memory only: they are another machine's work, and nothing here
// writes them to this one's disk.
//
// The cursor is `transcript-tail`'s `readAppend`, fed from frames instead of a
// file descriptor, and deliberately a copy rather than a refactor of it: the
// local path is left exactly as it is, so the remote layer can be removed
// without touching it. The rules are the same — an append cursor, the trailing
// partial line kept until its newline arrives, the bytes assembled before
// decoding so a multi-byte character split across two frames survives, an
// unterminated oversized line dropped instead of buffered without bound, and a
// file that shrank read again from zero.

import type { ChatMessage } from '../shared/chat-types';
import type { RemoteSessionSummary } from '../shared/remote-session';
import { parseChatSessionText } from './session-reader';
import { mergeTranscriptExtras, parseTranscriptExtras } from './transcript-extras';
import { parseTurnUsage, type SessionTitleSource } from './transcript-tail';
import { calculateCacheSavings, costOfUsage } from './cost-tracker';

/** One message of the watcher's protocol (see `remote-watch.ts`). */
export type WatchMessage =
  | { kind: 'hello' }
  | { kind: 'cwd'; cwd: string }
  | { kind: 'search' }
  | { kind: 'ambiguous'; count: number }
  | { kind: 'session'; sessionId: string }
  | { kind: 'status'; status: string }
  | { kind: 'wait' }
  | { kind: 'reset' }
  | { kind: 'data'; offset: number; bytes: Buffer }
  | { kind: 'tick' }
  | { kind: 'gone' };

// A data frame is ~256 KB of base64; a line this long without a newline is not
// one being written, it is noise.
const MAX_FRAME_CHARS = 1024 * 1024;
// What is kept of ssh's own output, for the prompt and for a failure's reason.
const PREAMBLE_CHARS = 2048;
const SESSION_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const STATUS_RE = /^[A-Za-z_ -]{1,40}$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL_RE = /[\x00-\x1f\x7f]/;
// eslint-disable-next-line no-control-regex -- terminal escapes are exactly what is removed
const ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-_])/g;

/** One protocol line, or null for anything else. */
export function parseWatchLine(line: string): WatchMessage | null {
  if (!line.startsWith('@cl ')) return null;
  const [kind, a, b] = line.slice(4).split(' ');
  switch (kind) {
    case 'hello':
    case 'search':
    case 'wait':
    case 'reset':
    case 'tick':
    case 'gone':
      return { kind };
    case 'ambiguous': {
      const count = Number(a);
      return Number.isInteger(count) && count > 1 ? { kind, count } : null;
    }
    case 'session':
      return a && SESSION_ID_RE.test(a) ? { kind, sessionId: a } : null;
    case 'cwd': {
      const cwd = line.slice(4 + 'cwd '.length);
      return cwd && cwd.length <= 1024 && !CONTROL_RE.test(cwd) ? { kind, cwd } : null;
    }
    case 'status': {
      const status = line.slice(4 + 'status '.length);
      return STATUS_RE.test(status) ? { kind, status } : null;
    }
    case 'data': {
      const offset = Number(a);
      const payload = b ?? '';
      if (!Number.isSafeInteger(offset) || offset < 0 || !BASE64_RE.test(payload)) return null;
      return { kind, offset, bytes: Buffer.from(payload, 'base64') };
    }
    default:
      return null;
  }
}

/**
 * Splits the watcher channel's output into protocol messages. Everything that
 * arrives before `hello` is ssh's — a banner, a warning, a password prompt —
 * and is kept, escapes stripped, as the preamble; after it, a line that is not
 * a message is skipped. The channel runs in a PTY, which turns `\n` into
 * `\r\n`, so the `\r` goes too.
 */
export function createWatchReader(): {
  feed(chunk: string): WatchMessage[];
  started(): boolean;
  /** ssh's own output before the script started. */
  preamble(): string;
} {
  let pending = '';
  let started = false;
  let preamble = '';
  return {
    feed(chunk) {
      const out: WatchMessage[] = [];
      pending += chunk;
      let nl: number;
      while ((nl = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, nl).replace(/\r$/, '');
        pending = pending.slice(nl + 1);
        const message = parseWatchLine(line);
        if (message) {
          if (message.kind === 'hello') started = true;
          if (started) out.push(message);
        } else if (!started) {
          preamble = (preamble + line + '\n').slice(-PREAMBLE_CHARS);
        }
      }
      if (pending.length > MAX_FRAME_CHARS) pending = '';
      return out;
    },
    started: () => started,
    // The partial line is part of it: a prompt waits on its own line, unterminated.
    preamble: () =>
      started ? preamble.replace(ANSI_RE, '') : (preamble + pending).replace(ANSI_RE, ''),
  };
}

/** The line ssh is waiting on, if any: prompts end without a newline. */
export function pendingPrompt(preamble: string): string | null {
  const last = preamble.slice(preamble.lastIndexOf('\n') + 1).trim();
  return last || null;
}

/** The last thing ssh said, for a failure's reason. */
export function lastWords(preamble: string): string | null {
  const lines = preamble
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  return lines.length ? lines.slice(-2).join(' ') : null;
}

// A single JSONL line above this is treated as corrupt and dropped, as in
// `transcript-tail`.
const MAX_LINE_BYTES = 16 * 1024 * 1024;

export type AppendOutcome = 'appended' | 'reset' | 'gap';

/**
 * The transcript as the frames rebuild it: every complete line, in order, and
 * the partial one held back. `append` answers `gap` when a frame does not start
 * where the last one ended — the stream is reliable, so that means a frame was
 * lost here, and the caller reads the file again from zero rather than holding
 * a transcript with a hole in it.
 */
export function createTranscriptBuffer(maxLineBytes = MAX_LINE_BYTES) {
  let received = 0;
  let pending: Buffer = Buffer.alloc(0);
  // Set while the rest of an oversized line is being thrown away.
  let skipping = false;
  let text = '';
  let lines = 0;
  let dropped = 0;

  const reset = () => {
    received = 0;
    pending = Buffer.alloc(0);
    skipping = false;
    text = '';
    lines = 0;
  };

  const push = (buf: Buffer) => {
    const line = buf.toString('utf-8').trim();
    if (!line) return;
    text = lines ? `${text}\n${line}` : line;
    lines++;
  };

  return {
    append(offset: number, bytes: Buffer): AppendOutcome {
      let outcome: AppendOutcome = 'appended';
      if (offset === 0 && received > 0) {
        reset();
        outcome = 'reset';
      }
      if (offset !== received) return 'gap';
      received += bytes.length;
      pending = pending.length ? Buffer.concat([pending, bytes]) : bytes;
      let nl: number;
      while ((nl = pending.indexOf(0x0a)) !== -1) {
        if (skipping) skipping = false;
        else push(pending.subarray(0, nl));
        pending = pending.subarray(nl + 1);
      }
      if (!skipping && pending.length > maxLineBytes) {
        dropped++;
        skipping = true;
      }
      if (skipping) pending = Buffer.alloc(0);
      return outcome;
    },
    reset,
    /** The complete lines, joined. */
    text: () => text,
    lineCount: () => lines,
    /** Bytes received so far: where the next frame must start. */
    received: () => received,
    dropped: () => dropped,
  };
}

/** What Lens and the rail draw from the transcript text. */
export interface RemoteSnapshot {
  messages: ChatMessage[];
  summary: RemoteSessionSummary;
}

const TITLE_KEYS: Record<string, { key: string; source: SessionTitleSource }> = {
  'agent-name': { key: 'agentName', source: 'agent' },
  'custom-title': { key: 'customTitle', source: 'custom' },
  'ai-title': { key: 'aiTitle', source: 'ai' },
};

/**
 * The messages, through the same two passes `session-search` makes over text
 * it already holds — `parseChatSessionText` for the chat rows and
 * `parseTranscriptExtras` for the ones it drops on purpose — and the figures,
 * from `parseTurnUsage` with each turn billed once by its `usageKey` and priced
 * at its own model and date, as `session-tails` does for a live local session.
 * The SDK read the local Lens uses reads a file on this machine, so it cannot
 * apply here.
 */
export function buildRemoteSnapshot(text: string, sessionId: string): RemoteSnapshot {
  const messages = mergeTranscriptExtras(parseChatSessionText(text), parseTranscriptExtras(text));
  const summary: RemoteSessionSummary = {
    filename: `${sessionId}.jsonl`,
    date: messages[0]?.timestamp ?? '',
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    cacheSavings: 0,
    messageCount: messages.length,
    models: {},
  };
  const seen = new Set<string>();
  // The last record of each kind wins; which kind names the session is the
  // renderer's call (`sessionTitle`), as it is for a local summary.
  const titles: Partial<Record<SessionTitleSource, string>> = {};
  for (const line of text.split('\n')) {
    // Cheap reject first: only usage and title rows are parsed a second time.
    const titleRow = line.includes('-title"') || line.includes('"agent-name"');
    if (!titleRow && !line.includes('"usage"')) continue;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const title = typeof json.type === 'string' ? TITLE_KEYS[json.type] : undefined;
    if (title) {
      const value = json[title.key];
      if (typeof value === 'string' && value.trim()) {
        titles[title.source] = value.trim();
      }
      continue;
    }
    const turn = parseTurnUsage(json);
    if (!turn) continue;
    if (turn.usageKey) {
      if (seen.has(turn.usageKey)) continue;
      seen.add(turn.usageKey);
    }
    const at = typeof json.timestamp === 'string' ? json.timestamp : undefined;
    summary.inputTokens += turn.inputTokens;
    summary.outputTokens += turn.outputTokens;
    summary.cacheWriteTokens += turn.cacheWriteTokens;
    summary.cacheReadTokens += turn.cacheReadTokens;
    summary.estimatedCost += costOfUsage(turn, turn.model, at);
    summary.cacheSavings += calculateCacheSavings(turn.cacheReadTokens, turn.model, at);
    if (turn.model) {
      summary.models[turn.model] = (summary.models[turn.model] ?? 0) + 1;
      summary.model = turn.model;
    }
  }
  summary.totalTokens =
    summary.inputTokens + summary.outputTokens + summary.cacheWriteTokens + summary.cacheReadTokens;
  if (titles.agent) summary.agentName = titles.agent;
  if (titles.custom) summary.customTitle = titles.custom;
  if (titles.ai) summary.aiTitle = titles.ai;
  const firstUser = messages.find(m => m.role === 'user' && !m.inbound && !m.notice);
  const firstText = firstUser?.content.find(b => b.type === 'text');
  if (firstText && firstText.type === 'text' && firstText.text.trim()) {
    summary.firstUserMessage = firstText.text.trim().slice(0, 200);
  }
  return { messages, summary };
}
