import { useMemo, useState } from 'react'
import { useWorkflowRun } from '../../../hooks/useIPC'
import type { WorkflowAgentRow, WorkflowRunDetail } from '../../../types'
import { TopBar } from '../shared/TopBar'
import { StatChip } from '../shared/StatChip'
import { SubagentTranscriptPanel } from '../chat/SubagentTranscriptPanel'
import { QueryError } from '../../QueryError'
import { fmt, fmtDate, fmtModel, modelColor } from '../utils'
import { fmtDuration, statusTone } from './utils'

type Project = { hash: string; realPath: string }

function StatusPill({ status, degraded }: { status: string; degraded: boolean }) {
  const tone = statusTone(status, degraded)
  return (
    <span className={`cl-wf-pill cl-mono ${tone}`}>
      <i />
      {degraded ? 'RECOVERED' : status.toUpperCase()}
    </span>
  )
}

function stateGlyph(state: string): string {
  if (state === 'done') return '✓'
  if (state === 'error' || state === 'failed') return '✕'
  if (state === 'running') return '◍'
  return '·'
}

function agentStats(agent: WorkflowAgentRow): string {
  const parts: string[] = []
  if (agent.tokens) parts.push(`${fmt(agent.tokens)} tok`)
  if (agent.toolCalls) parts.push(`${agent.toolCalls} tools`)
  if (agent.durationMs) parts.push(fmtDuration(agent.durationMs))
  return parts.join(' · ')
}

export function WorkflowRunDetailView({
  project,
  sessionId,
  runId,
  onBack,
}: {
  project: Project
  sessionId: string
  runId: string
  onBack: () => void
}) {
  const { data: run, isLoading, isError, error, refetch } = useWorkflowRun(project.hash, sessionId, runId)
  const [transcriptAgent, setTranscriptAgent] = useState<{ agentId: string; label: string; prompt?: string } | null>(null)

  if (transcriptAgent) {
    // Host wrapper: SubagentTranscriptPanel is `flex:1; min-height:0` and is
    // normally embedded inside ChatView's flex column — mounted bare it can't
    // scroll and its header collides with the macOS traffic lights. The host
    // gives it a full-height flex context and a left gutter for the buttons.
    return (
      <div className="cl-wf-transcript-host h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
        <SubagentTranscriptPanel
          hash={project.hash}
          sessionFilename={`${run?.sessionId ?? sessionId}.jsonl`}
          agentId={transcriptAgent.agentId}
          subagentType="workflow-subagent"
          description={transcriptAgent.label}
          prompt={transcriptAgent.prompt}
          onBack={() => setTranscriptAgent(null)}
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar
        onBack={onBack}
        backLabel="Workflows"
        crumbs={[{ label: run?.workflowName || runId, accent: true }]}
      />
      <div className="flex-1 overflow-y-auto">
        {isError ? (
          <div className="cl-section" style={{ paddingTop: 32 }}>
            <QueryError title="Failed to load workflow run" error={error} onRetry={() => refetch()} />
          </div>
        ) : isLoading ? (
          <div className="cl-empty" style={{ marginTop: 40 }}>Loading workflow run…</div>
        ) : !run ? (
          <div className="cl-empty" style={{ marginTop: 40 }}>Workflow run not found.</div>
        ) : (
          <RunBody run={run} onOpenTranscript={(a) => setTranscriptAgent({ agentId: a.agentId, label: a.label, prompt: a.promptPreview })} />
        )}
      </div>
    </div>
  )
}

function RunBody({
  run,
  onOpenTranscript,
}: {
  run: WorkflowRunDetail
  onOpenTranscript: (agent: WorkflowAgentRow) => void
}) {
  const duration = fmtDuration(run.durationMs)

  // Group agents under their phase, preserving phase order; unmatched → "Other".
  const groups = useMemo(() => {
    const byPhase = new Map<number, WorkflowAgentRow[]>()
    for (const a of run.agents) {
      const arr = byPhase.get(a.phaseIndex) ?? []
      arr.push(a)
      byPhase.set(a.phaseIndex, arr)
    }
    const out: { title: string; detail?: string; agents: WorkflowAgentRow[] }[] = []
    run.phases.forEach((p, i) => {
      // Phase indices seen live are 1-based; tolerate 0-based too.
      const agents = byPhase.get(i + 1) ?? byPhase.get(i) ?? []
      byPhase.delete(i + 1)
      byPhase.delete(i)
      out.push({ title: p.title, detail: p.detail, agents })
    })
    const leftover = [...byPhase.values()].flat()
    if (leftover.length) out.push({ title: 'Other', agents: leftover })
    return out
  }, [run.agents, run.phases])

  return (
    <>
      <header className="cl-wf-dhead">
        <div className="cl-wf-dhead-eyebrow cl-mono">
          <span className="dot" />
          Workflow run · {run.runId}
        </div>
        <div className="cl-wf-dhead-titlerow">
          <h1>{run.workflowName || 'Unnamed workflow'}</h1>
          <StatusPill status={run.status} degraded={run.degraded} />
          {run.args && <span className="cl-wf-args cl-mono">{run.args}</span>}
        </div>
        {run.summary && <p className="cl-wf-dhead-summary">{run.summary}</p>}
        <div className="cl-wf-dhead-meta cl-mono">
          <span>{fmtDate(new Date(run.startTime).toISOString())}</span>
          {run.taskId && (
            <>
              <span className="sep">·</span>
              <span>task {run.taskId}</span>
            </>
          )}
        </div>
        <div className="cl-wf-statgrid">
          <StatChip label="Agents" value={String(run.agentCount)} />
          {run.errorAgentCount > 0 && <StatChip label="Errored" value={String(run.errorAgentCount)} accent />}
          <StatChip label="Phases" value={String(run.phaseCount)} />
          {duration && <StatChip label="Duration" value={duration} />}
          {run.totalTokens > 0 && <StatChip label="Tokens" value={fmt(run.totalTokens)} />}
          {run.totalToolCalls > 0 && <StatChip label="Tool calls" value={String(run.totalToolCalls)} />}
          {run.defaultModel && <StatChip label="Model" value={fmtModel(run.defaultModel)} />}
        </div>
      </header>

      {run.degraded && (
        <section className="cl-section" style={{ paddingTop: 24, paddingBottom: 0 }}>
          <div className="cl-wf-banner cl-mono">
            Run state file not found — showing recovered transcripts only.
          </div>
          {(run.orphanAgentIds?.length ?? 0) > 0 && (
            <div className="cl-wf-rows" style={{ marginTop: 14 }}>
              {run.orphanAgentIds!.map(id => (
                <div key={id} className="cl-wf-agent-row is-muted">
                  <div className="cl-wf-agent-head">
                    <span className="cl-wf-agent-glyph is-muted">·</span>
                    <span className="cl-wf-agent-label cl-mono">{id}</span>
                    <button
                      type="button"
                      className="cl-wf-agent-open cl-mono"
                      onClick={() => onOpenTranscript({ agentId: id, label: id } as WorkflowAgentRow)}
                    >
                      view transcript →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="cl-wf-phases">
        {groups.map((g, gi) => {
          const reached = g.agents.length > 0
          return (
            <section key={gi} className={`cl-wf-phase${reached ? '' : ' is-empty'}`}>
              <div className="cl-wf-phase-head">
                <span className="cl-wf-phase-idx cl-mono">{String(gi + 1).padStart(2, '0')}</span>
                <div className="cl-wf-phase-titlewrap">
                  <h2>{g.title}</h2>
                  {g.detail && <p className="cl-wf-phase-detail">{g.detail}</p>}
                </div>
                <span className="cl-wf-phase-ct cl-mono">
                  {reached ? `${g.agents.length} ${g.agents.length === 1 ? 'agent' : 'agents'}` : 'not reached'}
                </span>
              </div>
              {reached && (
                <div className="cl-wf-rows cl-wf-ledger">
                  {g.agents.map((a, ai) => (
                    <AgentRow key={a.agentId || ai} agent={a} onOpenTranscript={onOpenTranscript} />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {(run.logs.length > 0 || run.result != null || run.script) && (
        <section className="cl-section cl-wf-artifacts">
          {run.logs.length > 0 && (
            <details className="cl-wf-collapse">
              <summary className="cl-mono">Logs <span className="ct">{run.logs.length}</span></summary>
              <pre className="cl-wf-pre cl-mono">{run.logs.join('\n')}</pre>
            </details>
          )}
          {run.result != null && (
            <details className="cl-wf-collapse">
              <summary className="cl-mono">Result</summary>
              <pre className="cl-wf-pre cl-mono">
                {typeof run.result === 'string' ? run.result : JSON.stringify(run.result, null, 2)}
              </pre>
            </details>
          )}
          {run.script && (
            <details className="cl-wf-collapse">
              <summary className="cl-mono">Workflow script</summary>
              <pre className="cl-wf-pre cl-mono">{run.script}</pre>
              {run.scriptPath && <p className="cl-wf-scriptpath cl-mono">{run.scriptPath}</p>}
            </details>
          )}
        </section>
      )}
    </>
  )
}

function AgentRow({
  agent,
  onOpenTranscript,
}: {
  agent: WorkflowAgentRow
  onOpenTranscript: (agent: WorkflowAgentRow) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const tone = agent.state === 'error' || agent.state === 'failed' ? 'error' : agent.state === 'done' ? 'ok' : 'muted'
  const stats = agentStats(agent)
  const canDrill = agent.agentId.length > 0
  const canExpand = Boolean(agent.promptPreview || agent.resultPreview || agent.lastToolName)

  return (
    <div className={`cl-wf-agent-row is-${tone}${expanded ? ' is-expanded' : ''}`}>
      <div
        className="cl-wf-agent-head"
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : undefined}
        onClick={() => canExpand && setExpanded(v => !v)}
        onKeyDown={e => {
          if (canExpand && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            setExpanded(v => !v)
          }
        }}
      >
        <span className="cl-wf-agent-chev cl-mono">{canExpand ? (expanded ? '▾' : '▸') : ''}</span>
        <span className={`cl-wf-agent-glyph is-${tone}`}>{stateGlyph(agent.state)}</span>
        <span
          className="cl-wf-agent-dot"
          style={{ background: modelColor(agent.model) }}
          title={fmtModel(agent.model)}
        />
        <span className="cl-wf-agent-label">{agent.label || agent.agentId || 'agent'}</span>
        {agent.attempt > 1 && <span className="cl-wf-agent-attempt cl-mono">retry {agent.attempt}</span>}
        {stats && <span className="cl-wf-agent-stats cl-mono">{stats}</span>}
        {canDrill && (
          <button
            type="button"
            className="cl-wf-agent-open cl-mono"
            onClick={e => {
              e.stopPropagation()
              onOpenTranscript(agent)
            }}
          >
            view transcript →
          </button>
        )}
      </div>

      {agent.error && (
        <div className="cl-wf-agent-err cl-mono">
          <span className="ic">⚠</span>
          {agent.error}
        </div>
      )}

      {expanded && (
        <div className="cl-wf-agent-detail">
          {agent.lastToolName && (
            <div className="cl-wf-kv cl-mono">
              <span className="k">last tool</span>
              <span className="v">
                {agent.lastToolName}
                {agent.lastToolSummary ? ` — ${agent.lastToolSummary}` : ''}
              </span>
            </div>
          )}
          {agent.promptPreview && (
            <div className="cl-wf-preview">
              <span className="lbl cl-mono">prompt</span>
              <pre className="cl-wf-pre cl-mono">{agent.promptPreview}</pre>
            </div>
          )}
          {canDrill && (
            <div className="cl-wf-agent-footer cl-mono">
              <button type="button" className="cl-wf-agent-fulltx" onClick={() => onOpenTranscript(agent)}>
                Open full transcript →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
