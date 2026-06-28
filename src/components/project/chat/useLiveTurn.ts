import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatMessage, ToolActivity } from '../../../hooks/useIPC';

/** Handlers the chat composer pushes its live SDK stream into. */
export type LiveTurnComposerHandlers = {
  /** A new turn was sent — show the optimistic prompt bubble. */
  onSend: (text: string) => void;
  /** The send never became a turn — roll back the optimistic state. */
  onSendFailed: () => void;
  /** Partial assistant text delta (`sessions:chatChunk`). */
  onStreamChange: (text: string) => void;
  /** Turn streaming on/off (`sessions:chatDone` / start). */
  onStreamingChange: (streaming: boolean) => void;
  /** Fully-formed messages the SDK emits as it works (`sessions:chatMessage`). */
  onLiveMessagesChange: (messages: ChatMessage[]) => void;
  /** The tool being prepared/executed (`sessions:chatToolActivity`), or null. */
  onLiveToolChange: (tool: ToolActivity | null) => void;
};

export type LiveTurnState = {
  /** The messages actually rendered. Disk transcript in Terminal/Lens
   *  (read-only); the in-memory stream transcript + the in-flight turn in the
   *  in-app SDK chat. */
  displayMessages: ChatMessage[];
  /** Partial assistant text for the provisional `LiveTurn`. */
  liveText: string;
  /** Tool currently being prepared/executed in the live turn, or null. */
  liveTool: ToolActivity | null;
  /** Whether a turn is streaming right now. */
  streaming: boolean;
  /** Count of fully-formed messages received so far this turn (drives the
   *  decision to keep the provisional `LiveTurn` visible before the first one). */
  liveMessageCount: number;
  /** Handlers wired into the composer's stream callbacks. */
  composer: LiveTurnComposerHandlers;
};

/**
 * The in-flight turn state machine, lifted out of ChatView.
 *
 * Two modes, by `streamAsTruth`:
 *
 * - **`false` (Terminal/Lens, read-only embedded):** there is no composer; the
 *   live session belongs to the terminal's PTY. `displayMessages` is just the
 *   disk transcript (`messages`), so the watcher keeps the view fresh as the
 *   terminal writes. Nothing here runs.
 *
 * - **`true` (in-app SDK chat):** the SDK stream is the source of truth. The disk
 *   is read **once** (seeded into `sessionMessages` from the handed-off new-chat
 *   transcript or the first loaded disk read) and then **ignored for display** —
 *   no mid-write reconcile, so the reply the user watched stream in can never
 *   blink out and back. Each finished turn is **appended** to `sessionMessages`
 *   straight from the stream: the optimistic user bubble (the SDK doesn't echo
 *   the prompt) plus the fully-formed messages the SDK emitted — including the
 *   `<synthetic>` slash-command output (`/context`, `/usage`, `/compact`) that
 *   Claude Code never persists, which therefore survives naturally with no
 *   special pinning.
 */
export function useLiveTurn(
  messages: ChatMessage[] | undefined,
  opts: { streamAsTruth: boolean; initialMessages?: ChatMessage[] }
): LiveTurnState {
  const { streamAsTruth, initialMessages } = opts;
  const [liveText, setLiveText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [liveTool, setLiveTool] = useState<ToolActivity | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [pendingAt, setPendingAt] = useState('');
  // Stable uuid for the optimistic prompt bubble — reused when the bubble is
  // materialized into `sessionMessages` at turn end, so it keeps its identity
  // across the turn boundary (no remount/flash of the user message).
  const [pendingUuid, setPendingUuid] = useState('');
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  // Stream-as-truth in-memory transcript (in-app SDK chat only). Seeded once,
  // then grown ONLY from the stream — never re-read from disk, so a mid-write
  // watcher refetch can't tear the live reply out from under us.
  const [sessionMessages, setSessionMessages] = useState<ChatMessage[] | null>(null);
  // Did the in-flight turn actually start streaming yet? Guards the turn-end
  // append against firing in the gap between `onSend` and `streaming` flipping
  // true: the composer flips `sending`/streaming one commit AFTER our optimistic
  // `onSend` (cross-component), so right after a send there's a render with
  // `pendingUser` set but `streaming` still false. Without this guard that render
  // looks like "turn ended", committing just the user bubble and dropping the
  // reply that streams in next.
  const sawStreamingRef = useRef(false);
  useEffect(() => {
    if (streaming) sawStreamingRef.current = true;
  }, [streaming]);

  // Seed the in-memory transcript once: prefer the messages handed off from the
  // new-chat view (turn 1, so ChatView paints immediately without waiting on a
  // disk read), else the first loaded disk transcript (a resumed/existing
  // session). Disk (`messages`) is ignored for display from here on.
  useEffect(() => {
    if (!streamAsTruth) return;
    if (sessionMessages !== null) return;
    if (initialMessages && initialMessages.length > 0) {
      // One-time seed (not a render loop), guarded by the `null` check above.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessionMessages(initialMessages);
    } else if (messages !== undefined) {
      setSessionMessages(messages);
    }
  }, [streamAsTruth, sessionMessages, initialMessages, messages]);

  // Turn end (`!streaming` after a send): append the streamed turn to the
  // in-memory transcript. The SDK doesn't echo the user's prompt, so materialize
  // it from the optimistic bubble (same uuid), then the fully-formed stream
  // messages (deduped by uuid for safety). No disk round-trip.
  useEffect(() => {
    if (!streamAsTruth) return;
    if (streaming) return;
    if (pendingUser === null) return;
    // The turn hasn't actually started streaming — this is the post-send gap, not
    // the end. Wait for the real true→false transition.
    if (!sawStreamingRef.current) return;
    sawStreamingRef.current = false;
    const userMsg: ChatMessage = {
      uuid: pendingUuid,
      role: 'user',
      timestamp: pendingAt,
      content: [{ type: 'text', text: pendingUser }],
    };
    // Turn-end state sync (the stream just closed), not a render loop: guarded by
    // `pendingUser`, which this effect immediately clears.
    setSessionMessages(prev => {
      const base = prev ?? [];
      const seen = new Set(base.map(m => m.uuid));
      const turn = [userMsg, ...liveMessages].filter(m => !seen.has(m.uuid));
      return [...base, ...turn];
    });
    setPendingUser(null);
    setLiveMessages([]);
  }, [streamAsTruth, streaming, pendingUser, pendingAt, pendingUuid, liveMessages]);

  // The messages actually rendered. Terminal/Lens: the live disk transcript.
  // In-app SDK chat: the in-memory transcript, plus — while a turn is in flight —
  // the optimistic prompt bubble and the streamed messages.
  const displayMessages = useMemo<ChatMessage[]>(() => {
    if (!streamAsTruth) return messages ?? [];
    const base = sessionMessages ?? [];
    if (pendingUser === null) return base;
    const optimisticUser: ChatMessage = {
      uuid: pendingUuid,
      role: 'user',
      timestamp: pendingAt,
      content: [{ type: 'text', text: pendingUser }],
    };
    return [...base, optimisticUser, ...liveMessages];
  }, [streamAsTruth, messages, sessionMessages, pendingUser, pendingUuid, pendingAt, liveMessages]);

  const onSend = useCallback((text: string) => {
    sawStreamingRef.current = false;
    setPendingAt(new Date().toISOString());
    setPendingUuid(crypto.randomUUID());
    setLiveMessages([]);
    setPendingUser(text);
  }, []);

  const onSendFailed = useCallback(() => {
    // The send never became a turn — drop the optimistic bubble; `sessionMessages`
    // (the committed transcript) is untouched.
    setPendingUser(null);
    setLiveMessages([]);
  }, []);

  const composer = useMemo<LiveTurnComposerHandlers>(
    () => ({
      onSend,
      onSendFailed,
      onStreamChange: setLiveText,
      onStreamingChange: setStreaming,
      onLiveMessagesChange: setLiveMessages,
      onLiveToolChange: setLiveTool,
    }),
    [onSend, onSendFailed]
  );

  return {
    displayMessages,
    liveText,
    liveTool,
    streaming,
    liveMessageCount: liveMessages.length,
    composer,
  };
}
