import type { SessionAgent } from './utils'

function fmtSpan(startedAt?: string, endedAt?: string): string | null {
  if (!startedAt || !endedAt) return null
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(s % 60).padStart(2, '0')}s`
}

function fmtClock(ts?: string): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Right-hand activity rail listing every sub-agent spawned in the session.
 *  The agent whose dispatch sits at/above the current scroll position is
 *  highlighted — mirroring how Claude Code surfaces the running agent live.
 *  Click opens the agent's internal transcript; the locate button jumps to its
 *  dispatch card in the chat. */
export function AgentRail({
  agents,
  activeKey,
  onOpen,
  onLocate,
}: {
  agents: SessionAgent[]
  activeKey: string | null
  onOpen: (agent: SessionAgent) => void
  onLocate: (turnN: number) => void
}) {
  return (
    <aside className="cl-agent-rail" aria-label="Session agents">
      <div className="cl-agent-rail-head">
        <span className="t">Agents</span>
        <span className="c">{agents.length}</span>
      </div>
      <div className="cl-agent-rail-list">
        {agents.map(a => {
          const span = fmtSpan(a.startedAt, a.endedAt)
          const hasTranscript = a.agentId !== null
          return (
            <div
              key={a.key}
              className="cl-agent-rail-row"
              data-active={activeKey === a.key || undefined}
              data-error={a.isError || undefined}
            >
              <button
                type="button"
                className="cl-agent-rail-main"
                onClick={() => (hasTranscript ? onOpen(a) : onLocate(a.turnN))}
                title={hasTranscript ? 'View agent transcript' : 'Locate dispatch in chat'}
              >
                <span className="glyph" aria-hidden>A</span>
                <span className="body">
                  <span className="row">
                    <span className="name">{a.subagentType}</span>
                    <span className="status">{a.isError ? 'failed' : 'done'}</span>
                  </span>
                  {a.description && <span className="desc">{a.description}</span>}
                  <span className="meta">
                    {a.startedAt && (
                      <span className="time">
                        {fmtClock(a.startedAt)}
                        {span && <> · {span}</>}
                      </span>
                    )}
                    {typeof a.messageCount === 'number' && (
                      <span className="steps">{a.messageCount} steps</span>
                    )}
                    {!hasTranscript && <span className="steps">no transcript</span>}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="cl-agent-rail-locate"
                onClick={() => onLocate(a.turnN)}
                title="Jump to dispatch in chat"
                aria-label="Jump to dispatch in chat"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 2v9" />
                  <path d="M4.5 7.5 8 11l3.5-3.5" />
                  <path d="M3 13h10" />
                </svg>
              </button>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
