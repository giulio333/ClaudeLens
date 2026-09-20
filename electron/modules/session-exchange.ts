// The exchange a message between sessions belongs to, joined on `msg_id` (#280).
//
// A message one session sends another is written twice and read by nobody as a
// pair: the sender's transcript holds the `SendMessage` tool result with a
// `msg_id`, the receiver's holds a row whose `origin.msg_id` is that same value
// (#274 draws the receiving side; the sending side is a tool card). The two
// halves sit in different transcript directories — often different projects —
// which is exactly what makes the exchange invisible: reconstructing it means
// knowing which sessions to open and reading each in order.
//
// There is deliberately no index, for the reason `session-search` gives: an
// index would have to be invalidated by every append of every live session.
// Instead the scan reads every transcript and rejects on the raw substring
// `"msg_id"` before parsing a line — on the machine this was written on, 5 of
// 329 transcripts survive the reject — and remembers each file's halves under
// its size+mtime stamp, so the next answer stats every file and re-reads only
// the ones that grew. That is what lets the page refetch on `data:changed`
// without a pass over the corpus behind every append.
//
// Only TOP-LEVEL fields count as a half: `toolUseResult.msg_id` on the row and
// `origin.msg_id` on the row (or on a `queued_command` attachment). A transcript
// that quotes another — a `Read` of a `.jsonl`, a grep over `~/.claude` — has
// the id inside a string, and `JSON.parse` leaves it there.
//
// What an exchange IS: the conversation between two sessions, every message
// between the pair in arrival order. Not the hop chain — `origin.hopChain` is a
// causal path (a reply sent from inside the turn a message started inherits
// that message's chain and appends the sender's fingerprint; a reply the user
// asked for later opens a fresh chain), so one human conversation spans several
// chains and a session appears twice in one as soon as it answers an answer.
// The chain is kept and shown as the path it is; the pair is what threads.
//
// A hop fingerprint is opaque: it derives from neither the session id, the pid,
// the socket nor the name (all tried), and a session's own transcript never
// states its own. It is learned from the join — a received row's last hop IS
// its sender, and the sender's half names the session — which is also what
// keeps a sender whose transcript is gone attributable: by fingerprint, with
// the name it declared, and never as "unknown" on every row.
import { readFile } from 'fs/promises';
import { basename, join } from 'path';
import { glob } from 'glob';
import { listProjectSessionFiles } from './session-files';
import { fileStamp } from './session-read-cache';
import { parseInbound, soleToolResultId } from './transcript-extras';
import { readSessionTitle } from './transcript-tail';
import type {
  ExchangeMessage,
  ExchangeOutcome,
  ExchangeParty,
  ExchangeRequest,
} from '../shared/exchange-types';

/** The sender's half: the row `SendMessage`'s result was written on. */
export interface SentHalf {
  msgId: string;
  /** The assistant row holding the call — what the sender's chat scrolls to. */
  turnUuid?: string;
  timestamp: string;
  /** The recipient as the sender addressed it: a declared name, not an identity. */
  to?: string;
  summary?: string;
}

/** The receiver's half: the row the message landed on. */
export interface ReceivedHalf {
  msgId: string;
  uuid: string;
  timestamp: string;
  text: string;
  name?: string;
  pid?: number;
  hopChain?: string[];
  queued?: true;
}

export interface ExchangeHalves {
  sent: SentHalf[];
  received: ReceivedHalf[];
}

export interface ExchangeStats {
  /** Transcripts listed. */
  scanned: number;
  /** Transcripts read from disk — the ones whose stamp changed. */
  read: number;
  /** Of those, the ones that survived the raw reject and were parsed. */
  parsed: number;
}

/** The one substring every half carries. `"origin"` alone is on every typed
 *  prompt; `"msg_id"` is on nothing else. */
const HALF_NEEDLE = '"msg_id"';
/** The call the sender's half answers, where `summary` and `to` live. */
const CALL_NEEDLE = '"name":"SendMessage"';

const EMPTY: ExchangeHalves = { sent: [], received: [] };

interface CacheEntry {
  stamp: string;
  hash: string;
  sessionId: string;
  file: string;
  halves: ExchangeHalves;
}

/** By transcript path. Values are a handful of halves, so no bound is needed —
 *  the corpus-wide total is the number of messages ever exchanged. */
const cache = new Map<string, CacheEntry>();
let stats: ExchangeStats = { scanned: 0, read: 0, parsed: 0 };
/** The refresh in flight, so a `data:changed` refetch landing on one joins it
 *  instead of racing it over the same files — the coalescing `StampCache`
 *  does for the session readers. */
let inFlight: Promise<void> | null = null;

export function resetExchangeCache(): void {
  cache.clear();
  stats = { scanned: 0, read: 0, parsed: 0 };
  inFlight = null;
}

export function exchangeStats(): ExchangeStats {
  return { ...stats };
}

/** `to`/`summary` of every `SendMessage` call in an assistant row, by tool id. */
function collectCalls(message: unknown, into: Map<string, { to?: string; summary?: string }>) {
  const content = (message as Record<string, unknown> | undefined)?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type !== 'tool_use' || b.name !== 'SendMessage' || typeof b.id !== 'string') continue;
    const input = (b.input ?? {}) as Record<string, unknown>;
    const to = typeof input.to === 'string' ? input.to : undefined;
    const summary = typeof input.summary === 'string' ? input.summary : undefined;
    into.set(b.id, { ...(to ? { to } : {}), ...(summary ? { summary } : {}) });
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

/**
 * Both halves a transcript holds. Pure, one pass, tolerant: the file is written
 * by another program and a line that will not parse is a line skipped.
 */
export function parseExchangeHalves(raw: string): ExchangeHalves {
  const sent: (SentHalf & { toolUseId?: string })[] = [];
  const received: ReceivedHalf[] = [];
  const calls = new Map<string, { to?: string; summary?: string }>();

  for (const line of raw.split('\n')) {
    if (!line) continue;
    const isCall = line.includes(CALL_NEEDLE);
    const isHalf = line.includes(HALF_NEEDLE);
    if (!isCall && !isHalf) continue;

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (isCall && json.type === 'assistant') collectCalls(json.message, calls);
    if (!isHalf) continue;

    const timestamp = String(json.timestamp ?? '');
    const uuid = str(json.uuid) ?? '';

    if (json.type === 'user') {
      const result = json.toolUseResult as Record<string, unknown> | undefined;
      const msgId = result && typeof result === 'object' ? str(result.msg_id) : undefined;
      if (msgId) {
        // `sourceToolAssistantUUID` is the row that made the call; `parentUuid`
        // is the same row on every transcript observed, and the fallback.
        const turnUuid = str(json.sourceToolAssistantUUID) ?? str(json.parentUuid);
        sent.push({
          msgId,
          ...(turnUuid ? { turnUuid } : {}),
          timestamp,
          toolUseId: soleToolResultId(json.message),
        });
        continue;
      }
      pushReceived(received, parseInbound(json.origin, false), uuid, timestamp);
      continue;
    }

    if (json.type === 'attachment') {
      const attachment = json.attachment as Record<string, unknown> | undefined;
      if (!attachment || attachment.type !== 'queued_command') continue;
      pushReceived(
        received,
        parseInbound(attachment.origin, true),
        uuid,
        String(attachment.timestamp ?? timestamp)
      );
    }
  }

  return {
    sent: sent.map(({ toolUseId, ...half }) => {
      const call = toolUseId ? calls.get(toolUseId) : undefined;
      return { ...half, ...(call ?? {}) };
    }),
    received,
  };
}

/** A received half, when the row is a message from another SESSION. An agent
 *  inside the receiving session is also written as `kind: "peer"`, and it is
 *  not a party to anything: `parseInbound` tells the two apart. */
function pushReceived(
  into: ReceivedHalf[],
  parsed: ReturnType<typeof parseInbound>,
  uuid: string,
  timestamp: string
) {
  if (!parsed || parsed.origin.from !== 'session') return;
  const { origin } = parsed;
  const msgId = origin.msgId;
  if (!msgId) return;
  into.push({
    msgId,
    uuid,
    timestamp,
    text: parsed.body,
    ...(origin.name ? { name: origin.name } : {}),
    ...(origin.pid !== undefined ? { pid: origin.pid } : {}),
    ...(origin.hopChain ? { hopChain: origin.hopChain } : {}),
    ...(origin.queued ? { queued: true as const } : {}),
  });
}

/**
 * Bring the cache up to date with the transcripts on disk: stat every file,
 * read the ones whose stamp moved, forget the ones that are gone. The listing
 * IS the complete set, so anything cached and unlisted is provably deleted.
 */
function refresh(projectsDir: string): Promise<void> {
  if (!inFlight) {
    inFlight = sweep(projectsDir).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function sweep(projectsDir: string): Promise<void> {
  stats = { scanned: 0, read: 0, parsed: 0 };
  const hashes = (await glob('[!.]*', { cwd: projectsDir })).sort();
  const seen = new Set<string>();

  for (const hash of hashes) {
    let files: string[];
    try {
      files = await listProjectSessionFiles(join(projectsDir, hash));
    } catch {
      // A project folder that vanished mid-scan is one project missing from
      // the answer, never the whole answer failing.
      continue;
    }
    for (const file of files) {
      stats.scanned++;
      seen.add(file);
      const stamp = await fileStamp(file);
      if (stamp === null) {
        // Not a regular file, or gone between the listing and the stat.
        cache.delete(file);
        continue;
      }
      const hit = cache.get(file);
      if (hit && hit.stamp === stamp) continue;

      stats.read++;
      let raw: string;
      try {
        raw = await readFile(file, 'utf-8');
      } catch {
        cache.delete(file);
        continue;
      }
      let halves = EMPTY;
      if (raw.includes(HALF_NEEDLE)) {
        stats.parsed++;
        halves = parseExchangeHalves(raw);
      }
      cache.set(file, {
        stamp,
        hash,
        sessionId: basename(file, '.jsonl'),
        file,
        halves,
      });
    }
  }

  for (const file of cache.keys()) if (!seen.has(file)) cache.delete(file);
}

/** A party id for a fingerprint nobody's transcript resolves. */
const fpId = (fp: string) => `fp:${fp}`;

/** The last hop of a received row is its sender's fingerprint. */
function lastHop(half: ReceivedHalf): string | undefined {
  const chain = half.hopChain;
  return chain && chain.length > 0 ? chain[chain.length - 1] : undefined;
}

/**
 * The exchange the requested message belongs to, or `null` when the message
 * `msgId` was not received by, nor sent from, the transcript named `sessionId`.
 *
 * Either half is an entry: the inbound bubble opens it from the receiver, the
 * outbound one from the sender. A message only ever sent — its receiver's
 * transcript gone, or never a session — is not in `messages` at all, so from
 * the sender it answers `null` like anything else that cannot be joined.
 */
export async function readExchange(
  projectsDir: string,
  request: ExchangeRequest,
  resolveProjectPath?: (hash: string) => string | undefined
): Promise<ExchangeOutcome | null> {
  const startedAt = Date.now();
  await refresh(projectsDir);
  const entries = [...cache.values()];

  const sentByMsgId = new Map<string, { half: SentHalf; entry: CacheEntry }>();
  for (const entry of entries)
    for (const half of entry.halves.sent) sentByMsgId.set(half.msgId, { half, entry });

  const received: { half: ReceivedHalf; entry: CacheEntry }[] = [];
  for (const entry of entries)
    for (const half of entry.halves.received) received.push({ half, entry });

  // The last hop of a received row is its sender, and the sender's half says
  // which session that is: one join teaches a fingerprint for every later row
  // that carries it, whether or not its own sender half is on disk. Half the
  // received rows on a real corpus carry no chain at all, though, and for those
  // the pid the receiver verified off the socket is the identity left — taught
  // by the same joins, but scoped to the receiver that verified it: a
  // fingerprint is a session's for good, a pid is recycled by the OS, and the
  // one place a pid provably names one process is a transcript that talked to
  // it.
  const fpToSession = new Map<string, string>();
  const sessionToFp = new Map<string, string>();
  const pidToSession = new Map<string, string>();
  const pidKey = (receiver: string, pid: number) => `${receiver}|${pid}`;
  for (const { half, entry } of received) {
    const sender = sentByMsgId.get(half.msgId);
    if (!sender) continue;
    const fp = lastHop(half);
    if (fp && !fpToSession.has(fp)) {
      fpToSession.set(fp, sender.entry.sessionId);
      sessionToFp.set(sender.entry.sessionId, fp);
    }
    if (half.pid !== undefined) {
      const key = pidKey(entry.sessionId, half.pid);
      if (!pidToSession.has(key)) pidToSession.set(key, sender.entry.sessionId);
    }
  }
  const partyOf = (fp: string) => fpToSession.get(fp) ?? fpId(fp);
  const senderOf = (half: ReceivedHalf, entry: CacheEntry): string => {
    const sender = sentByMsgId.get(half.msgId);
    if (sender) return sender.entry.sessionId;
    const fp = lastHop(half);
    if (fp && fpToSession.has(fp)) return fpToSession.get(fp)!;
    const byPid =
      half.pid !== undefined ? pidToSession.get(pidKey(entry.sessionId, half.pid)) : undefined;
    if (byPid) return byPid;
    return fp ? fpId(fp) : half.pid !== undefined ? `pid:${half.pid}` : 'unknown';
  };

  // The name a party declared, from the latest row anyone received from it —
  // a label that changes on its own, so the most recent one is the least wrong.
  const nameOf = new Map<string, { name: string; at: string }>();

  const messages: ExchangeMessage[] = received.map(({ half, entry }) => {
    const sender = sentByMsgId.get(half.msgId);
    const from = senderOf(half, entry);
    const known = nameOf.get(from);
    if (half.name && (!known || known.at < half.timestamp))
      nameOf.set(from, { name: half.name, at: half.timestamp });
    return {
      msgId: half.msgId,
      from,
      to: entry.sessionId,
      timestamp: half.timestamp,
      text: half.text,
      ...(sender?.half.summary ? { summary: sender.half.summary } : {}),
      ...(sender?.half.turnUuid ? { sentTurnUuid: sender.half.turnUuid } : {}),
      receivedUuid: half.uuid,
      ...(half.hopChain ? { hops: half.hopChain.map(partyOf) } : {}),
      ...(half.queued ? { queued: true as const } : {}),
    };
  });

  const entry = messages.find(
    m => m.msgId === request.msgId && (m.to === request.sessionId || m.from === request.sessionId)
  );
  if (!entry) return null;

  const pairKey = (m: ExchangeMessage) => [m.from, m.to].sort().join('|');
  const pair = pairKey(entry);
  const thread = messages
    .filter(m => pairKey(m) === pair)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const bySession = new Map(entries.map(e => [e.sessionId, e]));
  const partyIds = new Set<string>();
  for (const m of thread) {
    partyIds.add(m.from);
    partyIds.add(m.to);
    for (const hop of m.hops ?? []) partyIds.add(hop);
  }
  const parties: ExchangeParty[] = [...partyIds].map(id => {
    const session = bySession.get(id);
    const fingerprint = session
      ? sessionToFp.get(id)
      : id.startsWith('fp:')
        ? id.slice(3)
        : undefined;
    const name = nameOf.get(id)?.name;
    const projectPath = session ? resolveProjectPath?.(session.hash) : undefined;
    const sessionTitle = session ? readSessionTitle(session.file)?.title : undefined;
    return {
      id,
      ...(session ? { sessionId: session.sessionId, projectHash: session.hash } : {}),
      ...(projectPath ? { projectPath } : {}),
      ...(sessionTitle ? { sessionTitle } : {}),
      ...(name ? { name } : {}),
      ...(fingerprint ? { fingerprint } : {}),
    };
  });

  return {
    entryMsgId: entry.msgId,
    parties,
    messages: thread,
    scanned: stats.scanned,
    elapsedMs: Date.now() - startedAt,
  };
}
