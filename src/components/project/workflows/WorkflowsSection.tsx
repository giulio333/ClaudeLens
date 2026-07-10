import { useMemo } from 'react'
import { useProjectWorkflows, useSessionList } from '../../../hooks/useIPC'
import type { SessionSummary, WorkflowRunSummary } from '../../../types'
import { QueryError } from '../../QueryError'
import { fmt, fmtDate, fmtModel, sessionTitle } from '../utils'
import { fmtDuration, statusTone } from './utils'

type Project = { hash: string; realPath: string }

function StatusPill({ status, degraded }: { status: string; degraded: boolean }) {
  const tone = statusTone(status, degraded)
  const label = degraded ? 'RECOVERED' : status.toUpperCase()
  return (
    <span className={`cl-wf-pill cl-mono ${tone}`}>
      <i />
      {label}
    </span>
  )
}

export function WorkflowsSection({
  project,
  onOpenChat,
  onOpenRun,
}: {
  project: Project
  onOpenChat: (session: SessionSummary) => void
  onOpenRun: (sessionId: string, runId: string) => void
}) {
  const { data: groups = [], isLoading, isError, error, refetch } = useProjectWorkflows(project.hash)
  const { data: sessions = [] } = useSessionList(project.hash)

  const sessionByFilename = useMemo(() => {
    const map = new Map<string, SessionSummary>()
    for (const s of sessions) map.set(s.filename, s)
    return map
  }, [sessions])

  const totalRuns = groups.reduce((n, g) => n + g.runs.length, 0)

  return (
    <section className="cl-section cl-wf" style={{ paddingTop: 38 }}>
      <div className="cl-wf-head">
        <div className="cl-wf-title-wrap">
          <h2>Workflows</h2>
          <span className="cl-wf-sub cl-mono">
            {totalRuns} {totalRuns === 1 ? 'run' : 'runs'} · {groups.length}{' '}
            {groups.length === 1 ? 'session' : 'sessions'}
          </span>
        </div>
      </div>

      <div className="cl-wf-body">
        {isError ? (
          <QueryError title="Failed to load workflow runs" error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="cl-empty">Loading workflow runs…</div>
        ) : groups.length === 0 ? (
          <div className="cl-empty">
            No workflow runs recorded for this project. Workflows are produced by Claude Code's
            multi-agent orchestration (e.g. <span className="cl-mono">/code-review</span> at high
            effort).
          </div>
        ) : (
          groups.map(g => {
            const session = sessionByFilename.get(g.filename)
            const name = session ? sessionTitle(session) : g.sessionId.slice(0, 8)
            const date = g.runs[0]?.startTime ?? 0
            return (
              <section key={g.sessionId} className="cl-wf-group">
                <div className="cl-wf-eyebrow cl-mono">
                  <span className="dot" />
                  <span className="name">{name}</span>
                  <span className="meta">
                    {g.runs.length} {g.runs.length === 1 ? 'run' : 'runs'}
                    {date ? ` · ${fmtDate(new Date(date).toISOString())}` : ''}
                    {session && (
                      <button type="button" className="open" onClick={() => onOpenChat(session)}>
                        open chat ↗
                      </button>
                    )}
                  </span>
                </div>

                <div className="cl-wf-rows">
                  {g.runs.map(run => (
                    <RunRow key={run.runId} run={run} onOpen={() => onOpenRun(g.sessionId, run.runId)} />
                  ))}
                </div>
              </section>
            )
          })
        )}
      </div>
    </section>
  )
}

function RunRow({ run, onOpen }: { run: WorkflowRunSummary; onOpen: () => void }) {
  const duration = fmtDuration(run.durationMs)
  const stats: string[] = []
  stats.push(`${run.agentCount} ${run.agentCount === 1 ? 'agent' : 'agents'}`)
  if (run.phaseCount) stats.push(`${run.phaseCount} ${run.phaseCount === 1 ? 'phase' : 'phases'}`)
  if (duration) stats.push(duration)
  if (run.totalTokens) stats.push(`${fmt(run.totalTokens)} tok`)
  if (run.totalToolCalls) stats.push(`${run.totalToolCalls} tools`)
  if (run.defaultModel) stats.push(fmtModel(run.defaultModel))

  return (
    <div
      className={`cl-wf-row tone-${statusTone(run.status, run.degraded)}${run.degraded ? ' is-degraded' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="cl-wf-row-body">
        <div className="cl-wf-title-line">
          <span className="cl-wf-name">{run.workflowName || 'Unnamed workflow'}</span>
          <StatusPill status={run.status} degraded={run.degraded} />
          {run.args && <span className="cl-wf-args cl-mono">{run.args}</span>}
          {run.errorAgentCount > 0 && (
            <span className="cl-wf-pill cl-mono error">
              <i />
              {run.errorAgentCount} {run.errorAgentCount === 1 ? 'agent' : 'agents'} errored
            </span>
          )}
        </div>
        <div className="cl-wf-stats cl-mono">
          {stats.map((s, i) => (
            <span key={i}>
              {i > 0 && <span className="sep">·</span>}
              {s}
            </span>
          ))}
        </div>
        {run.degraded && (
          <p className="cl-wf-degraded-note cl-mono">Run state missing — transcripts only.</p>
        )}
      </div>
      <div className="cl-wf-row-aside cl-mono">
        <span className="cl-wf-runid">{run.runId}</span>
        <span className="cl-wf-chev">→</span>
      </div>
    </div>
  )
}
