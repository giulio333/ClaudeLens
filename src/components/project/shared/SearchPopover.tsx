import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, McpServer, ProjectCost, SessionSummary, Skill } from '../../../types';
import { fmtModel, sessionTitle } from '../utils';
import { projectDisplayName } from './projectName';

type Project = { hash: string; realPath: string };
export type SearchMode = 'global' | 'projects';
export type SearchAnchorAlign = 'left' | 'right';
export type SearchSession = { project: Project; session: SessionSummary };

type SearchFilter = 'all' | 'projects' | 'sessions' | 'skills' | 'agents' | 'mcp';

type ProjectRow = {
  kind: 'project';
  key: string;
  project: Project;
  title: string;
  detail: string;
  meta: string;
  pinned: boolean;
  current: boolean;
};

type EntityRow =
  | {
      kind: 'session';
      key: string;
      project: Project;
      session: SessionSummary;
      title: string;
      detail: string;
      meta: string;
      glyph: string;
      pinned: boolean;
    }
  | {
      kind: 'skill';
      key: string;
      skill: Skill;
      title: string;
      detail: string;
      meta: string;
      glyph: string;
    }
  | {
      kind: 'agent';
      key: string;
      agent: Agent;
      title: string;
      detail: string;
      meta: string;
      glyph: string;
    }
  | {
      kind: 'mcp';
      key: string;
      server: McpServer;
      title: string;
      detail: string;
      meta: string;
      glyph: string;
    };

type SearchRow = ProjectRow | EntityRow;
type SearchSection = { key: string; title: string; count: number; rows: SearchRow[] };

const FILTERS: { key: SearchFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'projects', label: 'Projects' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'skills', label: 'Skills' },
  { key: 'agents', label: 'Agents' },
  { key: 'mcp', label: 'MCP' },
];

function LensIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" />
    </svg>
  );
}

function PinIcon({ filled }: { filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10.5 1.7 14.3 5.5 12.5 7.3 12 11l-2.5-2.5L5 13l-1-1 4.5-4.5L6 5l3.7-.5z" />
    </svg>
  );
}

function projectName(p: Project): string {
  return projectDisplayName(p.realPath);
}

function includesQuery(q: string, values: Array<string | undefined | null>): boolean {
  if (!q) return true;
  return values.some(v => (v ?? '').toLowerCase().includes(q));
}

function shortWhen(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mcpDisplayName(server: McpServer): string {
  return server.name.replace(/^claude\.ai\s*/i, '');
}

function mcpDetail(server: McpServer, totalProjects: number): string {
  if (server.source === 'local') {
    const envCount = server.env ? Object.keys(server.env).length : 0;
    if (server.command)
      return `${server.command}${server.args?.length ? ` ${server.args.join(' ')}` : ''}`;
    return envCount > 0 ? `${envCount} env vars` : 'local server';
  }
  const denom =
    totalProjects > 0 ? totalProjects : server.enabledInProjects + server.disabledInProjects;
  return `active in ${server.enabledInProjects} of ${denom} projects`;
}

function sortedByName<T>(items: T[], nameOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => nameOf(a).toLowerCase().localeCompare(nameOf(b).toLowerCase()));
}

export function SearchPopover({
  open,
  mode = 'global',
  anchorRect,
  anchorAlign = 'right',
  projects,
  costByHash,
  currentHash,
  pinned,
  skills = [],
  agents = [],
  mcpServers = [],
  mcpTotalProjects = 0,
  sessions = [],
  sessionsLoading = false,
  pinnedSessions,
  onTogglePin,
  onToggleSessionPin,
  onSelectProject,
  onSelectSkill,
  onSelectAgent,
  onSelectMcp,
  onSelectSession,
  onDeleteCurrent,
  onClose,
}: {
  open: boolean;
  mode?: SearchMode;
  anchorRect: DOMRect | null;
  anchorAlign?: SearchAnchorAlign;
  projects: Project[];
  costByHash: Map<string, ProjectCost>;
  currentHash?: string | null;
  pinned: Set<string>;
  skills?: Skill[];
  agents?: Agent[];
  mcpServers?: McpServer[];
  mcpTotalProjects?: number;
  sessions?: SearchSession[];
  sessionsLoading?: boolean;
  pinnedSessions?: (projectHash: string, sessionFilename: string) => boolean;
  onTogglePin: (hash: string) => void;
  onToggleSessionPin?: (projectHash: string, sessionFilename: string) => void;
  onSelectProject: (p: Project) => void;
  onSelectSkill?: (skill: Skill) => void;
  onSelectAgent?: (agent: Agent) => void;
  onSelectMcp?: (server: McpServer) => void;
  onSelectSession?: (project: Project, session: SessionSummary) => void;
  onDeleteCurrent?: (project: Project) => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [hl, setHl] = useState(0);
  const [activeFilter, setActiveFilter] = useState<SearchFilter>('all');

  // Reset the search buffer each time the popover opens or switches mode
  // (render-time adjustment; the focus side-effect stays in the effect below).
  const resetKey = open ? mode : 'closed';
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    if (open) {
      setQuery('');
      setHl(0);
      setActiveFilter(mode === 'projects' ? 'projects' : 'all');
    }
  }

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(id);
  }, [mode, open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (popRef.current?.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const { sections, flat, counts } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchesProject = (p: Project) => includesQuery(q, [projectName(p), p.realPath]);
    const projectRows = sortedByName(projects.filter(matchesProject), projectName).map(
      (p): ProjectRow => {
        const cost = costByHash.get(p.hash);
        return {
          kind: 'project',
          key: `project:${p.hash}`,
          project: p,
          title: projectName(p),
          detail: p.realPath,
          meta: `${cost?.sessionsCount ?? 0} sessions`,
          pinned: pinned.has(p.hash),
          current: p.hash === currentHash,
        };
      }
    );
    const pinnedProjects = projectRows.filter(r => r.pinned);
    const otherProjects = projectRows.filter(r => !r.pinned);

    const skillRows: EntityRow[] = sortedByName(
      skills.filter(s =>
        includesQuery(q, [s.name, s.description, s.path, s.scope, s.model, s.agent])
      ),
      s => s.name
    ).map(s => ({
      kind: 'skill',
      key: `skill:${s.path}`,
      skill: s,
      title: `/${s.name}`,
      detail: s.description || s.path,
      meta: s.scope,
      glyph: '/',
    }));

    const agentRows: EntityRow[] = sortedByName(
      agents.filter(a =>
        includesQuery(q, [
          a.name,
          a.description,
          a.path,
          a.scope,
          a.model,
          ...(a.skills ?? []),
          ...(a.mcpServers ?? []),
        ])
      ),
      a => a.name
    ).map(a => ({
      kind: 'agent',
      key: `agent:${a.path}`,
      agent: a,
      title: a.name,
      detail: a.description || a.path,
      meta: a.model ? `${a.scope} · ${fmtModel(a.model)}` : a.scope,
      glyph: 'A',
    }));

    const mcpRows: EntityRow[] = sortedByName(
      mcpServers.filter(s =>
        includesQuery(q, [
          s.name,
          mcpDisplayName(s),
          s.source,
          s.command,
          ...(s.args ?? []),
          ...(s.env ? Object.keys(s.env) : []),
        ])
      ),
      mcpDisplayName
    ).map(s => ({
      kind: 'mcp',
      key: `mcp:${s.source}:${s.name}`,
      server: s,
      title: mcpDisplayName(s),
      detail: mcpDetail(s, mcpTotalProjects),
      meta: s.source,
      glyph: 'M',
    }));

    const sessionRowsAll: EntityRow[] = [...sessions]
      .filter(({ project, session }) =>
        includesQuery(q, [
          sessionTitle(session, 160),
          session.firstUserMessage,
          session.customTitle,
          session.aiTitle,
          session.filename,
          session.model,
          projectName(project),
          project.realPath,
        ])
      )
      .sort((a, b) => new Date(b.session.date).getTime() - new Date(a.session.date).getTime())
      .map(({ project, session }) => ({
        kind: 'session' as const,
        key: `session:${project.hash}:${session.filename}`,
        project,
        session,
        title: sessionTitle(session),
        detail: project.realPath,
        meta: `${session.messageCount} msg · ${shortWhen(session.date)}`,
        glyph: '#',
        pinned: pinnedSessions ? pinnedSessions(project.hash, session.filename) : false,
      }));
    const pinnedSessionRows = sessionRowsAll.filter(r => r.kind === 'session' && r.pinned);
    const otherSessionRows = sessionRowsAll.filter(r => !(r.kind === 'session' && r.pinned));

    const counts = {
      projects: projectRows.length,
      sessions: sessionRowsAll.length,
      skills: skillRows.length,
      agents: agentRows.length,
      mcp: mcpRows.length,
    };

    const out: SearchSection[] = [];
    const shouldShow = (kind: Exclude<SearchFilter, 'all'>) =>
      mode === 'projects' ? kind === 'projects' : activeFilter === 'all' || activeFilter === kind;
    const limitRows = (rows: SearchRow[]) => {
      if (mode === 'projects' || activeFilter !== 'all') return rows;
      return rows.slice(0, q ? 8 : 5);
    };

    if (shouldShow('projects')) {
      const pinnedVisible = limitRows(pinnedProjects);
      const otherVisible = limitRows(otherProjects);
      if (pinnedVisible.length > 0)
        out.push({
          key: 'pinned',
          title: 'Pinned projects',
          count: pinnedProjects.length,
          rows: pinnedVisible,
        });
      if (otherVisible.length > 0)
        out.push({
          key: 'projects',
          title: 'Projects',
          count: otherProjects.length,
          rows: otherVisible,
        });
    }
    if (shouldShow('sessions')) {
      const pinnedVisible = limitRows(pinnedSessionRows);
      const otherVisible = limitRows(otherSessionRows);
      if (pinnedVisible.length > 0)
        out.push({
          key: 'pinned-sessions',
          title: 'Pinned sessions',
          count: pinnedSessionRows.length,
          rows: pinnedVisible,
        });
      if (otherVisible.length > 0)
        out.push({
          key: 'sessions',
          title: 'Sessions',
          count: otherSessionRows.length,
          rows: otherVisible,
        });
    }
    if (shouldShow('skills') && skillRows.length > 0)
      out.push({
        key: 'skills',
        title: 'Skills',
        count: skillRows.length,
        rows: limitRows(skillRows),
      });
    if (shouldShow('agents') && agentRows.length > 0)
      out.push({
        key: 'agents',
        title: 'Agents',
        count: agentRows.length,
        rows: limitRows(agentRows),
      });
    if (shouldShow('mcp') && mcpRows.length > 0)
      out.push({ key: 'mcp', title: 'MCP', count: mcpRows.length, rows: limitRows(mcpRows) });

    return { sections: out, flat: out.flatMap(s => s.rows), counts };
  }, [
    activeFilter,
    agents,
    costByHash,
    currentHash,
    mcpServers,
    mcpTotalProjects,
    mode,
    pinned,
    pinnedSessions,
    projects,
    query,
    sessions,
    skills,
  ]);

  // Keep the highlighted row within range when the result set shrinks
  // (render-time adjustment — converges as hl drops back into range).
  if (hl > 0 && hl >= flat.length) {
    setHl(Math.max(0, flat.length - 1));
  }

  function selectRow(row: SearchRow) {
    if (row.kind === 'project') onSelectProject(row.project);
    else if (row.kind === 'skill') onSelectSkill?.(row.skill);
    else if (row.kind === 'agent') onSelectAgent?.(row.agent);
    else if (row.kind === 'mcp') onSelectMcp?.(row.server);
    else if (row.kind === 'session') onSelectSession?.(row.project, row.session);
    onClose();
  }

  function moveFilter(delta: -1 | 1) {
    if (mode !== 'global') return;
    const currentIdx = FILTERS.findIndex(f => f.key === activeFilter);
    const nextIdx = (currentIdx + delta + FILTERS.length) % FILTERS.length;
    setActiveFilter(FILTERS[nextIdx].key);
    setHl(0);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHl(h => Math.min(Math.max(0, flat.length - 1), h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHl(h => Math.max(0, h - 1));
    } else if (e.key === 'ArrowRight' && mode === 'global') {
      e.preventDefault();
      moveFilter(1);
    } else if (e.key === 'ArrowLeft' && mode === 'global') {
      e.preventDefault();
      moveFilter(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = flat[hl];
      if (row) selectRow(row);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
      const row = flat[hl];
      if (row?.kind === 'project') {
        e.preventDefault();
        onTogglePin(row.project.hash);
      } else if (row?.kind === 'session') {
        e.preventDefault();
        onToggleSessionPin?.(row.project.hash, row.session.filename);
      }
    }
  }

  if (!open) return null;

  const popWidth = Math.min(mode === 'projects' ? 420 : 520, Math.max(320, window.innerWidth - 24));
  let top = 60;
  let left = window.innerWidth - popWidth - 24;
  if (anchorRect) {
    top = anchorRect.bottom + 8;
    const desiredLeft = anchorAlign === 'left' ? anchorRect.left : anchorRect.right - popWidth;
    left = Math.max(12, Math.min(window.innerWidth - popWidth - 12, desiredLeft));
  }

  const totalCount = counts.projects + counts.sessions + counts.skills + counts.agents + counts.mcp;
  const currentProject = currentHash ? projects.find(p => p.hash === currentHash) : undefined;
  const placeholder =
    mode === 'projects' ? 'Switch project' : 'Search projects, sessions, skills, agents, MCP';

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className={`cl-search-pop${mode === 'projects' ? ' project-only' : ''}`}
      style={{ top, left, width: popWidth }}
      onClick={e => e.stopPropagation()}
    >
      <div className="cl-search-row">
        <LensIcon />
        <input
          ref={inputRef}
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setHl(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="button" className="esc-key" onClick={onClose}>
          esc
        </button>
      </div>

      {mode === 'global' && (
        <div className="cl-search-filters" aria-label="Search filters">
          {FILTERS.map(f => {
            const count = f.key === 'all' ? totalCount : counts[f.key];
            return (
              <button
                key={f.key}
                type="button"
                className={`${activeFilter === f.key ? 'on' : ''}${count === 0 ? ' empty' : ''}`}
                onClick={() => {
                  setActiveFilter(f.key);
                  setHl(0);
                }}
              >
                {f.label}
                <span>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="cl-search-list">
        {sections.length === 0 ? (
          <div className="cl-search-empty">
            {mode === 'projects' ? (
              <>No projects match &ldquo;{query}&rdquo;</>
            ) : sessionsLoading && activeFilter === 'sessions' ? (
              'Loading sessions…'
            ) : (
              <>No results match &ldquo;{query}&rdquo;</>
            )}
          </div>
        ) : (
          sections.map(section => (
            <Fragment key={section.key}>
              <div className="cl-search-section">
                {section.title} <span className="ct">· {section.count}</span>
              </div>
              {section.rows.map(row =>
                row.kind === 'project' ? (
                  <ProjectSearchItem
                    key={row.key}
                    row={row}
                    flatIdx={flat.indexOf(row)}
                    hl={hl}
                    setHl={setHl}
                    onTogglePin={onTogglePin}
                    onSelect={() => selectRow(row)}
                  />
                ) : (
                  <EntitySearchItem
                    key={row.key}
                    row={row}
                    flatIdx={flat.indexOf(row)}
                    hl={hl}
                    setHl={setHl}
                    onSelect={() => selectRow(row)}
                    onTogglePin={
                      row.kind === 'session' && onToggleSessionPin
                        ? () => onToggleSessionPin(row.project.hash, row.session.filename)
                        : undefined
                    }
                  />
                )
              )}
            </Fragment>
          ))
        )}
      </div>

      <div className="cl-search-foot">
        <span>
          <kbd>↑↓</kbd>navigate
        </span>
        {mode === 'global' && (
          <span>
            <kbd>←→</kbd>tabs
          </span>
        )}
        <span>
          <kbd>↵</kbd>open
        </span>
        <span>
          <kbd>⌘P</kbd>pin
        </span>
        {sessionsLoading && mode === 'global' && <span>loading sessions</span>}
        {mode === 'projects' && currentProject && onDeleteCurrent && (
          <button
            type="button"
            className="cl-search-danger"
            onClick={() => {
              onDeleteCurrent(currentProject);
              onClose();
            }}
          >
            Remove current
          </button>
        )}
      </div>
    </div>
  );
}

function ProjectSearchItem({
  row,
  flatIdx,
  hl,
  setHl,
  onTogglePin,
  onSelect,
}: {
  row: ProjectRow;
  flatIdx: number;
  hl: number;
  setHl: (n: number) => void;
  onTogglePin: (hash: string) => void;
  onSelect: () => void;
}) {
  return (
    <div
      role="option"
      aria-selected={flatIdx === hl}
      className={`cl-search-item${row.current ? ' active' : ''}${flatIdx === hl ? ' hl' : ''}`}
      onMouseEnter={() => setHl(flatIdx)}
      onClick={onSelect}
    >
      <span className="pname-line">
        <span className="pname">{row.title}</span>
        <span className="pdot" />
        <span className="ppath">{row.detail}</span>
      </span>
      <span className="pmeta">
        <b>{row.meta.split(' ')[0]}</b> {row.meta.split(' ').slice(1).join(' ')}
      </span>
      <button
        type="button"
        className={`cl-pin-toggle${row.pinned ? ' pinned' : ''}`}
        title={row.pinned ? 'Unpin project' : 'Pin project'}
        aria-label={row.pinned ? 'Unpin project' : 'Pin project'}
        onClick={e => {
          e.stopPropagation();
          onTogglePin(row.project.hash);
        }}
      >
        <PinIcon filled={row.pinned} />
      </button>
    </div>
  );
}

function EntitySearchItem({
  row,
  flatIdx,
  hl,
  setHl,
  onSelect,
  onTogglePin,
}: {
  row: EntityRow;
  flatIdx: number;
  hl: number;
  setHl: (n: number) => void;
  onSelect: () => void;
  onTogglePin?: () => void;
}) {
  const isSessionPinned = row.kind === 'session' && row.pinned;
  const showPin = row.kind === 'session' && !!onTogglePin;
  return (
    <div
      role="option"
      aria-selected={flatIdx === hl}
      className={`cl-search-item entity ${row.kind}${flatIdx === hl ? ' hl' : ''}${isSessionPinned ? ' is-pinned' : ''}${showPin ? ' has-pin' : ''}`}
      onMouseEnter={() => setHl(flatIdx)}
      onClick={onSelect}
    >
      <span className="eglyph">{row.glyph}</span>
      <span className="pname-line">
        <span className="pname">{row.title}</span>
        <span className="pdot" />
        <span className="ppath">{row.detail}</span>
      </span>
      <span className="ekind">{row.kind}</span>
      <span className="pmeta">{row.meta}</span>
      {showPin && (
        <button
          type="button"
          className={`cl-pin-toggle${isSessionPinned ? ' pinned' : ''}`}
          title={isSessionPinned ? 'Unpin session' : 'Pin session'}
          aria-label={isSessionPinned ? 'Unpin session' : 'Pin session'}
          onClick={e => {
            e.stopPropagation();
            onTogglePin?.();
          }}
        >
          <PinIcon filled={isSessionPinned} />
        </button>
      )}
    </div>
  );
}

export function LensTriggerIcon() {
  return <LensIcon />;
}

export { PinIcon };
