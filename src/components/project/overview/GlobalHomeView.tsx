import { useMemo } from 'react';
import {
  useGlobalSkills,
  useGlobalAgents,
  useGlobalMcp,
  usePlugins,
  useMemoryProjects,
  useGlobalClaudeMd,
  useActiveSessions,
} from '../../../hooks/useIPC';
import { View } from '../types';
import { Lens } from './Lens';
import { DuplicateProjectsBadge } from './DuplicateProjectsNotice';
import { usePinnedProjects } from '../../../hooks/usePinnedProjects';
import { projectDisplayName } from '../shared/projectName';
import { provisionalProjectHash } from '../shared/projectHash';

type Project = { hash: string; realPath: string };

type LiveRow = {
  project: Project;
  name: string;
  live: 'ok' | 'warn';
};

// One row per cwd, not per process: a project with two claude processes is
// still one line in the welcome. `waiting` wins over `busy`/`idle` when a cwd
// has more than one — it's the status that actually asks something of you.
function liveRowsFromProcs(
  procs: { cwd: string; status: string }[],
  projectByPath: Map<string, Project>
): LiveRow[] {
  const byPath = new Map<string, LiveRow>();
  for (const p of procs) {
    const project = projectByPath.get(p.cwd) ?? {
      hash: provisionalProjectHash(p.cwd),
      realPath: p.cwd,
    };
    const waiting = p.status === 'waiting';
    const existing = byPath.get(p.cwd);
    if (!existing) {
      byPath.set(p.cwd, {
        project,
        name: projectDisplayName(p.cwd),
        live: waiting ? 'warn' : 'ok',
      });
    } else if (waiting) {
      existing.live = 'warn';
    }
  }
  return [...byPath.values()];
}

// The one sentence that replaces the old figures strip + live-process table:
// how many are working, and — by name, because a name is the one thing a
// count can't say — which one is waiting on you.
function welcomeLine(live: LiveRow[]): string {
  if (live.length === 0) return 'Nothing is running right now.';
  const waiting = live.filter(r => r.live === 'warn');
  if (live.length === 1) {
    const [row] = live;
    return row.live === 'warn'
      ? `${row.name} is waiting on you.`
      : `${row.name} is working right now.`;
  }
  const base = `${live.length} projects are working right now.`;
  if (waiting.length === 0) return base;
  if (waiting.length === 1) return `${base} ${waiting[0].name} is waiting on you.`;
  return `${base} ${waiting.length} are waiting on you.`;
}

// The hero stays a fixed two rows regardless of how many are actually live —
// a welcome that grows without bound the busier `~/.claude` gets stops being
// a welcome. Anything past the top two is still accounted for in the prose.
const HERO_ROWS = 2;

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
  const { data: globalClaudeMd } = useGlobalClaudeMd();
  const { data: procs = [] } = useActiveSessions();
  const { pinned } = usePinnedProjects();

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

  // The margin index — a shortlist you navigate by memory, so it stays fixed
  // by name (no usage-based sort to reshuffle it while you work) and shows
  // every pin, not just a page of them; it scrolls in place instead.
  const pinnedProjects = useMemo(() => {
    const nameOf = (p: Project) => projectDisplayName(p.realPath).toLowerCase();
    return allProjects
      .filter(p => pinned.has(p.hash))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }, [allProjects, pinned]);

  const liveRows = useMemo(() => liveRowsFromProcs(procs, projectByPath), [procs, projectByPath]);
  const heroRows = liveRows.slice(0, HERO_ROWS);

  return (
    <div className="cl-ghome">
      <div className="cl-ghome-notice">
        <DuplicateProjectsBadge onNavigate={onNavigate} />
      </div>

      <div className="cl-ghome-split">
        {/* ─── WELCOME ──────────────────────────────────── */}
        <div className="cl-ghome-welcome">
          <Lens className="cl-lens--corner" />
          <div className="cl-ghome-welcome-inner">
            <div className="cl-eyebrow">
              <span className="pip" />
              <span>~/.claude</span>
            </div>
            <h1 className="cl-h-name static">
              <span className="label-name">Welcome back</span>
              <span className="glyph">.</span>
            </h1>
            <p className="cl-ghome-lede">{welcomeLine(liveRows)}</p>

            {heroRows.length > 0 && (
              <div className="cl-ghome-working">
                {heroRows.map(row => (
                  <button
                    key={row.project.hash}
                    type="button"
                    className="cl-ghome-working-row"
                    data-live={row.live}
                    onClick={() => onSelectProject(row.project)}
                  >
                    <span className="cl-ghome-working-dot" data-live={row.live} />
                    <span className="cl-ghome-working-name">{row.name}</span>
                    <span className="cl-ghome-working-action">
                      {row.live === 'warn' ? 'answer →' : 'resume →'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── PINNED + CONFIGURATION ───────────────────── */}
        <aside className="cl-ghome-aside">
          <div className="cl-ghome-pinned">
            <span className="cl-ghome-lbl">Pinned</span>
            {pinnedProjects.length === 0 ? (
              <p className="cl-ghome-pinned-empty">
                Nothing pinned yet — pin a project from ⌘F or its own page.
              </p>
            ) : (
              <div className="cl-ghome-pinned-list">
                {pinnedProjects.map((p, i) => (
                  <button
                    key={p.hash}
                    type="button"
                    className="cl-ghome-pinned-row"
                    onClick={() => onSelectProject(p)}
                  >
                    <span className="cl-ghome-pinned-idx">{String(i + 1).padStart(2, '0')}</span>
                    <span className="cl-ghome-pinned-name">{projectDisplayName(p.realPath)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="cl-ghome-config">
            <span className="cl-ghome-lbl">Configuration</span>
            <div className="cl-ghome-config-list">
              <button
                type="button"
                className="cl-ghome-config-row"
                onClick={() => onNavigate({ type: 'global-claudemd' })}
              >
                <span className="cl-ghome-mono accent">M</span>
                <span className="cl-ghome-config-name">CLAUDE.md</span>
                <span className="cl-ghome-config-meta">
                  {globalClaudeMd ? claudeMdLines : 'not set'}
                </span>
              </button>
              <button
                type="button"
                className="cl-ghome-config-row"
                onClick={() => onNavigate({ type: 'global-skills' })}
              >
                <span className="cl-ghome-mono">S</span>
                <span className="cl-ghome-config-name">Skills</span>
                <span className="cl-ghome-config-meta">{skills.length}</span>
              </button>
              <button
                type="button"
                className="cl-ghome-config-row"
                onClick={() => onNavigate({ type: 'global-agents' })}
              >
                <span className="cl-ghome-mono">A</span>
                <span className="cl-ghome-config-name">Agents</span>
                <span className="cl-ghome-config-meta">{agents.length}</span>
              </button>
              <button
                type="button"
                className="cl-ghome-config-row"
                onClick={() => onNavigate({ type: 'global-mcp' })}
              >
                <span className="cl-ghome-mono">N</span>
                <span className="cl-ghome-config-name">MCP servers</span>
                <span className="cl-ghome-config-meta">{mcpServers.length}</span>
              </button>
              <button
                type="button"
                className="cl-ghome-config-row"
                onClick={() => onNavigate({ type: 'plugins' })}
              >
                <span className="cl-ghome-mono">P</span>
                <span className="cl-ghome-config-name">Plugins</span>
                <span className="cl-ghome-config-meta">{plugins.length}</span>
              </button>
            </div>
          </div>

          <span className="cl-ghome-aside-foot">Global · ~ · shared across all projects</span>
        </aside>
      </div>
    </div>
  );
}
