import { useMemo, useState } from 'react';
import {
  useGlobalSkills,
  useGlobalAgents,
  useGlobalMcp,
  usePlugins,
  useMemoryProjects,
  useCostSummary,
  useGlobalClaudeMd,
  useActiveSessions,
} from '../../../hooks/useIPC';
import { View } from '../types';
import { formatTokens } from '../utils';
import type { ProjectCost } from '../../../types';
import { Lens } from './Lens';
import { DuplicateProjectsBadge } from './DuplicateProjectsNotice';
import { McpServerGrid } from '../mcp/McpServerGrid';
import { usePinnedProjects } from '../../../hooks/usePinnedProjects';
import { PinIcon } from '../shared/SearchPopover';
import { projectDisplayName } from '../shared/projectName';

type Project = { hash: string; realPath: string };

const PROJECTS_PAGE_SIZE = 5;

type SortKey = 'tokens' | 'cost' | 'sessions' | 'name';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'tokens', label: 'tokens' },
  { key: 'cost', label: 'cost' },
  { key: 'sessions', label: 'sessions' },
  { key: 'name', label: 'name' },
];

function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const out: (number | 'gap')[] = [0];
  const start = Math.max(1, current - 1);
  const end = Math.min(total - 2, current + 1);
  if (start > 1) out.push('gap');
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 2) out.push('gap');
  out.push(total - 1);
  return out;
}

export function GlobalHomeView({
  onNavigate,
  onSelectProject,
}: {
  onNavigate: (v: View) => void;
  onSelectProject: (p: Project) => void;
}) {
  const { data: skills = [] } = useGlobalSkills();
  const { data: agents = [] } = useGlobalAgents();
  const { data: mcpData } = useGlobalMcp();
  const { data: plugins = [] } = usePlugins();
  const { data: allProjects = [] } = useMemoryProjects();
  const { data: costSummary } = useCostSummary();
  const { data: globalClaudeMd } = useGlobalClaudeMd();

  const { data: procs = [] } = useActiveSessions();
  const [projectsPage, setProjectsPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('tokens');
  const { pinned, isPinned, togglePin } = usePinnedProjects();
  // 'pinned' default when any pin exists; user can switch to 'all'
  const [projectsFilter, setProjectsFilter] = useState<'pinned' | 'all'>('pinned');

  const costByHash = useMemo(() => {
    const m = new Map<string, ProjectCost>();
    for (const c of (costSummary as ProjectCost[] | undefined) ?? []) m.set(c.project, c);
    return m;
  }, [costSummary]);

  const hasPinned = useMemo(() => allProjects.some(p => pinned.has(p.hash)), [allProjects, pinned]);
  const effectiveFilter: 'pinned' | 'all' = hasPinned ? projectsFilter : 'all';

  const sortedProjects = useMemo(() => {
    const base =
      effectiveFilter === 'pinned' ? allProjects.filter(p => pinned.has(p.hash)) : allProjects;
    const arr = [...base];
    const nameOf = (p: Project) => projectDisplayName(p.realPath).toLowerCase();
    switch (sortKey) {
      case 'cost':
        return arr.sort(
          (a, b) => (costByHash.get(b.hash)?.cost ?? 0) - (costByHash.get(a.hash)?.cost ?? 0)
        );
      case 'sessions':
        return arr.sort(
          (a, b) =>
            (costByHash.get(b.hash)?.sessionsCount ?? 0) -
            (costByHash.get(a.hash)?.sessionsCount ?? 0)
        );
      case 'name':
        return arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      case 'tokens':
      default:
        return arr.sort(
          (a, b) =>
            (costByHash.get(b.hash)?.totalTokens ?? 0) - (costByHash.get(a.hash)?.totalTokens ?? 0)
        );
    }
  }, [allProjects, costByHash, sortKey, effectiveFilter, pinned]);

  const pageCount = Math.max(1, Math.ceil(sortedProjects.length / PROJECTS_PAGE_SIZE));
  const safePage = Math.min(projectsPage, pageCount - 1);
  const pagedProjects = sortedProjects.slice(
    safePage * PROJECTS_PAGE_SIZE,
    (safePage + 1) * PROJECTS_PAGE_SIZE
  );
  const rangeFrom = sortedProjects.length === 0 ? 0 : safePage * PROJECTS_PAGE_SIZE + 1;
  const rangeTo = Math.min((safePage + 1) * PROJECTS_PAGE_SIZE, sortedProjects.length);

  const projectByPath = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of allProjects) m.set(p.realPath, p);
    return m;
  }, [allProjects]);

  const mcpServers = useMemo(
    () => [...(mcpData?.cloudServers ?? []), ...(mcpData?.localServers ?? [])],
    [mcpData]
  );
  const claudeMdLines = (globalClaudeMd ?? '').split('\n').length;

  return (
    <div style={{ position: 'relative' }}>
      {/* ─── HERO ─────────────────────────────────────── */}
      <section className="cl-hero">
        <Lens />
        <div className="cl-eyebrow">
          <span className="pip" />
          <span>Global · ~ · shared across all projects on this machine</span>
        </div>
        <h1 className="cl-h-name static">
          <span className="label-name">Global</span>
          <span className="glyph">.</span>
        </h1>
        <div className="cl-h-meta">
          <span>
            <b>{allProjects.length}</b> projects
          </span>
          <span className="sep">·</span>
          <span>
            <b>{procs.length}</b> sessions running
          </span>
          <span className="sep">·</span>
          <span>
            <b>{skills.length}</b> skills
          </span>
          <span className="sep">·</span>
          <span>
            <b>{agents.length}</b> agents
          </span>
          <span className="sep">·</span>
          <span>
            <b>{mcpServers.length}</b> MCP servers
          </span>
        </div>
      </section>

      {/* ─── DUPLICATE PROJECTS (segnale compatto) ────── */}
      <DuplicateProjectsBadge onNavigate={onNavigate} />

      {/* ─── LIVE PROCESSES ───────────────────────────── */}
      {procs.length > 0 && (
        <section className="cl-section">
          <div className="cl-sec-head">
            <h2>Live processes</h2>
            <span className="ct">{procs.length} running · live</span>
          </div>
          <div className="cl-proc-list">
            {procs.map(p => {
              // Split on both separators so a Windows cwd (backslashes) yields the
              // folder name, not the whole path.
              const name = p.cwd.split(/[\\/]/).filter(Boolean).pop() ?? p.cwd;
              const proj = projectByPath.get(p.cwd);
              return (
                <button
                  key={p.pid}
                  type="button"
                  className="cl-proc"
                  onClick={() => proj && onSelectProject(proj)}
                >
                  <span className="led" />
                  <span className="pid">PID {p.pid}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="pname">{name}</div>
                    <div className="pcmd">
                      {p.status === 'waiting'
                        ? `waiting for ${p.waitingFor ?? 'input'}`
                        : p.source === 'registry'
                          ? p.status
                          : 'claude'}
                    </div>
                  </div>
                  <span className="ppath">{p.cwd}</span>
                  <span className="arrow">→</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── PROJECTS ─────────────────────────────────── */}
      <section className="cl-section">
        <div className="cl-sec-head">
          <h2>{effectiveFilter === 'pinned' ? 'Pinned projects' : 'Projects'}</h2>
          <span className="ct">
            {sortedProjects.length === 0
              ? effectiveFilter === 'pinned'
                ? '0 pinned · pin a project to surface it here'
                : '0 total · sorted by token usage'
              : `${rangeFrom}–${rangeTo} of ${sortedProjects.length} · sorted by ${SORT_OPTIONS.find(o => o.key === sortKey)?.label ?? 'tokens'}`}
          </span>
          {hasPinned && (
            <span className="cl-pinfilter">
              <button
                type="button"
                className={projectsFilter === 'pinned' ? 'on' : ''}
                onClick={() => {
                  setProjectsFilter('pinned');
                  setProjectsPage(0);
                }}
              >
                Pinned
              </button>
              <span className="sep">·</span>
              <button
                type="button"
                className={projectsFilter === 'all' ? 'on' : ''}
                onClick={() => {
                  setProjectsFilter('all');
                  setProjectsPage(0);
                }}
              >
                All
              </button>
            </span>
          )}
          {sortedProjects.length > 0 && (
            <span className="cl-sortbar" style={{ marginLeft: 'auto' }}>
              <span className="label">SORT BY</span>
              {SORT_OPTIONS.map((o, i) => (
                <span key={o.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {i > 0 && <span className="sep">·</span>}
                  <button
                    type="button"
                    className={`opt${sortKey === o.key ? ' on' : ''}`}
                    onClick={() => {
                      setSortKey(o.key);
                      setProjectsPage(0);
                    }}
                  >
                    {o.label}
                  </button>
                </span>
              ))}
            </span>
          )}
        </div>
        {sortedProjects.length === 0 ? (
          <div className="cl-empty">
            {effectiveFilter === 'pinned'
              ? 'No pinned projects. Open the lens (top right) or hover a project to pin it.'
              : 'No projects yet.'}
          </div>
        ) : (
          <>
            <div>
              {pagedProjects.map(p => {
                const name = projectDisplayName(p.realPath);
                const c = costByHash.get(p.hash);
                const tokens = formatTokens(c?.totalTokens ?? 0);
                const isLive = procs.some(pr => pr.cwd === p.realPath);
                const pinnedNow = isPinned(p.hash);
                return (
                  <div
                    key={p.hash}
                    role="button"
                    tabIndex={0}
                    className={`cl-row has-pin${pinnedNow ? ' is-pinned' : ''}`}
                    onClick={() => onSelectProject(p)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectProject(p);
                      }
                    }}
                  >
                    <button
                      type="button"
                      className={`cl-pin-row${pinnedNow ? ' pinned' : ''}`}
                      title={pinnedNow ? 'Unpin project' : 'Pin project'}
                      aria-label={pinnedNow ? 'Unpin project' : 'Pin project'}
                      onClick={e => {
                        e.stopPropagation();
                        togglePin(p.hash);
                      }}
                    >
                      <PinIcon filled={pinnedNow} />
                    </button>
                    <span className="idx">{(name[0] ?? '?').toUpperCase()}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="title">
                        {name}
                        {isLive && (
                          <span
                            style={{
                              color: 'var(--cl-ok)',
                              fontSize: 11,
                              marginLeft: 10,
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            ● live
                          </span>
                        )}
                      </div>
                      <div className="file">{p.realPath}</div>
                    </div>
                    <span className="when" style={{ textAlign: 'left' }}>
                      {c?.sessionsCount ?? 0} sessions
                    </span>
                    <span className="toks">
                      {tokens.value}
                      {tokens.unit}
                      <small>tok</small>
                    </span>
                    <span className="when">{c ? `$${c.cost.toFixed(2)}` : '—'}</span>
                  </div>
                );
              })}
            </div>
            {pageCount > 1 && (
              <div className="cl-pag">
                <span className="cl-pag-meter">
                  PAGE <b>{String(safePage + 1).padStart(2, '0')}</b> /{' '}
                  {String(pageCount).padStart(2, '0')}
                </span>
                <div className="cl-pag-side">
                  <button
                    type="button"
                    className="cl-pag-btn"
                    disabled={safePage === 0}
                    onClick={() => setProjectsPage(safePage - 1)}
                  >
                    <span className="arrow">←</span> PREV
                  </button>
                  <div className="cl-pag-nums">
                    {pageWindow(safePage, pageCount).map((p, i) =>
                      p === 'gap' ? (
                        <span key={`gap-${i}`} className="cl-pag-ellipsis">
                          …
                        </span>
                      ) : (
                        <button
                          key={p}
                          type="button"
                          className={`cl-pag-num${p === safePage ? ' on' : ''}`}
                          onClick={() => setProjectsPage(p)}
                        >
                          {String(p + 1).padStart(2, '0')}
                        </button>
                      )
                    )}
                  </div>
                  <button
                    type="button"
                    className="cl-pag-btn"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setProjectsPage(safePage + 1)}
                  >
                    NEXT <span className="arrow">→</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ─── CONFIGURATION ────────────────────────────── */}
      <section className="cl-section">
        <div className="cl-sec-head">
          <h2>Configuration</h2>
          <span className="ct">shared across all projects</span>
        </div>
        <div className="cl-tile-grid">
          <button
            type="button"
            className="cl-tile accent"
            onClick={() => onNavigate({ type: 'global-claudemd' })}
          >
            <span className="glyph">M</span>
            <div>
              <div className="t-name">CLAUDE.md</div>
              <div className="t-desc">
                Global instructions injected into every Claude Code session.
              </div>
            </div>
            <span className="t-meta">
              {globalClaudeMd ? (
                <>
                  <b>{claudeMdLines}</b> lines
                </>
              ) : (
                'not set'
              )}
            </span>
          </button>
          <button
            type="button"
            className="cl-tile"
            onClick={() => onNavigate({ type: 'global-skills' })}
          >
            <span className="glyph">S</span>
            <div>
              <div className="t-name">Skills</div>
              <div className="t-desc">
                Reusable, invocable behaviors available to every project.
              </div>
            </div>
            <span className="t-meta">
              <b>{skills.length}</b> skills
            </span>
          </button>
          <button
            type="button"
            className="cl-tile"
            onClick={() => onNavigate({ type: 'global-agents' })}
          >
            <span className="glyph">A</span>
            <div>
              <div className="t-name">Agents</div>
              <div className="t-desc">Specialized sub-agents available to delegate to.</div>
            </div>
            <span className="t-meta">
              <b>{agents.length}</b> agents
            </span>
          </button>
          <button
            type="button"
            className="cl-tile"
            onClick={() => onNavigate({ type: 'global-mcp' })}
          >
            <span className="glyph">N</span>
            <div>
              <div className="t-name">MCP servers</div>
              <div className="t-desc">
                Model Context Protocol integrations, shared across projects.
              </div>
            </div>
            <span className="t-meta">
              <b>{mcpServers.length}</b> servers
            </span>
          </button>
          <button type="button" className="cl-tile" onClick={() => onNavigate({ type: 'plugins' })}>
            <span className="glyph">P</span>
            <div>
              <div className="t-name">Plugins</div>
              <div className="t-desc">Skills, agents & commands installed from marketplaces.</div>
            </div>
            <span className="t-meta">
              <b>{plugins.length}</b> plugins
            </span>
          </button>
        </div>
      </section>

      {/* ─── MCP SERVERS ──────────────────────────────── */}
      {mcpServers.length > 0 && (
        <section className="cl-section">
          <McpServerGrid
            servers={mcpServers}
            onSelect={s =>
              onNavigate({
                type: 'mcp-detail',
                server: s,
                totalProjects: s.enabledInProjects + s.disabledInProjects,
              })
            }
          />
        </section>
      )}
    </div>
  );
}
