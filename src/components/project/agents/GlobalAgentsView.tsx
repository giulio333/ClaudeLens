import { useGlobalAgents, useProjectAgents, Agent } from '../../../hooks/useIPC'
import { fmtModel } from '../utils'
import { Lens } from '../overview/Lens'

const GLYPHS = ['◐', '◑', '◒', '◓']

function AgentTile({ agent, index, onClick }: { agent: Agent; index: number; onClick: () => void }) {
  const mode = agent.disableModelInvocation ? 'manual' : 'auto'
  return (
    <button
      type="button"
      className={`cl-tile ${index === 0 ? 'accent' : ''}`}
      onClick={onClick}
    >
      <span className="glyph">{GLYPHS[index % GLYPHS.length]}</span>
      <div style={{ minWidth: 0 }}>
        <div className="t-name">{agent.name}</div>
        <div className="t-desc">{agent.description || '—'}</div>
      </div>
      <span className="t-meta">
        {agent.model ? `${fmtModel(agent.model)} · ` : ''}<b>{mode}</b>
      </span>
    </button>
  )
}

function TopBar({ onBack, crumb }: { onBack: () => void; crumb: string }) {
  return (
    <div
      className="shrink-0 flex items-center gap-3 border-b border-[var(--cl-line)]"
      style={{
        WebkitAppRegion: 'drag',
        background: 'var(--cl-paper)',
        height: 52,
        padding: '0 28px 0 88px',
      } as React.CSSProperties}
    >
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 font-mono uppercase transition-colors hover:text-[var(--cl-accent)]"
        style={{
          WebkitAppRegion: 'no-drag',
          fontSize: 11,
          letterSpacing: '0.18em',
          color: 'var(--cl-ink-3)',
          lineHeight: 1,
        } as React.CSSProperties}
      >
        <span>←</span>
        Back
      </button>
      <span style={{ color: 'var(--cl-ink-4)', fontSize: 11, lineHeight: 1 }}>/</span>
      <span
        className="font-mono uppercase truncate"
        style={{
          fontSize: 11,
          letterSpacing: '0.18em',
          color: 'var(--cl-ink-3)',
          lineHeight: 1,
        } as React.CSSProperties}
      >
        {crumb}
      </span>
    </div>
  )
}

export function GlobalAgentsView({
  onBack,
  onSelectAgent,
  onCreate,
  project,
}: {
  onBack: () => void
  onSelectAgent: (agent: Agent) => void
  onCreate: () => void
  project?: { hash: string; realPath: string }
}) {
  const projectName = project?.realPath.split('/').pop()
  const { data: globalAgents, isLoading: loadingGlobal } = useGlobalAgents()
  const { data: projectAgents, isLoading: loadingProject } = useProjectAgents(project?.realPath ?? null)

  const isLoading = project ? loadingGlobal || loadingProject : loadingGlobal

  const projectAgentList = projectAgents ?? []
  const globalAgentList = project
    ? (globalAgents ?? []).filter(g => !projectAgentList.some(p => p.name === g.name))
    : (globalAgents ?? [])
  const total = project ? projectAgentList.length + globalAgentList.length : globalAgentList.length

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumb={project ? `Project · Agents · ${projectName}` : 'Global · Agents'} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <Lens />
          <div className="cl-hero-actions">
            <button type="button" className="cl-btn cl-btn--primary" onClick={onCreate}>
              + New Agent
            </button>
          </div>
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>{project ? `Project · ${projectName} · agents` : 'Global · ~/.claude/agents'}</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Agents</span>
            <span className="glyph">.</span>
          </h1>
          <div className="cl-h-meta">
            <span><b>{total}</b> {total === 1 ? 'agent' : 'agents'}</span>
            <span className="sep">·</span>
            <span>delegate-and-summarize</span>
            {project && globalAgentList.length > 0 && (
              <>
                <span className="sep">·</span>
                <span><b>{projectAgentList.length}</b> project · <b>{globalAgentList.length}</b> global</span>
              </>
            )}
          </div>
        </section>

        {isLoading ? (
          <section className="cl-section">
            <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
          </section>
        ) : total === 0 ? (
          <section className="cl-section">
            <div className="cl-empty">
              No agents found. Add agents in <code style={{ fontFamily: 'var(--font-mono)' }}>~/.claude/agents/</code>.
            </div>
          </section>
        ) : project ? (
          <>
            {projectAgentList.length > 0 && (
              <section className="cl-section">
                <div className="cl-sec-head">
                  <h2>This project</h2>
                  <span className="ct">{projectAgentList.length} project-scoped</span>
                </div>
                <div className="cl-tile-grid cl-tile-grid--list">
                  {projectAgentList.map((a, i) => (
                    <AgentTile key={a.path} agent={a} index={i} onClick={() => onSelectAgent(a)} />
                  ))}
                </div>
              </section>
            )}
            {globalAgentList.length > 0 && (
              <section className="cl-section">
                <div className="cl-sec-head">
                  <h2>Global</h2>
                  <span className="ct">{globalAgentList.length} shared across projects</span>
                </div>
                <div className="cl-tile-grid cl-tile-grid--list">
                  {globalAgentList.map((a, i) => (
                    <AgentTile key={a.path} agent={a} index={i} onClick={() => onSelectAgent(a)} />
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <section className="cl-section">
            <div className="cl-tile-grid cl-tile-grid--list">
              {globalAgentList.map((a, i) => (
                <AgentTile key={a.path} agent={a} index={i} onClick={() => onSelectAgent(a)} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
