import { useCallback, useMemo, useRef, useState } from 'react'
import { ChatMessage, ToolActivity, ChatTurnSummary } from '../../../hooks/useIPC'
import { TopBar } from '../shared/TopBar'
import { buildProcessedMessages } from './utils'
import { ChatComposer } from './ChatComposer'
import { MessageBubble } from './MessageBubble'
import { LiveTurn } from './LiveTurn'
import { useChatAutoScroll } from './useAutoScroll'
import { fmt, fmtCost, fmtModel } from '../utils'
import { trackEvent } from '../../../lib/telemetry'

/** The in-app SDK chat — a brand-new Claude Code conversation driven entirely by
 *  the Agent SDK stream, with **no disk reads**. This is the deliberate split from
 *  `ChatView` (which is now a read-only, disk-backed viewer of existing sessions):
 *
 *  - The transcript is an in-memory `sessionMessages` array that starts empty and
 *    grows **only from the stream** — at each turn's end we append the optimistic
 *    user bubble (the SDK doesn't echo the prompt) plus the fully-formed messages
 *    the SDK emitted. The `.jsonl` the SDK writes is never read back here.
 *  - **One live SDK session for the whole conversation.** The composer is mounted
 *    once (no `key`) and is handed the session id as soon as the SDK reports it
 *    (`onStarted`); the first send starts the session (`startMessage`), every later
 *    send rides that same warm session (`sendMessage` → push, not a disk resume).
 *    We never navigate away mid-conversation, so the session stays alive until the
 *    user leaves (unmount → the composer's `endChat` disposes it).
 *  - Running cost/tokens/model come from the SDK's end-of-turn `result` summary
 *    (`onTurnComplete`), not from the transcript file.
 *
 *  Trade-off (by design — "leaner but cleaner"): the rich reading affordances
 *  (export, highlights, timeline, tags) live in `ChatView`. To get them for this
 *  conversation the user leaves and reopens the session, which then loads
 *  read-only from disk. */
export function LiveChatView({
  project,
  onBack,
}: {
  project: { hash: string; realPath: string }
  onBack: () => void
}) {
  // The SDK session id, known once the first turn starts (null until then). Handed
  // to the composer so turns 2+ push into the live session instead of resuming.
  const [sessionId, setSessionId] = useState<string | null>(null)
  // The committed transcript — grown ONLY from the stream, never read from disk.
  const [sessionMessages, setSessionMessages] = useState<ChatMessage[]>([])
  // The just-sent prompt, shown optimistically (the SDK streams only the reply).
  const [pendingUser, setPendingUser] = useState<string | null>(null)
  const [pendingAt, setPendingAt] = useState('')
  // Stable uuid for the optimistic bubble, reused when it's committed at turn end.
  const [pendingUuid, setPendingUuid] = useState('')
  // Live turn stream, lifted from the composer.
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([])
  const [liveText, setLiveText] = useState('')
  const [liveTool, setLiveTool] = useState<ToolActivity | null>(null)
  const [streaming, setStreaming] = useState(false)
  // Running cost/token/model summary from the SDK's `result` (cumulative).
  const [summary, setSummary] = useState<ChatTurnSummary | null>(null)
  // First prompt — titles the view once sent.
  const [firstPrompt, setFirstPrompt] = useState('')

  // Refs mirror the in-flight turn so the commit reads the latest values
  // synchronously. The commit runs in the composer's `onTurnComplete` (chatDone)
  // callback — a cross-component hop where closing over React state could be one
  // render stale, which is exactly how a just-streamed reply gets dropped.
  const liveMessagesRef = useRef<ChatMessage[]>([])
  const pendingRef = useRef<{ text: string; at: string; uuid: string } | null>(null)

  // Mirror the streamed messages into both state (for live display) and a ref
  // (for the commit). Lifted from the composer on every `sessions:chatMessage`.
  const handleLiveMessages = useCallback((msgs: ChatMessage[]) => {
    liveMessagesRef.current = msgs
    setLiveMessages(msgs)
  }, [])

  // Commit the finished turn to the in-memory transcript, straight from the
  // stream (no disk): the optimistic user bubble (same uuid) + the streamed
  // messages, deduped by uuid. `chatDone` is the authoritative turn-end signal;
  // reading the refs (not state) sidesteps the cross-component timing of watching
  // `streaming`, which could commit before the reply landed.
  const commitTurn = useCallback(() => {
    const pending = pendingRef.current
    if (!pending) return
    const userMsg: ChatMessage = {
      uuid: pending.uuid,
      role: 'user',
      timestamp: pending.at,
      content: [{ type: 'text', text: pending.text }],
    }
    setSessionMessages(prev => {
      const seen = new Set(prev.map(m => m.uuid))
      const turn = [userMsg, ...liveMessagesRef.current].filter(m => !seen.has(m.uuid))
      return [...prev, ...turn]
    })
    pendingRef.current = null
    liveMessagesRef.current = []
    setPendingUser(null)
    setLiveMessages([])
  }, [])

  // What we render: the committed transcript, plus — while a turn is in flight —
  // the optimistic prompt and the streamed messages.
  const displayMessages = useMemo<ChatMessage[]>(() => {
    if (pendingUser === null) return sessionMessages
    const optimisticUser: ChatMessage = {
      uuid: pendingUuid,
      role: 'user',
      timestamp: pendingAt,
      content: [{ type: 'text', text: pendingUser }],
    }
    return [...sessionMessages, optimisticUser, ...liveMessages]
  }, [sessionMessages, pendingUser, pendingUuid, pendingAt, liveMessages])

  const processed = useMemo(() => buildProcessedMessages(displayMessages), [displayMessages])

  // Keep the growing conversation pinned to the bottom (same as ChatView). Keyed
  // by the stable project hash — the session id arrives mid-life and must not
  // re-key the scroller.
  const { feedRef, innerRef, onScroll, onWheel } = useChatAutoScroll(project.hash)

  const title = firstPrompt
    ? firstPrompt.length > 48
      ? `${firstPrompt.slice(0, 48)}…`
      : firstPrompt
    : 'New chat'

  return (
    <div className="cl-chat">
      <TopBar
        onBack={onBack}
        backLabel="Sessions"
        crumbs={[{ label: title, accent: true }]}
        right={
          summary ? (
            <span
              className="font-mono"
              title="Cost and tokens for this conversation (from the SDK, not the transcript file)"
              style={{ fontSize: 11, color: 'var(--cl-ink-4)', whiteSpace: 'nowrap' }}
            >
              {fmtCost(summary.totalCostUsd)} · {fmt(summary.inputTokens)} in ·{' '}
              {fmt(summary.outputTokens)} out
              {summary.models.length > 0 && ` · ${summary.models.map(fmtModel).join(', ')}`}
            </span>
          ) : undefined
        }
      />

      <div className="cl-chat-workspace cl-chat-workspace--focus" data-composer>
        <main className="cl-chat-feed" ref={feedRef} onScroll={onScroll} onWheel={onWheel}>
          <div className="cl-chat-reading">
            <div className="cl-transcript-inner" ref={innerRef}>
              {pendingUser !== null || sessionMessages.length > 0 ? (
                <>
                  {processed.map((p, i) => (
                    <MessageBubble
                      key={`${i}:${p.msg.uuid}`}
                      processed={p}
                      // No Min/Full toggle in the live chat; default to minimal so
                      // it shows prompts + assistant text but not raw tool cards,
                      // matching ChatView's default density.
                      detailsFilter="minimal"
                      onOpenToolDetail={() => {}}
                      turnIndex={i + 1}
                    />
                  ))}
                  {streaming &&
                    (liveText !== '' || liveTool !== null || liveMessages.length === 0) && (
                      <LiveTurn text={liveText} tool={liveTool} turnNumber={processed.length + 1} />
                    )}
                </>
              ) : (
                <p className="cl-transcript-state">
                  Start a new session in this project. Your first message creates the transcript —
                  it streams live here and is saved to disk (readable later in the terminal or as a
                  read-only session), but this view never reloads it from disk.
                </p>
              )}
            </div>
          </div>
        </main>

        <ChatComposer
          realPath={project.realPath}
          // Undefined on the first send (→ startMessage); once the SDK reports the
          // id we pass it so later sends push into the same live session. No `key`,
          // so this prop change never remounts the composer (a remount would
          // dispose the session and force a disk resume on the next send).
          sessionId={sessionId ?? undefined}
          onStarted={id => {
            setSessionId(id)
            trackEvent('chat_started')
          }}
          onTurnComplete={s => {
            // chatDone: record metadata, then commit the streamed turn from the
            // refs (the reply is already in `liveMessagesRef`).
            if (s) setSummary(s)
            commitTurn()
          }}
          onSend={text => {
            if (!firstPrompt) setFirstPrompt(text)
            const at = new Date().toISOString()
            const uuid = crypto.randomUUID()
            pendingRef.current = { text, at, uuid }
            liveMessagesRef.current = []
            setPendingAt(at)
            setPendingUuid(uuid)
            setLiveMessages([])
            setLiveText('')
            setLiveTool(null)
            setPendingUser(text)
          }}
          onSendFailed={() => {
            // The send never became a turn — drop the optimistic bubble; the
            // committed transcript is untouched.
            pendingRef.current = null
            liveMessagesRef.current = []
            setPendingUser(null)
            setLiveMessages([])
          }}
          onStreamChange={setLiveText}
          onStreamingChange={setStreaming}
          onLiveMessagesChange={handleLiveMessages}
          onLiveToolChange={setLiveTool}
        />
      </div>
    </div>
  )
}
