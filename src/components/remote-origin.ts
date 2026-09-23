// The machine a transcript on screen was read from, when it is not this one
// (#294). Set by the Remote view around its Lens; absent everywhere else, where
// everything renders exactly as before.
//
// It exists for the few leaves that open a file by the path a message names —
// an image linked by path — which would otherwise read THIS machine's file at
// that path. The host's folder layout is often the same as this one's, so the
// wrong file would be found and drawn as if it were the right one.
import { createContext, useContext } from 'react';
import type { ChatMessage, SessionSummary } from '../types';

export const RemoteOriginContext = createContext<string | null>(null);

/** The remote host's name, or null for a transcript of this machine. */
export function useRemoteOrigin(): string | null {
  return useContext(RemoteOriginContext);
}

/**
 * A transcript read from another machine, handed to the views that normally
 * read one from this machine's disk (`ChatView`, `MissionRail`). With it set,
 * those views read nothing about the project here — skill and agent
 * definitions, configuration, tasks, teams, memory, wikilinks — because the
 * host's folder is often the same path as a local one, and they would then show
 * this machine's data as the session's.
 */
export interface RemoteTranscript {
  /** The host the session runs on, for what the views say about it. */
  hostName: string;
  messages: ChatMessage[];
  /** The registry status on the host (`busy`, `waiting`, `idle`), or null. */
  status: string | null;
  /** Figures read from the transcript, for the spend the pill and rail print. */
  summary: SessionSummary | null;
}
