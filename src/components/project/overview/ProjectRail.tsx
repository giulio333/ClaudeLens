import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  useSessionList,
  useMemoryProject,
  useAllSkills,
  useProjectAgents,
  useGlobalAgents,
  useGlobalMcp,
  useLiveSessions,
  useActiveSessions,
  useProjectTasks,
  useProjectPlans,
  useUnlinkedPlans,
  useProjectWorkflows,
  useProjectTeams,
} from '../../../hooks/useIPC';
import { useRailCollapsed } from '../../../hooks/useRailCollapsed';
import { View } from '../types';
import { projectDisplayName } from '../shared/projectName';
import { searchTriggerProps } from '../shared/searchTrigger';
import type { ProjectSection } from './ProjectOverviewContent';

type Project = { hash: string; realPath: string };

type RailEntry = {
  key: ProjectSection | 'code-atlas';
  label: string;
  // Monogram shown in the 20px tile (and alone when the rail is collapsed).
  mono: string;
  // undefined → the section has nothing to count (Config)
  // null      → countable in principle but not a number (Overview)
  count?: number | null;
  view: View;
};

type RailGroup = { label: string; items: RailEntry[] };

// `/Users/foo/bar` → `~/bar`. The renderer never learns the home dir, so match
// the two layouts the app actually runs on plus the Windows one; anything else
// is shown verbatim.
function tildePath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
}

function fmtUptime(sec: number): string {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

/**
 * Project rail — the vertical work column that replaced the horizontal subtab
 * bar (design 5a): project header + switcher, sections grouped in Context /
 * Execution / System with monogram tiles, and the live process at the bottom.
 * Collapses to a 64px strip of tiles (⌘B, persisted). Deliberately no search
 * row — the app already carries one trigger, top-right in the bar (⌘F).
 */
export function ProjectRail({
  project,
  active,
  onNavigate,
  onToggleProjectSearch,
}: {
  project: Project;
  active: ProjectSection;
  onNavigate: (v: View) => void;
  onToggleProjectSearch: (anchor: HTMLElement) => void;
}) {
  const { data: sessions = [] } = useSessionList(project.hash);
  const { data: memory } = useMemoryProject(project.hash);
  const { data: skills = [] } = useAllSkills(project.realPath);
  const { data: projectAgents = [] } = useProjectAgents(project.realPath);
  const { data: globalAgents = [] } = useGlobalAgents();
  const { data: mcpData } = useGlobalMcp();
  const { data: liveSessions = [] } = useLiveSessions();
  const { data: activeSessions = [] } = useActiveSessions();
  const { data: taskGroups = [] } = useProjectTasks(project.hash);
  const { data: planGroups = [] } = useProjectPlans(project.hash);
  const { data: unlinkedPlans = [] } = useUnlinkedPlans();
  const { data: workflowGroups = [] } = useProjectWorkflows(project.hash);
  const { data: teams = [] } = useProjectTeams(project.hash);

  const { collapsed, toggle } = useRailCollapsed();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const memoryCount = (memory?.index.length ?? 0) + (memory?.projectLevelIndex.length ?? 0);
  const agentCount = useMemo(
    () => new Set([...projectAgents.map(a => a.name), ...globalAgents.map(a => a.name)]).size,
    [projectAgents, globalAgents]
  );
  const mcpCount = useMemo(() => {
    const all = [...(mcpData?.cloudServers ?? []), ...(mcpData?.localServers ?? [])];
    return all.filter(s => !s.disabledProjectPaths.includes(project.realPath)).length;
  }, [mcpData, project.realPath]);
  const liveCount = useMemo(
    () =>
      liveSessions.filter(
        s => s.cwd === project.realPath || s.cwd.startsWith(project.realPath + '/')
      ).length,
    [liveSessions, project.realPath]
  );
  const taskCount = useMemo(() => taskGroups.reduce((n, g) => n + g.tasks.length, 0), [taskGroups]);
  // Include the unlinked ones: the badge must count what the subtab lists.
  const planCount = useMemo(
    () => planGroups.reduce((n, g) => n + g.plans.length, 0) + unlinkedPlans.length,
    [planGroups, unlinkedPlans]
  );
  const workflowCount = useMemo(
    () => workflowGroups.reduce((n, g) => n + g.runs.length, 0),
    [workflowGroups]
  );

  // ── Live process (registry ~/.claude/sessions), the rail footer's readout ──
  const procs = useMemo(
    () => activeSessions.filter(p => p.cwd === project.realPath),
    [activeSessions, project.realPath]
  );
  const leadProc = procs[0];
  const leadPid = leadProc?.pid;
  const leadStartedAt = leadProc?.startedAt;
  // Uptime lives in state and is computed inside the interval callback, never
  // during render, so the render stays pure.
  const [liveSec, setLiveSec] = useState(0);
  useEffect(() => {
    if (leadPid === undefined) return;
    let observedStart: number | null = null;
    const update = () => {
      if (observedStart === null) observedStart = Date.now();
      const base = leadStartedAt ?? observedStart;
      setLiveSec(Math.max(0, Math.floor((Date.now() - base) / 1000)));
    };
    const seed = setTimeout(update, 0);
    const t = setInterval(update, 1000);
    return () => {
      clearTimeout(seed);
      clearInterval(t);
    };
  }, [leadPid, leadStartedAt]);

  const groups: RailGroup[] = [
    {
      label: 'Context',
      items: [
        { key: 'overview', label: 'Overview', mono: 'O', count: null, view: { type: 'overview' } },
        {
          key: 'code-atlas',
          label: 'Code Atlas',
          mono: 'G',
          view: { type: 'project-code-atlas', project },
        },
        {
          key: 'sessions',
          label: 'Sessions',
          mono: '#',
          count: sessions.length,
          view: { type: 'sessions', project },
        },
        {
          key: 'memory',
          label: 'Memory',
          mono: 'M',
          count: memoryCount,
          view: { type: 'project-memory', project },
        },
        {
          key: 'skills',
          label: 'Skills',
          mono: '/',
          count: skills.length,
          view: { type: 'project-skills', project },
        },
        {
          key: 'agents',
          label: 'Agents',
          mono: 'A',
          count: agentCount,
          view: { type: 'project-agents', project },
        },
        {
          key: 'mcp',
          label: 'MCP',
          mono: 'N',
          count: mcpCount,
          view: { type: 'project-mcp', project },
        },
      ],
    },
    {
      label: 'Execution',
      items: [
        {
          key: 'plans',
          label: 'Plans',
          mono: 'P',
          count: planCount,
          view: { type: 'project-plans', project },
        },
        {
          key: 'live-agents',
          label: 'Agent View',
          mono: 'V',
          count: liveCount,
          view: { type: 'agents-live', project },
        },
        {
          key: 'tasks',
          label: 'Tasks',
          mono: 'T',
          count: taskCount,
          view: { type: 'project-tasks', project },
        },
        {
          key: 'workflows',
          label: 'Workflows',
          mono: 'W',
          count: workflowCount,
          view: { type: 'project-workflows', project },
        },
        {
          key: 'teams',
          label: 'Teams',
          mono: 'Tm',
          count: teams.length,
          view: { type: 'project-teams', project },
        },
      ],
    },
    {
      label: 'System',
      items: [
        { key: 'config', label: 'Config', mono: 'C', view: { type: 'project-config', project } },
      ],
    },
  ];

  const projectName = projectDisplayName(project.realPath);
  const liveLabel = procs.length === 1 ? '1 process running' : `${procs.length} processes running`;

  if (collapsed) {
    return (
      <aside className="cl-rail is-collapsed" aria-label="Project sections">
        <button
          type="button"
          {...searchTriggerProps}
          className="cl-rail-mark"
          title={`${projectName} · switch project`}
          aria-label="Switch project"
          onClick={e => onToggleProjectSearch(e.currentTarget)}
        >
          <i />
        </button>
        <nav className="cl-rail-tiles">
          {groups.map((g, gi) => (
            <Fragment key={g.label}>
              {gi > 0 && <i className="cl-rail-tilesep" aria-hidden />}
              {g.items.map(it => (
                <button
                  key={it.key}
                  type="button"
                  className={`cl-rail-tile${active === it.key ? ' on' : ''}${
                    it.count === 0 ? ' is-empty' : ''
                  }`}
                  title={it.count ? `${it.label} · ${it.count}` : it.label}
                  aria-label={it.label}
                  aria-current={active === it.key ? 'page' : undefined}
                  onClick={() => onNavigate(it.view)}
                >
                  {it.mono}
                  {active === it.key && !!it.count && <i className="badge">{it.count}</i>}
                </button>
              ))}
            </Fragment>
          ))}
        </nav>
        <div className="cl-rail-tilefoot">
          {procs.length > 0 && (
            <span
              className="cl-rail-pulse"
              title={`${liveLabel} · PID ${leadProc?.pid} · up ${fmtUptime(liveSec)}`}
            />
          )}
          <button
            type="button"
            className="cl-rail-tile cl-rail-tile--toggle"
            title="Expand rail (⌘B)"
            aria-label="Expand rail"
            onClick={toggle}
          >
            »
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="cl-rail" aria-label="Project sections">
      <button
        type="button"
        {...searchTriggerProps}
        className="cl-rail-project"
        title={project.realPath}
        aria-haspopup="dialog"
        onClick={e => onToggleProjectSearch(e.currentTarget)}
      >
        <span className="cl-rail-mark" aria-hidden>
          <i />
        </span>
        <span className="txt">
          <span className="name">{projectName}</span>
          <span className="path">{tildePath(project.realPath)}</span>
        </span>
        <span className="chev" aria-hidden>
          ▾
        </span>
      </button>

      <nav className="cl-rail-nav">
        {groups.map(g => (
          <Fragment key={g.label}>
            <div className="cl-rail-group">{g.label}</div>
            {g.items.map(it => (
              <button
                key={it.key}
                type="button"
                className={`cl-rail-item${active === it.key ? ' on' : ''}${
                  it.count === 0 ? ' is-empty' : ''
                }`}
                aria-current={active === it.key ? 'page' : undefined}
                onClick={() => onNavigate(it.view)}
              >
                <span className="mono" aria-hidden>
                  {it.mono}
                </span>
                <span className="lbl">{it.label}</span>
                <span className="ct">
                  {it.count === undefined
                    ? ''
                    : it.count === 0 || it.count === null
                      ? '—'
                      : it.count}
                </span>
              </button>
            ))}
          </Fragment>
        ))}
      </nav>

      <div className="cl-rail-foot">
        {procs.length > 0 ? (
          <div className="cl-rail-live">
            <span className="cl-rail-pulse" aria-hidden />
            <span className="txt">
              <span className="head">{liveLabel}</span>
              <span className="sub">
                PID {leadProc?.pid} · {fmtUptime(liveSec)}
              </span>
            </span>
          </div>
        ) : (
          <div className="cl-rail-live is-idle">
            <span className="dot" aria-hidden />
            <span className="txt">
              <span className="head">No live session</span>
            </span>
          </div>
        )}
        {/* icon-only: the label + kbd block it used to carry was the heaviest
            thing in the rail, for a control the shortcut already covers */}
        <button
          type="button"
          className="cl-rail-collapse"
          onClick={toggle}
          title="Collapse rail (⌘B)"
          aria-label="Collapse rail"
        >
          «
        </button>
      </div>
    </aside>
  );
}
