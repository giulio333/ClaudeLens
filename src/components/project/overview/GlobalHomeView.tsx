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
import { provisionalProjectHash } from '../shared/projectHash';

type Project = { hash: string; realPath: string };

const PROJECTS_PAGE_SIZE = 5;

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
  const { pinned, isPinned, togglePin } = usePinnedProjects();

  const costByHash = useMemo(() => {
    const m = new Map<string, ProjectCost>();
    for (const c of (costSummary as ProjectCost[] | undefined) ?? []) m.set(c.project, c);
    return m;
  }, [costSummary]);

  // The figures strip totals the whole install, not the pinned shortlist below
  // it: it answers "how much has all of this cost", which is the one question
  // the home could not answer before.
  const totals = useMemo(() => {
    let tokens = 0;
    let cost = 0;
    for (const c of (costSummary as ProjectCost[] | undefined) ?? []) {
      tokens += c.totalTokens;
      cost += c.cost;
    }
    // Split on the rounded string so the dollars and the cents can never
    // disagree (0.999 must not print as "$0" + ".00").
    const [whole, cents] = cost.toFixed(2).split('.');
    return {
      tokens: formatTokens(tokens),
      spendWhole: Number(whole).toLocaleString('en-US'),
      spendCents: `.${cents}`,
    };
  }, [costSummary]);

  // The home lists pinned projects only — the full list lives in the lens
  // (⌘F). With nothing pinned there is no section at all, so this doubles as
  // the section's mount guard.
  //
  // Always by name, with no sort control: this is a hand-picked shortlist, and
  // the usage-based orders it used to offer reshuffled it as work happened —
  // the one thing a shortlist you navigate by muscle memory must not do.
  const pinnedProjects = useMemo(() => {
    const nameOf = (p: Project) => projectDisplayName(p.realPath).toLowerCase();
    return allProjects
      .filter(p => pinned.has(p.hash))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }, [allProjects, pinned]);

  const pageCount = Math.max(1, Math.ceil(pinnedProjects.length / PROJECTS_PAGE_SIZE));
  const safePage = Math.min(projectsPage, pageCount - 1);
  const pagedProjects = pinnedProjects.slice(
    safePage * PROJECTS_PAGE_SIZE,
    (safePage + 1) * PROJECTS_PAGE_SIZE
  );
  const rangeFrom = pinnedProjects.length === 0 ? 0 : safePage * PROJECTS_PAGE_SIZE + 1;
  const rangeTo = Math.min((safePage + 1) * PROJECTS_PAGE_SIZE, pinnedProjects.length);

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
    <div className="cl-ghome" style={{ position: 'relative' }}>
      {/* ─── HERO ─────────────────────────────────────── */}
      <section className="cl-hero">
        <Lens />
        <div className="cl-eyebrow">
          <span className="pip" />
          <span>Global · ~/.claude</span>
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

      {/* ─── FIGURES STRIP ────────────────────────────── */}
      <div className="cl-stats cl-stats--home">
        <div className="cl-stat">
          <div className="num">{allProjects.length}</div>
          <div className="lbl">Projects</div>
        </div>
        <div className="cl-stat">
          <div className="num">
            {totals.tokens.value}
            {totals.tokens.unit && <small>{totals.tokens.unit}</small>}
          </div>
          <div className="lbl">Tokens</div>
        </div>
        <div className="cl-stat">
          <div className="num">
            <small>$</small>
            {totals.spendWhole}
            <small>{totals.spendCents}</small>
          </div>
          <div className="lbl">Spend</div>
        </div>
        <div className="cl-stat cl-stat--live">
          <div className="num">
            <span>{procs.length}</span>
            {/* No pulse with nothing running — a halo around a zero would be
                the loudest thing on the strip and it would mean nothing. */}
            {procs.length > 0 && <span className="dot cl-live-dot" />}
          </div>
          <div className="lbl">Live now</div>
        </div>
      </div>

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
              // A session opened in a fresh directory is registered as live
              // before Claude Code writes anything under `~/.claude/projects/`,
              // so the cwd has no entry here yet. Falling back to a provisional
              // project keeps the row navigable — its `realPath` comes straight
              // from the registry, so everything the project view reads off the
              // real cwd works; the history-backed parts are simply empty until
              // the first message. Without it the row was silently inert, which
              // read as a dead click.
              const proj = projectByPath.get(p.cwd) ?? {
                hash: provisionalProjectHash(p.cwd),
                realPath: p.cwd,
              };
              return (
                <button
                  key={p.pid}
                  type="button"
                  className="cl-proc"
                  onClick={() => onSelectProject(proj)}
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

      {/* ─── PINNED PROJECTS ──────────────────────────── */}
      {/* Nothing pinned = no section: an empty state inviting a pin would be a
          permanent fixture for a one-off action the lens already offers. */}
      {pinnedProjects.length > 0 && (
        <section className="cl-section">
          <div className="cl-sec-head">
            <h2>Pinned projects</h2>
            <span className="ct">
              {pinnedProjects.length > PROJECTS_PAGE_SIZE
                ? `${rangeFrom}–${rangeTo} of ${pinnedProjects.length}`
                : `${pinnedProjects.length} pinned`}
            </span>
          </div>
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
        </section>
      )}

      {/* ─── CONFIGURATION ────────────────────────────── */}
      <section className="cl-section">
        <div className="cl-sec-head">
          <h2>Configuration</h2>
          <span className="ct">shared across all projects</span>
        </div>
        {/* Cards, not the hairline list: on a card the count belongs under the
            sentence it qualifies, so `.t-meta` moves inside the text column
            instead of standing as a right-hand table cell. */}
        <div className="cl-tile-grid cl-tile-grid--cards">
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
              <span className="t-meta">
                {globalClaudeMd ? (
                  <>
                    <b>{claudeMdLines}</b> lines
                  </>
                ) : (
                  'not set'
                )}
              </span>
            </div>
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
              <span className="t-meta">
                <b>{skills.length}</b> skills
              </span>
            </div>
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
              <span className="t-meta">
                <b>{agents.length}</b> agents
              </span>
            </div>
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
              <span className="t-meta">
                <b>{mcpServers.length}</b> servers
              </span>
            </div>
          </button>
          <button type="button" className="cl-tile" onClick={() => onNavigate({ type: 'plugins' })}>
            <span className="glyph">P</span>
            <div>
              <div className="t-name">Plugins</div>
              <div className="t-desc">Skills, agents & commands installed from marketplaces.</div>
              <span className="t-meta">
                <b>{plugins.length}</b> plugins
              </span>
            </div>
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
