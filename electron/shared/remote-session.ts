// What Lens and Mission Control know about the session a remote pane is
// running (#294), as the main process hands it to the renderer. Shared so the
// two sides agree on the one shape; like the rest of the remote layer it is
// additive — nothing local reads it, and removing the layer removes it.
//
// The session runs on the host, so its registry entry and its transcript are
// there. A second ssh channel reads them (`remote-watch.ts`) and the rows are
// kept in memory only: they are another machine's work, and nothing here is
// written to this one's disk.

import type { ChatMessage } from './chat-types';

/**
 * Where the reading stands.
 *
 * - `starting`: the pane is up, Claude Code has not been launched yet (the
 *   login, the version check).
 * - `connecting`: the second channel is opening.
 * - `prompt`: ssh is asking something on that channel — a password, a code —
 *   which only a second login does; `RemoteLensState.prompt` holds the question.
 * - `searching`: the host is being asked which session is this pane's.
 * - `ambiguous`: more than one session on the host could be it, and none is
 *   picked.
 * - `waiting`: the session is known and has no transcript yet, which is normal
 *   until its first prompt.
 * - `live`: the transcript is being read.
 * - `ended`: Claude Code on the host is gone.
 * - `failed`: the channel closed or never opened; `detail` says why.
 */
export type RemoteLensPhase =
  | 'starting'
  | 'connecting'
  | 'prompt'
  | 'searching'
  | 'ambiguous'
  | 'waiting'
  | 'live'
  | 'ended'
  | 'failed';

/**
 * How the second channel reaches the host. `shared` rides the terminal's own
 * connection (OpenSSH `ControlMaster`), so nothing is asked twice; `separate` is
 * a second login, which a password or 2FA user answers again — a Windows client
 * has no `ControlMaster`, and the UI says which one is in use instead of hiding
 * it.
 */
export type RemoteLensChannel = 'shared' | 'separate';

/** The figures the rail and the pill print for a session, read from the
 *  transcript itself — structurally a `SessionSummary`, which the renderer
 *  takes it as. */
export interface RemoteSessionSummary {
  filename: string;
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  estimatedCost: number;
  cacheSavings: number;
  messageCount: number;
  model?: string;
  models: Record<string, number>;
  agentName?: string;
  customTitle?: string;
  aiTitle?: string;
  firstUserMessage?: string;
}

export interface RemoteLensState {
  /** The remote pane this reading belongs to (`terminal:createRemote`'s id). */
  terminalId: string;
  phase: RemoteLensPhase;
  channel: RemoteLensChannel;
  /** What ssh printed while asking, while `phase` is `prompt`. */
  prompt: string | null;
  /** Why the reading failed, or how many sessions made it ambiguous. */
  detail: string | null;
  /** The session's folder as the host resolved it, once the channel says. */
  cwd: string | null;
  sessionId: string | null;
  /** The registry status on the host: `busy`, `waiting`, `idle`. */
  status: string | null;
  messages: ChatMessage[];
  summary: RemoteSessionSummary | null;
  /** Bumped on every change, so a late snapshot never replaces a newer push. */
  revision: number;
}
