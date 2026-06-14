import { useCallback, useMemo, useRef, useState } from 'react'
import { SessionSummary, ChatMessage, ToolActivity } from '../../../hooks/useIPC'
import { TopBar } from '../shared/TopBar'
import { buildProcessedMessages } from './utils'
import { ChatComposer } from './ChatComposer'
import { MessageBubble } from './MessageBubble'
import { LiveTurn } from './ChatView'
import { useChatAutoScroll } from './useAutoScroll'

/** Start a new Claude Code session from inside ClaudeLens. Renders the empty
 *  Focus layout with a composer in new-chat mode: the first message starts a new
 *  SDK session with a pre-generated id (surfaced via `onChatStarted`), and once
 *  the turn closes we hand a minimal `SessionSummary` to the parent so it can
 *  open the real `chat` view — from there the session is indistinguishable from
 *  any other (resume composer, transcript, export…).
 *
 *  During the turn the transcript is built entirely from the SDK stream: an
 *  optimistic bubble for the prompt + the fully-formed messages the SDK emits
 *  (`liveMessages`), run through the same processing pipeline as a real session,
 *  with a trailing `LiveTurn` for the assistant text still streaming in.
 *
 *  The summary is intentionally minimal (zeroed token/cost fields): `ChatView`
 *  loads the actual transcript from disk via `useChatSession`, and the file
 *  watcher refetches the sessions list so the real metadata fills in. We seed
 *  `firstUserMessage` from the sent text purely so the title isn't "Untitled". */
export function NewChatView({
  project,
  onBack,
  onCreated,
}: {
  project: { hash: string; realPath: string }
  onBack: () => void
  onCreated: (session: SessionSummary) => void
}) {
  // Captured during the turn, read on completion (closures over state would be
  // stale inside the composer's done handler).
  const createdIdRef = useRef<string | null>(null)
  const firstMessageRef = useRef('')
  const [pendingAt, setPendingAt] = useState('')
  const [liveText, setLiveText] = useState('')
  const [streaming, setStreaming] = useState(false)
  // The tool currently being prepared/executed in the live turn (null = none).
  const [liveTool, setLiveTool] = useState<ToolActivity | null>(null)
  // The just-sent message, echoed as a user turn the moment it leaves the
  // composer — the SDK only streams the assistant's reply, so without this the
  // empty canvas shows Claude answering before the prompt ever appears.
  const [sentText, setSentText] = useState('')
  // Fully-formed messages streamed from the SDK during the turn (assistant turns
  // + tool results), lifted up from the composer. Mirrored in a ref so the
  // turn-complete handler reads the final value, not a stale closure.
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([])
  const liveMessagesRef = useRef<ChatMessage[]>([])
  const handleLiveMessages = useCallback((msgs: ChatMessage[]) => {
    liveMessagesRef.current = msgs
    setLiveMessages(msgs)
  }, [])
  // Keep the growing first turn in view (same bottom-pinning as ChatView).
  const { feedRef, innerRef, onScroll, onWheel } = useChatAutoScroll(project.hash)

  // The in-flight turn, assembled and run through the same processing pipeline as
  // a real transcript so tools/thinking render live and correctly structured.
  const processed = useMemo(() => {
    if (!sentText) return []
    const synthetic: ChatMessage = {
      uuid: '__pending_user__',
      role: 'user',
      timestamp: pendingAt,
      content: [{ type: 'text', text: sentText }],
    }
    return buildProcessedMessages([synthetic, ...liveMessages])
  }, [sentText, pendingAt, liveMessages])

  return (
    <div className="cl-chat">
      <TopBar onBack={onBack} backLabel="Sessions" crumbs={[{ label: 'New chat', accent: true }]} />

      <div className="cl-chat-workspace cl-chat-workspace--focus" data-composer>
        <main className="cl-chat-feed" ref={feedRef} onScroll={onScroll} onWheel={onWheel}>
          <div className="cl-chat-reading">
            <div className="cl-transcript-inner" ref={innerRef}>
              {sentText ? (
                <>
                  {processed.map((p, i) => (
                    <MessageBubble
                      key={`${i}:${p.msg.uuid}`}
                      processed={p}
                      // New chat has no Min/Full toggle; default to minimal so the
                      // live turn shows the prompt + assistant text but not the
                      // raw tool cards (Bash/Read/…), matching ChatView's default.
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
                  from then on it behaves like any other session.
                </p>
              )}
            </div>
          </div>
        </main>

        <ChatComposer
          realPath={project.realPath}
          onStreamChange={setLiveText}
          onStreamingChange={setStreaming}
          onLiveMessagesChange={handleLiveMessages}
          onLiveToolChange={setLiveTool}
          onSend={text => {
            firstMessageRef.current = text
            setPendingAt(new Date().toISOString())
            liveMessagesRef.current = []
            setLiveMessages([])
            setSentText(text)
          }}
          onSendFailed={() => {
            // The send never started a turn — back to the empty canvas; the
            // composer keeps the error visible.
            setSentText('')
          }}
          onStarted={id => {
            createdIdRef.current = id
          }}
          onTurnComplete={() => {
            const id = createdIdRef.current
            // The id is minted eagerly (before the turn runs), so it alone
            // doesn't prove anything got written. A turn that produced no
            // message — failed before any output, or stopped immediately —
            // would navigate to a transcript that may not exist on disk,
            // hiding the composer's error. Stay put instead.
            if (!id || liveMessagesRef.current.length === 0) return
            onCreated({
              filename: `${id}.jsonl`,
              date: new Date().toISOString(),
              inputTokens: 0,
              outputTokens: 0,
              cacheWriteTokens: 0,
              cacheReadTokens: 0,
              totalTokens: 0,
              estimatedCost: 0,
              cacheSavings: 0,
              messageCount: 0,
              models: {},
              firstUserMessage: firstMessageRef.current,
            })
          }}
        />
      </div>
    </div>
  )
}
