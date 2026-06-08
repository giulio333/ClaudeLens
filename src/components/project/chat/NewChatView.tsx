import { useRef } from 'react'
import { SessionSummary } from '../../../hooks/useIPC'
import { TopBar } from '../shared/TopBar'
import { ChatComposer } from './ChatComposer'

/** Start a new Claude Code session from inside ClaudeLens. Renders the empty
 *  Focus layout with a composer in new-chat mode: the first message spawns
 *  `claude -p` (no --resume), Claude mints a fresh session id (surfaced via
 *  `onChatStarted`), and once the turn closes we hand a minimal `SessionSummary`
 *  to the parent so it can open the real `chat` view — from there the session is
 *  indistinguishable from any other (resume composer, transcript, export…).
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

  return (
    <div className="cl-chat">
      <TopBar onBack={onBack} backLabel="Sessions" crumbs={[{ label: 'New chat', accent: true }]} />

      <div className="cl-chat-workspace cl-chat-workspace--focus" data-composer>
        <main className="cl-chat-feed">
          <div className="cl-chat-reading">
            <div className="cl-transcript-inner">
              <p className="cl-transcript-state">
                Start a new session in this project. Your first message creates the
                transcript — from then on it behaves like any other session.
              </p>
            </div>
          </div>
        </main>

        <ChatComposer
          realPath={project.realPath}
          onSend={text => {
            firstMessageRef.current = text
          }}
          onStarted={id => {
            createdIdRef.current = id
          }}
          onTurnComplete={() => {
            const id = createdIdRef.current
            if (!id) return // turn failed before a session was minted — stay put
            onCreated({
              filename: `${id}.jsonl`,
              date: new Date().toISOString(),
              inputTokens: 0,
              outputTokens: 0,
              cacheWriteTokens: 0,
              cacheReadTokens: 0,
              totalTokens: 0,
              estimatedCost: 0,
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
