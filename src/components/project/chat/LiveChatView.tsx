import { useMemo } from 'react'
import { TopBar } from '../shared/TopBar'
import { buildProcessedMessages } from './utils'
import { ChatComposer } from './ChatComposer'
import { MessageBubble } from './MessageBubble'
import { LiveTurn } from './LiveTurn'
import { useChatAutoScroll } from './useAutoScroll'
import { useLiveChat } from './useLiveChat'
import { fmt, fmtCost, fmtModel } from '../utils'

/** The in-app SDK chat — a brand-new Claude Code conversation driven entirely by
 *  the Agent SDK stream, with **no disk reads**. This is the deliberate split from
 *  `ChatView` (which is a read-only, disk-backed viewer of existing sessions).
 *
 *  All conversation state lives in `useLiveChat` — the single owner of the IPC
 *  subscriptions, the in-flight turn and the committed transcript. This view is
 *  rendering only: the transcript feed, the trailing live turn, the running
 *  cost/token summary in the TopBar, and the presentational `ChatComposer`.
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
  const chat = useLiveChat(project.realPath)

  const processed = useMemo(
    () => buildProcessedMessages(chat.displayMessages),
    [chat.displayMessages]
  )

  // Keep the growing conversation pinned to the bottom (same as ChatView). Keyed
  // by the stable project hash — the session id arrives mid-life and must not
  // re-key the scroller.
  const { feedRef, innerRef, onScroll, onWheel } = useChatAutoScroll(project.hash)

  // First prompt titles the view once sent (optimistic bubble included).
  const firstPrompt = useMemo(() => {
    for (const m of chat.displayMessages) {
      if (m.role !== 'user') continue
      const text = m.content.find(b => b.type === 'text')
      if (text && text.type === 'text') return text.text
    }
    return ''
  }, [chat.displayMessages])

  const title = firstPrompt
    ? firstPrompt.length > 48
      ? `${firstPrompt.slice(0, 48)}…`
      : firstPrompt
    : 'New chat'

  const summary = chat.summary

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
              {chat.hasConversation ? (
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
                  {chat.streaming &&
                    (chat.streamText !== '' ||
                      chat.liveTool !== null ||
                      chat.liveMessages.length === 0) && (
                      <LiveTurn
                        text={chat.streamText}
                        tool={chat.liveTool}
                        turnNumber={processed.length + 1}
                      />
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
          // Undefined on the first send (→ startMessage); once the SDK reports
          // the id, later sends push into the same live session.
          sessionId={chat.sessionId ?? undefined}
          sending={chat.streaming}
          errorText={chat.errorText}
          permRequest={chat.permRequest}
          permPendingCount={chat.permPendingCount}
          onRespondPermission={chat.respondPermission}
          onSend={(text, opts) => void chat.send(text, opts)}
          onStop={chat.stop}
        />
      </div>
    </div>
  )
}
