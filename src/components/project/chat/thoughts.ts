import { ChatMessage } from '../../../hooks/useIPC';

/**
 * The sentence Claude writes for a tool call, read back as narration.
 *
 * Every `tool_use` can carry a `description` — a short phrase the model wrote
 * for that specific call ("Show recent commits and changed files", "Read
 * live-monitor module"). It is the only plain-language account of a session
 * that exists in the data, and until now the app rendered it as a grey preview
 * line inside a tool card, visible only at FULL density and only if you were
 * scrolled to it (`ToolGroupCard`), or not at all (the live chip said "Using
 * Bash").
 *
 * Three rules, each of them measured rather than assumed (59 real transcripts,
 * 38 projects, 1358 non-sidechain tool calls — see issue #236):
 *
 *  - **Only `description` is a thought.** 47% of calls carry one; the coverage
 *    is `Bash` 82% and `Agent` 100%, and exactly **zero** for Read/Edit/Write/
 *    Glob/Grep and every MCP tool observed. So there are long silences by
 *    construction, and the answer to a silence is to say nothing: deriving a
 *    sentence from `command` or `file_path` would just be `toolArg` wearing
 *    quotation marks, and holding the previous sentence while the session has
 *    moved on states something false. Note this is the OPPOSITE priority to
 *    `toolArg` in `session-tails.ts`, which puts `command` first on purpose —
 *    a Monitor cell answers "what is it running", this answers "what for".
 *  - **A thought is paced by its length.** 13% of consecutive described calls
 *    arrive under 2s apart (29% under 4s), which is faster than anyone reads,
 *    while the median gap is 7.3s. Hence a dwell floor per sentence.
 *  - **A backlog is dropped, not drained.** See `enqueue`.
 */
export interface Thought {
  /** The call's `tool_use` id — the identity that keeps one call from being
   *  narrated twice when the same transcript is read again (the Lens re-reads
   *  the whole file on every watcher burst). */
  id: string;
  /** The tool that carried the sentence, shown as its meta. */
  tool: string;
  text: string;
}

/**
 * Cap on a sentence, in characters.
 *
 * Measured: p50 31, p90 48, max 71 — so this only ever trims an outlier, and
 * exists so one pathological description can't push the line past a readable
 * width.
 */
export const THOUGHT_MAX = 96;

/** The sentence of one tool call, or '' when the call carries none. */
export function thoughtOf(input: Record<string, unknown> | undefined): string {
  const raw = input?.description;
  if (typeof raw !== 'string') return '';
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > THOUGHT_MAX ? flat.slice(0, THOUGHT_MAX - 1).trimEnd() + '…' : flat;
}

// How long a sentence holds the line: a fixed cost for noticing it at all,
// plus reading time. 55ms/char is deliberately slower than prose reading
// (~20 chars/s) because this line is read peripherally, while the reader's
// attention is on the transcript.
const DWELL_BASE_MS = 1200;
const DWELL_PER_CHAR_MS = 55;
export const DWELL_FLOOR_MS = 1600;
export const DWELL_CEIL_MS = 4200;

/** How long `text` should hold the line. */
export function dwellMs(text: string): number {
  const ms = DWELL_BASE_MS + text.length * DWELL_PER_CHAR_MS;
  return Math.min(DWELL_CEIL_MS, Math.max(DWELL_FLOOR_MS, ms));
}

/** What is on the line, and the earliest it may be replaced. */
export interface ThoughtQueue {
  showing: { thought: Thought; until: number } | null;
  pending: Thought[];
}

/**
 * How many thoughts may wait their turn.
 *
 * Small on purpose — see `enqueue`. Two is enough to absorb a pair of parallel
 * calls without the line lagging behind the session.
 */
export const PENDING_MAX = 2;

export function emptyQueue(): ThoughtQueue {
  return { showing: null, pending: [] };
}

/**
 * The described calls in `messages` that are news, marking each one seen.
 *
 * `seen` is caller-owned and mutated in place (the same contract as
 * `dropRepeats` in `session-tails.ts`): the caller is the one with memory
 * across reads, and this is called once per read of a transcript that only
 * grows.
 *
 * `since` is what keeps a session's history from replaying as a ticker the
 * moment a view opens — the same decision as the Monitor's cursor starting at
 * EOF rather than re-parsing a multi-MB file. A message whose timestamp can't
 * be parsed is treated as old: a call we cannot date is not news.
 */
export function collectThoughts(
  messages: ChatMessage[],
  since: number,
  seen: Set<string>
): Thought[] {
  const fresh: Thought[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    const at = Date.parse(msg.timestamp);
    if (!Number.isFinite(at) || at < since) continue;
    for (const block of msg.content) {
      if (block.type !== 'tool_use' || seen.has(block.id)) continue;
      // Marked seen before the sentence is read, so an undescribed call is
      // examined once and never again.
      seen.add(block.id);
      const text = thoughtOf(block.input);
      if (text) fresh.push({ id: block.id, tool: block.name, text });
    }
  }
  return fresh;
}

/**
 * Add fresh thoughts, promoting one to the line if it is free.
 *
 * The burst policy is to **keep the newest and drop the oldest waiting**: a
 * queue drained in order falls behind the session by the sum of its own dwell
 * times, so on a run of fast calls it would narrate work that finished twenty
 * seconds ago — which is worse than the gap it fills, because the reader is
 * watching the session, not reading a log. What was dropped is not counted on
 * screen either: the transcript is the record, and a `+3` next to a sentence
 * buys a number nobody can act on.
 *
 * Returns the same object when there is nothing to add, so a render is only
 * ever caused by the line actually changing.
 */
export function enqueue(queue: ThoughtQueue, incoming: Thought[], now: number): ThoughtQueue {
  if (incoming.length === 0) return queue;
  let pending = [...queue.pending, ...incoming];
  let showing = queue.showing;
  if (showing === null) {
    const head = pending.shift() as Thought;
    showing = { thought: head, until: now + dwellMs(head.text) };
  }
  if (pending.length > PENDING_MAX) pending = pending.slice(-PENDING_MAX);
  return { showing, pending };
}

/**
 * Retire the current thought once its dwell has elapsed.
 *
 * With nothing waiting the line goes **empty** rather than keeping the last
 * sentence: a session that has moved on to undescribed work is not still doing
 * what the line says.
 */
export function advance(queue: ThoughtQueue, now: number): ThoughtQueue {
  const showing = queue.showing;
  if (showing === null || now < showing.until) return queue;
  const [head, ...rest] = queue.pending;
  if (!head) return emptyQueue();
  return { showing: { thought: head, until: now + dwellMs(head.text) }, pending: rest };
}

/**
 * The sentence of the tool that is running right now, for the live chat's
 * in-flight chip.
 *
 * Not paced, and deliberately not part of the queue: the chip is bound to the
 * one call actually executing, so the honest text is that call's own sentence
 * or nothing.
 *
 * The lookup is newest-first over unresolved calls because the chip's only
 * handle on identity is the tool NAME — `ToolActivity` carries `toolName` and
 * `elapsedSeconds` and no id, since it is emitted at `content_block_start`,
 * where the SDK has not streamed the call's input yet (chat-runner.ts). The
 * sentence therefore arrives one message later, with the fully-formed
 * `sessions:chatMessage` — still before the tool runs.
 */
export function pendingToolThought(messages: ChatMessage[], toolName: string): string {
  const resolved = new Set<string>();
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'tool_result') resolved.add(block.toolUseId);
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const block = msg.content[j];
      if (block.type !== 'tool_use' || block.name !== toolName || resolved.has(block.id)) continue;
      return thoughtOf(block.input);
    }
  }
  return '';
}
