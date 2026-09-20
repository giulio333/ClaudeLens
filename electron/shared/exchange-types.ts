// The exchange a message between sessions belongs to (#280) — the one type
// definition shared by `electron/modules/session-exchange.ts` and the renderer,
// like `chat-types.ts`. Nothing here touches `fs`, so `src/types.ts` re-exports
// it as is.

/** What the app asks for: the message the user clicked, by the transcript the
 *  click came from and the id both halves carry (`origin.msg_id` on the row it
 *  landed on, `toolUseResult.msg_id` on the result of the call that sent it). */
export interface ExchangeRequest {
  /** The transcript id of the session whose chat is on screen — either side:
   *  the receiver when opened from the inbound bubble, the sender from the
   *  outbound one. */
  sessionId: string;
  msgId: string;
}

/** One session taking part in an exchange. `id` is the key the messages refer
 *  to: the session id when the transcript was found, otherwise the hop
 *  fingerprint (`fp:…`) — a sender whose own transcript is gone is still one
 *  party, not "unknown" on every row. */
export interface ExchangeParty {
  id: string;
  sessionId?: string;
  projectHash?: string;
  /** The project's real cwd when it could be resolved; absent = unnamed rather
   *  than misnamed, the same rule search results follow. */
  projectPath?: string;
  sessionTitle?: string;
  /** The name this session declared when it last sent something. Sender-supplied
   *  and unstable — a label, never an identity. */
  name?: string;
  /** The 24-hex fingerprint Claude Code writes into `hopChain` for this session.
   *  Learned from the join: a session's own transcript never states it. */
  fingerprint?: string;
}

export interface ExchangeMessage {
  msgId: string;
  /** Party ids. */
  from: string;
  to: string;
  /** When it ARRIVED — the receiver's row is the half every message here has. */
  timestamp: string;
  text: string;
  /** The one-line summary the sender gave the call, when its transcript was found. */
  summary?: string;
  /** The assistant turn that made the `SendMessage` call, in the sender's
   *  transcript — absent when that transcript was not found. */
  sentTurnUuid?: string;
  /** The row it landed on in the receiver's transcript: the inbound bubble. */
  receivedUuid: string;
  /** The hop chain as party ids, in order and with repeats: a path, not a set. */
  hops?: string[];
  /** Arrived while the receiver was mid-turn, and was absorbed into it. */
  queued?: true;
}

export interface ExchangeOutcome {
  entryMsgId: string;
  parties: ExchangeParty[];
  /** Every message between the entry's two parties, oldest first. */
  messages: ExchangeMessage[];
  /** Transcripts considered, so the page can say what the answer rests on. */
  scanned: number;
  elapsedMs: number;
}
