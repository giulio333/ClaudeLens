import { useMemo, useState } from 'react'
import { useSubagentTranscript } from '../../../hooks/useIPC'
import { buildProcessedMessages, ToolGroup } from './utils'
import { MessageBubble } from './MessageBubble'
import { ToolDetailPanel } from './ToolDetailPanel'
import { QueryError } from '../../QueryError'

/** Full internal transcript of a single sub-agent, opened from the agent rail.
 *  Reuses the same MessageBubble pipeline as the main chat so the delegated
 *  work reads exactly like a session of its own. */
export function SubagentTranscriptPanel({
  hash,
  sessionFilename,
  agentId,
  subagentType,
  description,
  onBack,
}: {
  hash: string
  sessionFilename: string
  agentId: string
  subagentType: string
  description: string
  onBack: () => void
}) {
  const { data: messages, isLoading, isError, error, refetch } = useSubagentTranscript(
    hash,
    sessionFilename,
    agentId,
  )
  const [selectedTool, setSelectedTool] = useState<ToolGroup | null>(null)
  const processed = useMemo(() => (messages ? buildProcessedMessages(messages) : []), [messages])

  if (selectedTool) {
    return <ToolDetailPanel group={selectedTool} onBack={() => setSelectedTool(null)} />
  }

  return (
    <div className="cl-subagent-panel">
      <header className="cl-subagent-panel-head">
        <button type="button" className="cl-subagent-back" onClick={onBack} aria-label="Back to chat">
          <span aria-hidden>←</span>
          <span>Back</span>
        </button>
        <div className="cl-subagent-head-id">
          <span className="ic" aria-hidden>A</span>
          <span className="chip">{subagentType}</span>
          {description && <span className="desc">{description}</span>}
        </div>
      </header>

      <main className="cl-subagent-feed">
        {isError ? (
          <QueryError title="Failed to load agent transcript" error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <p className="cl-transcript-state">Loading agent transcript…</p>
        ) : processed.length === 0 ? (
          <p className="cl-transcript-state">No internal messages recorded for this agent.</p>
        ) : (
          <div className="cl-transcript-inner">
            {processed.map((p, i) => (
              <MessageBubble
                key={p.msg.uuid || i}
                processed={p}
                detailsFilter="all"
                onOpenToolDetail={setSelectedTool}
                turnIndex={i + 1}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
