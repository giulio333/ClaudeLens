import { useGlobalAgents, Agent } from '../../../hooks/useIPC';
import { fmtModel } from '../utils';
import { Lens } from '../overview/Lens';
import { TopBar } from '../shared/TopBar';

const GLYPHS = ['◐', '◑', '◒', '◓'];

/** The two ways an agent file can be invalid, told where the agent is listed. */
function agentIssues(agent: Agent) {
  return [
    ...(agent.missingRequired.length > 0
      ? [
          {
            label: `missing ${agent.missingRequired.join(', ')}`,
            title: `Missing required frontmatter: ${agent.missingRequired.join(', ')}`,
          },
        ]
      : []),
    ...(agent.filenameHasSpaces
      ? [
          {
            label: 'spaces in filename',
            title:
              'Claude Code requires agent file names without spaces — this agent may not be loaded.',
          },
        ]
      : []),
  ];
}

function AgentTile({
  agent,
  index,
  onClick,
}: {
  agent: Agent;
  index: number;
  onClick: () => void;
}) {
  const mode = agent.disableModelInvocation ? 'manual' : 'auto';
  return (
    <button type="button" className={`cl-tile ${index === 0 ? 'accent' : ''}`} onClick={onClick}>
      <span className="glyph">{GLYPHS[index % GLYPHS.length]}</span>
      <div style={{ minWidth: 0 }}>
        <div className="t-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {agent.name}
          {agentIssues(agent).map(issue => (
            <span
              key={issue.label}
              title={issue.title}
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                background: 'color-mix(in srgb, var(--cl-warn) 20%, transparent)',
                color: 'var(--cl-warn)',
                padding: '1px 5px',
                borderRadius: 4,
                letterSpacing: '0.05em',
                lineHeight: 1.4,
              }}
            >
              {issue.label}
            </span>
          ))}
        </div>
        <div className="t-desc">{agent.description || '—'}</div>
      </div>
      <span className="t-meta">
        {agent.model ? `${fmtModel(agent.model)} · ` : ''}
        <b>{mode}</b>
      </span>
    </button>
  );
}

export function GlobalAgentsView({
  onBack,
  onSelectAgent,
  onCreate,
}: {
  onBack: () => void;
  onSelectAgent: (agent: Agent) => void;
  onCreate: () => void;
}) {
  const { data: agents, isLoading } = useGlobalAgents();
  const total = agents?.length ?? 0;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: 'Global · Agents' }]} />

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
            <span>Global · ~/.claude/agents</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Agents</span>
            <span className="glyph">.</span>
          </h1>
          <div className="cl-h-meta">
            <span>
              <b>{total}</b> {total === 1 ? 'agent' : 'agents'}
            </span>
            <span className="sep">·</span>
            <span>delegate-and-summarize</span>
          </div>
        </section>

        {isLoading ? (
          <section className="cl-section">
            <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
          </section>
        ) : total === 0 ? (
          <section className="cl-section">
            <div className="cl-empty">
              No agents found. Add <code style={{ fontFamily: 'var(--font-mono)' }}>*.md</code>{' '}
              files in <code style={{ fontFamily: 'var(--font-mono)' }}>~/.claude/agents/</code>.
            </div>
          </section>
        ) : (
          <section className="cl-section">
            <div className="cl-tile-grid cl-tile-grid--list">
              {(agents ?? []).map((a, i) => (
                <AgentTile key={a.path} agent={a} index={i} onClick={() => onSelectAgent(a)} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
