import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatMessage, ToolActivity } from '../../../hooks/useIPC';

// The bare command name from a slash prompt the user sent (e.g. "/context …" →
// "context"); null when the prompt isn't a slash command.
function slashCommandOf(prompt: string): string | null {
  const m = /^\/([\w:-]+)/.exec(prompt.trim());
  return m ? m[1] : null;
}

// The bare command name from a persisted command-card user message (the message
// Claude Code writes as `<command-name>/context</command-name> …`); null otherwise.
function cardCommandOf(msg: ChatMessage): string | null {
  if (msg.role !== 'user') return null;
  const text = msg.content.find(b => b.type === 'text');
  if (!text || text.type !== 'text') return null;
  const m = /<command-name>\s*\/?\s*([\w:-]+)\s*<\/command-name>/.exec(text.text);
  return m ? m[1] : null;
}

/** Handlers the chat composer pushes its live SDK stream into. */
export type LiveTurnComposerHandlers = {
  /** A new turn was sent — snapshot history and show the optimistic prompt bubble. */
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
  /** The messages actually rendered — disk transcript when idle, or the
   *  pre-turn snapshot + optimistic prompt + streamed messages while in-flight,
   *  with any pinned slash-command output woven back in. */
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
 * The in-flight turn state machine, lifted out of ChatView. Drives the live
 * transcript entirely from the SDK stream (not a mid-stream disk re-read):
 *
 * - While a turn is active (`pendingUser !== null`) `displayMessages` is the
 *   pre-turn history snapshot (`frozenMessages`) + an optimistic prompt bubble +
 *   the fully-formed messages the SDK emits (`liveMessages`). The file watcher
 *   still refetches `messages` in the background, but it's ignored for display
 *   until the turn closes, so the persisted reply can't double the live one.
 * - On completion (`!streaming` AND the refetch grew past the count captured at
 *   send time) it reconciles to the canonical disk read.
 * - Built-in slash commands (/context, /usage, /compact, …) stream their real
 *   output as `<synthetic>`-model messages that Claude Code never persists. They
 *   are pinned (`pinnedSlash`) keyed by the UUID of the on-disk command-card that
 *   produced them and woven back in right after that card, so they survive the
 *   reconcile for as long as the view is mounted.
 */
export function useLiveTurn(messages: ChatMessage[] | undefined): LiveTurnState {
  const [liveText, setLiveText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [liveTool, setLiveTool] = useState<ToolActivity | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [pendingAt, setPendingAt] = useState('');
  const pendingBaseCount = useRef(0);
  const [frozenMessages, setFrozenMessages] = useState<ChatMessage[] | null>(null);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [pinnedSlash, setPinnedSlash] = useState<Record<string, ChatMessage[]>>({});

  // Reconcile to the canonical disk read once the turn has ended AND the refetch
  // contains it (length grew past the count captured at send time). We gate on
  // `!streaming` so background mid-stream refetches never tear down the live turn.
  // When both hold, the persisted transcript already has the full turn, so
  // dropping the optimistic state is seamless.
  useEffect(() => {
    if (streaming) return;
    if (pendingUser === null) return;
    if ((messages?.length ?? 0) > pendingBaseCount.current) {
      // If the just-finished turn was a built-in slash command, its real output
      // streamed as `<synthetic>` messages that Claude Code never persists. Bind
      // them to the command-card now on disk so they survive the reconcile,
      // anchored under the exact card that produced them. The card we just created
      // is the last command-card matching this command name.
      const cmd = slashCommandOf(pendingUser);
      const synth = cmd ? liveMessages.filter(m => m.model === '<synthetic>') : [];
      if (cmd && synth.length) {
        const base = messages ?? [];
        let cardUuid: string | null = null;
        for (let i = base.length - 1; i >= 0; i--) {
          if (cardCommandOf(base[i]) === cmd) {
            cardUuid = base[i].uuid;
            break;
          }
        }
        if (cardUuid) {
          const key = cardUuid;
          // Reconcile-time state sync (the turn just landed on disk), not a render
          // loop: pin once, guarded by the existing key.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setPinnedSlash(prev => (prev[key] ? prev : { ...prev, [key]: synth }));
        }
      }
      setPendingUser(null);
      setFrozenMessages(null);
      setLiveMessages([]);
    }
  }, [streaming, messages, pendingUser, liveMessages]);

  // The messages actually rendered. Idle: the live disk transcript. In-flight: the
  // pre-turn snapshot + an optimistic prompt bubble + the streamed messages.
  // Both branches weave the pinned slash-command output back in right after the
  // command-card that produced it (addressed by that card's UUID, set at reconcile
  // time), so a pinned `/context` doesn't vanish for the duration of the next turn.
  const displayMessages = useMemo<ChatMessage[]>(() => {
    const weave = (base: ChatMessage[]): ChatMessage[] => {
      if (Object.keys(pinnedSlash).length === 0) return base;
      const woven: ChatMessage[] = [];
      for (const m of base) {
        woven.push(m);
        const pinned = pinnedSlash[m.uuid];
        if (pinned) woven.push(...pinned);
      }
      return woven;
    };
    if (pendingUser === null) return weave(messages ?? []);
    const synthetic: ChatMessage = {
      uuid: '__pending_user__',
      role: 'user',
      timestamp: pendingAt,
      content: [{ type: 'text', text: pendingUser }],
    };
    return [...weave(frozenMessages ?? messages ?? []), synthetic, ...liveMessages];
  }, [pendingUser, pendingAt, frozenMessages, messages, liveMessages, pinnedSlash]);

  // Reads the freshest `messages` at call time — re-binds when the transcript
  // refetches, matching the optimistic snapshot to what's actually on disk.
  const onSend = useCallback(
    (text: string) => {
      const base = messages ?? [];
      pendingBaseCount.current = base.length;
      setPendingAt(new Date().toISOString());
      setFrozenMessages(base);
      setLiveMessages([]);
      setPendingUser(text);
    },
    [messages]
  );

  const onSendFailed = useCallback(() => {
    // The send never became a turn — roll back the optimistic bubble and the
    // frozen snapshot so the transcript shows the disk truth.
    setPendingUser(null);
    setFrozenMessages(null);
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
