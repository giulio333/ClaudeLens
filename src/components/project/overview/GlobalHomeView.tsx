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
import type { LiveRow, Project } from './live-rows';
import { Lens } from './Lens';
import { DuplicateProjectsBadge } from './DuplicateProjectsNotice';
import { usePinnedProjects } from '../../../hooks/usePinnedProjects';
import { projectDisplayName } from '../shared/projectName';
import { ACTION, liveRowsFromProcs, welcomeLine } from './live-rows';

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
                {heroRows.map((row: LiveRow) => (
                  <button
                    key={row.project.hash}
                    type="button"
                    className="cl-ghome-working-row"
                    data-live={row.live}
                    onClick={() => onSelectProject(row.project)}
                  >
                    <span className="cl-ghome-working-dot" data-live={row.live} />
                    <span className="cl-ghome-working-name">{row.name}</span>
                    <span className="cl-ghome-working-action">{ACTION[row.live]}</span>
                  </button>
                ))}
              </div>
            )}

            <DuplicateProjectsBadge onNavigate={onNavigate} />
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
            <span className="cl-ghome-lbl">Global configuration</span>
            <div className="cl-ghome-config-list">
              <button
                type="button"
                className="cl-ghome-config-row"
                onClick={() => onNavigate({ type: 'global-claudemd' })}
              >
                <span className="cl-ghome-mono accent">C</span>
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
                <span className="cl-ghome-mono">M</span>
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
        </aside>
      </div>
    </div>
  );
}
