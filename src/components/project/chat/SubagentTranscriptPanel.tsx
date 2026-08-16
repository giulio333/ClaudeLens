import { useMemo, useState } from 'react';
import { useSubagentTranscript } from '../../../hooks/useIPC';
import { buildProcessedMessages, ToolGroup } from './utils';
import { MessageBubble } from './MessageBubble';
import { ToolDetailPanel } from './ToolDetailPanel';
import { QueryError } from '../../QueryError';

/** Full internal transcript of a single sub-agent, opened from the agent rail.
 *  Reuses the same MessageBubble pipeline as the main chat so the delegated
 *  work reads exactly like a session of its own. */
export function SubagentTranscriptPanel({
  hash,
  sessionFilename,
  agentId,
  subagentType,
  description,
  prompt,
  onBack,
  chromeless,
}: {
  hash: string;
  sessionFilename: string;
  agentId: string;
  subagentType: string;
  description: string;
  /** The dispatch prompt shown above the transcript for context (may be truncated). */
  prompt?: string;
  onBack: () => void;
  /** Hosted in a frame that carries the agent's crumb and the way back in its
   *  own top bar: drop the local back button, keep the identity line. */
  chromeless?: boolean;
}) {
  const {
    data: messages,
    isLoading,
    isError,
    error,
    refetch,
  } = useSubagentTranscript(hash, sessionFilename, agentId);
  const [selectedTool, setSelectedTool] = useState<ToolGroup | null>(null);
  const processed = useMemo(() => (messages ? buildProcessedMessages(messages) : []), [messages]);

  if (selectedTool) {
    return <ToolDetailPanel group={selectedTool} onBack={() => setSelectedTool(null)} />;
  }

  return (
    <div className="cl-subagent-panel">
      <header className="cl-subagent-panel-head">
        {!chromeless && (
          <button
            type="button"
            className="cl-subagent-back"
            onClick={onBack}
            aria-label="Back to chat"
          >
            <span aria-hidden>←</span>
            <span>Back</span>
          </button>
        )}
        <div className="cl-subagent-head-id">
          <span className="ic" aria-hidden>
            A
          </span>
          <span className="chip">{subagentType}</span>
          {description && <span className="desc">{description}</span>}
        </div>
      </header>

      <main className="cl-subagent-feed">
        {isError ? (
          <QueryError
            title="Failed to load agent transcript"
            error={error}
            onRetry={() => refetch()}
          />
        ) : isLoading ? (
          <p className="cl-transcript-state">Loading agent transcript…</p>
        ) : (
          <div className="cl-transcript-inner">
            {prompt && (
              <div
                className="cl-turn cl-subagent-prompt"
                style={{ '--turn-role-color': 'var(--cl-ink)' } as React.CSSProperties}
              >
                <div className="cl-turn-rail">
                  <span className="cl-turn-orb" aria-hidden>
                    P
                  </span>
                </div>
                <div className="cl-turn-body">
                  <div className="cl-turn-head">
                    <span className="cl-turn-who cl-mono">Prompt</span>
                  </div>
                  <p>{prompt}</p>
                </div>
              </div>
            )}
            {processed.length === 0 ? (
              <p className="cl-transcript-state">No internal messages recorded for this agent.</p>
            ) : (
              processed.map((p, i) => (
                <MessageBubble
                  key={p.msg.uuid || i}
                  processed={p}
                  detailsFilter="all"
                  onOpenToolDetail={setSelectedTool}
                  turnIndex={i + 1}
                />
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
