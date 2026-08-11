import { CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import {
  useActiveSessions,
  useAllSkills,
  useChatSession,
  useEffectiveConfig,
  useGlobalAgents,
  useMemoryProject,
  useProjectAgents,
  useProjectTasks,
  useProjectTeams,
  usePlugins,
  useSessionList,
  useSessionSubagents,
} from '../../../hooks/useIPC';
import type { Agent, MemoryTopic, Skill } from '../../../hooks/useIPC';
import type { InitInfo, TeamSummary } from '../../../types';
import { liveLeadSession, teamLabel } from '../teams/utils';
import {
  buildMemoryActivity,
  buildProcessedMessages,
  correlateSessionAgents,
  correlateSessionSkills,
  isMemoryFile,
  skillHasViewableOutput,
  AGENT_TOOLS,
  ToolGroup,
  SessionAgent,
} from '../chat/utils';
import { FileIcon } from '../chat/fileIcons';
import { QueryError } from '../../QueryError';
import { fmtCost, fmt } from '../utils';
import { deriveContext } from './context-window';
import {
  buildFileChanges,
  buildMissionFeed,
  countByKind,
  editStats,
  shortAgo,
  FEED_KINDS,
} from './mission-feed';
import type { FeedEvent, FeedKind } from './mission-feed';

/**
 * The Mission Control rail beside the unified Terminal/Lens view — design "1d ·
 * Feed".
 *
 * The rail used to be a taxonomy: a block per species (TEAMS, AGENTS, SKILLS,
 * MEMORY, CHANGES, TASKS), each with its own eyebrow, each weighing the same.
 * Nothing arrived first, so answering "what needs me right now?" meant reading
 * the whole rail. This version drops the taxonomy for **one chronological
 * stream**: every meaningful unit of the session — a sub-agent, a team, a skill
 * run, a memory topic, a touched file, a task — is an event on the same feed,
 * newest first, with anything still running floated to the top and tinted live.
 * The species survive as **filters** over that stream, not as sections, so they
 * no longer compete for the reader's attention; the filter pills double as the
 * counts the eyebrows used to carry.
 *
 * Above the feed sits a single pinned band: a compact vitals line (context %,
 * spend, the session's net diff and file count) over a 2px context fill. The
 * old 52px CONTEXT number and the SPEND/TASKS gauges are gone — in a feed the
 * emphasis belongs to the events, and what the gauges encoded now rides the
 * line's tooltips (used/left/total, cache savings) and the TASKS pill, which
 * counts `done/total` instead of a bare number. The read-only session
 * ENVIRONMENT (permission mode, capability counts, failed MCP) is state, not an
 * event, so it holds a slim strip pinned at the bottom.
 *
 * Rows are single click targets, as a feed should be: an agent opens its
 * transcript (falling back to its definition when no transcript exists yet), a
 * team opens the team detail, a skill routes output → definition → tool call, a
 * file or memory topic touched once opens that operation and touched many times
 * expands into its operations, a task expands into its live form / description /
 * dependencies.
 *
 * All of it derives from data the watcher already refreshes (`sessions:chat`,
 * `sessions:subagents`, `tasks:project`, `sessions:project`, `teams:project`),
 * so the rail is live without any dedicated IPC. The event model — timestamps
 * included, which is the hard part for tasks — is pure and unit-tested in
 * `mission-feed.ts`.
 *
 * Note this rail is chrome shared with the Terminal view, not just the Lens, so
 * the two halves of Mission Control read as one surface whichever tab is up.
 */

const RAIL_MIN = 380;
const RAIL_MAX = 560;

/** Compact token count for the vitals line: 156_312 → "156k", 1_240_000 → "1.2M". */
function kTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}

/**
 * A clock the feed can read during render.
 *
 * The relative ages in the time gutter ("7m") are the one thing here that goes
 * stale with no file changing, so they can't ride the watcher: a session that
 * stops writing would freeze every row's age at the last event. This ticks on
 * its own, coarsely — a minute-resolution label needs nothing finer, and a
 * per-second interval would re-render the whole rail 60× for the same string.
 */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/* ── presentational atoms ─────────────────────────────────────────────── */

/** +N −N, tabular. */
function DiffNum({ added, removed, size = 9 }: { added: number; removed: number; size?: number }) {
  return (
    <span
      className="font-mono shrink-0"
      style={{
        fontSize: size,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        gap: 6,
      }}
    >
      <span style={{ color: 'var(--cl-ok)' }}>+{fmt(added)}</span>
      <span style={{ color: 'var(--cl-danger)' }}>−{fmt(removed)}</span>
    </span>
  );
}

const PERM_LABEL: Record<string, string> = {
  default: 'DEFAULT',
  acceptEdits: 'ACCEPT EDITS',
  plan: 'PLAN MODE',
  bypassPermissions: 'BYPASS',
};

/**
 * Read-only session environment from the Agent SDK init handshake — captured by
 * aborting a one-turn query *before* any model turn, so it costs zero tokens
 * (see config-reader.ts). Surfaces what the TUI never shows: the resolved
 * permission mode and how much capability is wired up (tools/skills/agents
 * available, not just what happened to run).
 *
 * It is pinned under the feed rather than dropped into it: none of this is an
 * event — it is the session's standing setup, true for every row above it.
 *
 * MCP is deliberately *not* counted: the globally-configured gateway servers
 * (claude.ai/*) sit pending/needs-auth in every project and never get used, so
 * a total is the same noise everywhere. Only `failed` servers earn a line, since
 * a connection that broke is the one MCP signal actually worth acting on.
 */
function EnvironmentStrip({ init }: { init: InitInfo | null }) {
  if (!init) return null;
  const perm = PERM_LABEL[init.permissionMode] ?? init.permissionMode.toUpperCase();
  const danger = init.permissionMode === 'bypassPermissions';
  const failedMcp = init.mcpServers.filter(s => {
    const s2 = s.status.toLowerCase();
    return s2 === 'failed' || s2.includes('error');
  });
  const caps = [
    { label: 'TOOLS', n: init.tools.length },
    { label: 'SKILLS', n: init.skills.length },
    { label: 'AGENTS', n: init.agents.length },
  ].filter(c => c.n > 0);
  return (
    <div
      className="shrink-0"
      style={{ borderTop: '1px solid var(--cl-line)', padding: '10px 20px' }}
    >
      <div className="flex items-center" style={{ gap: 10 }}>
        <span
          className="font-mono"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.12em',
            padding: '3px 8px',
            borderRadius: 999,
            color: danger ? 'var(--cl-on-accent)' : 'var(--cl-ink-2)',
            background: danger ? 'var(--cl-danger)' : 'transparent',
            border: `1px solid ${danger ? 'var(--cl-danger)' : 'var(--cl-line)'}`,
          }}
          title="Resolved permission mode for this session"
        >
          {perm}
        </span>
        <span style={{ flex: 1 }} />
        {caps.map(c => (
          <span
            key={c.label}
            className="font-mono"
            style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--cl-ink-4)' }}
          >
            <b style={{ fontWeight: 700, color: 'var(--cl-ink-2)' }}>{c.n}</b> {c.label}
          </span>
        ))}
      </div>
      {failedMcp.length > 0 && (
        <div className="flex flex-wrap items-center" style={{ gap: 8, marginTop: 8 }}>
          <span
            className="font-mono shrink-0"
            style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--cl-danger)' }}
          >
            MCP FAILED
          </span>
          {failedMcp.map(s => (
            <span
              key={s.name}
              className="font-mono truncate"
              style={{ fontSize: 10, color: 'var(--cl-ink-3)' }}
              title={`MCP server "${s.name}" failed to connect`}
            >
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── the feed ─────────────────────────────────────────────────────────── */

/** The row's 20px badge: a tinted square carrying a glyph — or, for a file, the
 *  real language logo, which says more than two mono letters ever could. */
function FeedGlyph({ e }: { e: FeedEvent }) {
  return (
    <span
      aria-hidden
      className="font-mono inline-flex items-center justify-center shrink-0"
      style={{
        width: 20,
        height: 20,
        borderRadius: 5,
        background: e.glyphTint,
        color: '#fff',
        font: '700 9px/1 var(--font-mono)',
      }}
    >
      {e.ext !== undefined ? <FileIcon ext={e.ext} /> : e.glyph}
    </span>
  );
}

/** One event in the stream: time · badge · title/meta · status. A single click
 *  target — it either opens the event's destination or, when the event bundles
 *  several operations (or a task carries detail), discloses them below. */
function FeedRow({
  e,
  now,
  compact,
  open,
  onActivate,
}: {
  e: FeedEvent;
  now: number;
  compact: boolean;
  open: boolean;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      className={`tmc-row${e.live ? ' tmc-row--live' : ''}`}
      onClick={onActivate}
      title={[e.title, e.meta].filter(Boolean).join('\n')}
      style={{
        display: 'grid',
        gridTemplateColumns: '34px 20px minmax(0,1fr) auto',
        alignItems: 'center',
        gap: 9,
        width: '100%',
        textAlign: 'left',
        padding: `${compact ? 6 : 8}px 6px`,
        margin: '0 -6px',
        borderRadius: 6,
        border: 0,
        cursor: 'pointer',
      }}
    >
      <span
        className="font-mono"
        style={{
          fontSize: 9,
          letterSpacing: '0.06em',
          fontVariantNumeric: 'tabular-nums',
          color: e.live ? 'var(--cl-violet-ink)' : 'var(--cl-ink-4)',
        }}
      >
        {shortAgo(e.at, now, e.live)}
      </span>
      <FeedGlyph e={e} />
      <span className="min-w-0">
        <span
          className="truncate"
          style={{
            display: 'block',
            font: `500 ${compact ? 12 : 12.5}px/1.3 var(--font-sans)`,
            color: e.danger ? 'var(--cl-danger)' : 'var(--cl-ink)',
          }}
        >
          {e.title}
          {e.expandable && <span style={{ color: 'var(--cl-ink-4)' }}> {open ? '▾' : '▸'}</span>}
        </span>
        {e.meta && (
          <span
            className="font-mono truncate"
            style={{ display: 'block', fontSize: 9, color: 'var(--cl-ink-4)', marginTop: 2 }}
          >
            {e.meta}
          </span>
        )}
      </span>
      {e.rightDiff ? (
        <DiffNum added={e.rightDiff.added} removed={e.rightDiff.removed} />
      ) : (
        <span
          className="font-mono shrink-0"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.08em',
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
            color: e.rightTint,
          }}
        >
          {e.right}
        </span>
      )}
    </button>
  );
}

/** Disclosure under a bundled row: one line per operation, newest first. */
function FeedOperations({
  items,
  onOpenTool,
}: {
  items: ToolGroup[];
  onOpenTool: (g: ToolGroup) => void;
}) {
  return (
    <>
      {[...items].reverse().map((g, i) => {
        const stats = editStats(g);
        return (
          <button
            key={g.use.id || i}
            type="button"
            className="tmc-row w-full text-left flex items-center gap-2"
            onClick={() => onOpenTool(g)}
            style={{ padding: '3px 6px 3px 69px', margin: '0 -6px', fontSize: 10.5 }}
          >
            <span style={{ color: 'var(--cl-ink-3)' }}>{g.use.name}</span>
            {g.result?.isError && (
              <span className="font-mono" style={{ fontSize: 9, color: 'var(--cl-danger)' }}>
                ERROR
              </span>
            )}
            {stats && (
              <span className="ml-auto">
                <DiffNum added={stats.added} removed={stats.removed} />
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

/** Disclosure under a task row — the detail the dedicated Tasks page shows. */
function TaskDetail({
  event,
  fontSize,
}: {
  event: Extract<FeedEvent['source'], { kind: 'task' }>;
  fontSize: number;
}) {
  const t = event.task;
  const liveForm = t.status === 'in_progress' ? t.activeForm?.trim() : '';
  return (
    <div
      style={{
        padding: '4px 6px 8px 69px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {liveForm && (
        <span style={{ fontSize, lineHeight: 1.45, color: 'var(--cl-ok)', fontWeight: 600 }}>
          ⟳ {liveForm}…
        </span>
      )}
      {t.description?.trim() && (
        <span style={{ fontSize, lineHeight: 1.5, color: 'var(--cl-ink-2)' }}>{t.description}</span>
      )}
      {(t.blockedBy.length > 0 || t.blocks.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {t.blockedBy.length > 0 && (
            <span className="font-mono" style={{ fontSize: 9.5, color: 'var(--cl-ink-4)' }}>
              <span style={{ color: 'var(--cl-danger)', letterSpacing: '0.06em' }}>BLOCKED BY</span>{' '}
              {t.blockedBy.map(id => `#${id}`).join(' ')}
            </span>
          )}
          {t.blocks.length > 0 && (
            <span className="font-mono" style={{ fontSize: 9.5, color: 'var(--cl-ink-4)' }}>
              <span style={{ letterSpacing: '0.06em' }}>BLOCKS</span>{' '}
              {t.blocks.map(id => `#${id}`).join(' ')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ── the rail ─────────────────────────────────────────────────────────── */

export function MissionRail({
  hash,
  sessionId,
  realPath,
  width,
  onWidthChange,
  onOpenTool,
  onOpenAgent,
  onOpenSkillDef,
  onOpenAgentDef,
  onOpenTeam,
}: {
  hash: string;
  /** Null until the CLI registers itself in `~/.claude/sessions/` (a few seconds). */
  sessionId: string | null;
  realPath: string;
  width: number;
  onWidthChange: (w: number) => void;
  /** Detail views need width: the parent opens them as a wide overlay. */
  onOpenTool: (group: ToolGroup) => void;
  onOpenAgent: (agent: SessionAgent) => void;
  /** Deep-link a skill row to its definition (read-only overlay in the parent). */
  onOpenSkillDef: (skill: Skill) => void;
  /** Deep-link an agent row to its definition — the fallback destination when
   *  the sub-agent has no transcript on disk yet. */
  onOpenAgentDef: (agent: Agent) => void;
  /** Open a team's detail (the existing TeamDetailView, hosted in the parent's overlay). */
  onOpenTeam: (teamName: string) => void;
}) {
  const filename = sessionId ? `${sessionId}.jsonl` : null;
  const { data: messages, isError, error, refetch } = useChatSession(hash, filename);
  const { data: subagentMetas } = useSessionSubagents(hash, filename);
  const { data: taskGroups } = useProjectTasks(hash);
  const { data: sessionList } = useSessionList(hash);
  // The raw `model` setting (e.g. `opus[1m]`) carries the 1M-context marker the
  // transcript's resolved id drops — used only to size the CONTEXT fill.
  const { data: effectiveConfig } = useEffectiveConfig(realPath);
  const rawModel =
    typeof effectiveConfig?.effective?.model === 'string'
      ? (effectiveConfig.effective.model as string)
      : undefined;
  // The SDK init handshake (zero token cost) — surfaced read-only in the footer.
  const init = effectiveConfig?.init ?? null;
  // The skills registry — lets a typed `/foo` skill be recognised by a name match
  // even when its post-command expansion marker isn't visible (same source the
  // Lens footer dock uses, so the rail and the dock stay in agreement).
  const { data: allSkills } = useAllSkills(realPath);
  // Plugins resolve namespaced agentic skills (`document-skills:pdf`) to their
  // definition; the agent registries resolve a sub-agent's `subagent_type` to its
  // definition so a row with no transcript can still reach the agent config.
  const { data: plugins } = usePlugins();
  const { data: globalAgents } = useGlobalAgents();
  const { data: projectAgents } = useProjectAgents(realPath);
  const agentDefOf = useMemo(() => {
    const byName = new Map<string, Agent>();
    for (const a of globalAgents ?? []) byName.set(a.name, a);
    for (const a of projectAgents ?? []) byName.set(a.name, a);
    return (subagentType: string) => byName.get(subagentType);
  }, [globalAgents, projectAgents]);

  // Live activity of *this* CLI session, from the registry (busy/idle/waiting) —
  // the one signal that updates in real time. The persisted transcript records a
  // sub-agent only once it has finished (dispatch + result share one flush), so
  // it can't say "working now"; the parent session's status can.
  const { data: activeSessions } = useActiveSessions();
  const liveStatus = useMemo(
    () => activeSessions?.find(s => s.sessionId === sessionId)?.status,
    [activeSessions, sessionId]
  );

  // Agent teams — scoped to the focused session (a team is launched inside one
  // session: the lead *is* the session). Matching spans every rotated lead
  // sessionId; the stale-prone config lead id is only a secondary signal, never
  // the sole anchor.
  const { data: teams } = useProjectTeams(hash);
  const projectTeamCount = teams?.length ?? 0;
  const teamRows = useMemo(() => {
    if (!sessionId) return [];
    return (teams ?? [])
      .filter(
        team => team.sessionIds.includes(sessionId) || team.leadSessionIdFromConfig === sessionId
      )
      .map((team: TeamSummary) => ({
        team,
        title: teamLabel(
          team,
          sessionList?.find(s => s.filename === team.filename)
        ),
        live: !!liveLeadSession(team, activeSessions ?? []),
      }));
  }, [teams, activeSessions, sessionList, sessionId]);

  const [filter, setFilter] = useState<FeedKind | 'ALL'>('ALL');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const [compact, setCompact] = useState<boolean>(
    () => localStorage.getItem('tmc-density') !== 'comfortable'
  );
  const toggleCompact = useCallback(() => {
    setCompact(v => {
      localStorage.setItem('tmc-density', v ? 'comfortable' : 'compact');
      return !v;
    });
  }, []);

  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      const onMove = (ev: PointerEvent) => {
        onWidthChange(
          Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(window.innerWidth - ev.clientX)))
        );
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    },
    [onWidthChange]
  );

  const processed = useMemo(() => (messages ? buildProcessedMessages(messages) : []), [messages]);
  const agents = useMemo(
    () => correlateSessionAgents(processed, subagentMetas ?? []),
    [processed, subagentMetas]
  );
  // SKILLS — the same correlation the Lens footer dock uses, so the rail and the
  // dock never disagree. Catches agentic `Skill` tool_uses and slash-command
  // skills; the latter are matched by the post-command skill-expansion marker OR
  // a name hit against the skills registry.
  const skills = useMemo(
    () => correlateSessionSkills(processed, allSkills ?? [], plugins ?? []),
    [processed, allSkills, plugins]
  );
  const ownTools = useMemo(
    () => processed.flatMap(p => p.toolGroups).filter(g => !AGENT_TOOLS.has(g.use.name)),
    [processed]
  );
  // MEMORY — an `Edit` of a topic carries no frontmatter, so the on-disk index
  // supplies the name and description; the query is already mounted by the
  // memory views and the watcher keeps it fresh.
  const { data: memory } = useMemoryProject(hash);
  const memoryLookup = useMemo(() => {
    const byFilename = new Map<string, MemoryTopic>();
    for (const t of memory?.index ?? []) byFilename.set(t.filename, t);
    for (const t of memory?.projectLevelIndex ?? []) byFilename.set(t.filename, t);
    return (path: string) => byFilename.get(path.replace(/\\/g, '/').split('/').pop() ?? path);
  }, [memory]);
  const memoryActivity = useMemo(
    () => buildMemoryActivity(ownTools, memoryLookup),
    [ownTools, memoryLookup]
  );
  // CHANGES excludes the memory files: they are a topic each, not a diff, and
  // reporting them twice would double-count the session's line totals.
  const changes = useMemo(
    () =>
      buildFileChanges(ownTools.filter(g => !isMemoryFile(g.use.input as Record<string, unknown>))),
    [ownTools]
  );
  const totals = useMemo(
    () =>
      changes.reduce(
        (acc, c) => ({ added: acc.added + c.added, removed: acc.removed + c.removed }),
        { added: 0, removed: 0 }
      ),
    [changes]
  );
  const tasks = useMemo(
    () => taskGroups?.find(g => g.sessionId === sessionId)?.tasks ?? [],
    [taskGroups, sessionId]
  );
  const summary = useMemo(
    () => sessionList?.find(s => s.filename === filename),
    [sessionList, filename]
  );

  const ctx = useMemo(() => deriveContext(messages, rawModel), [messages, rawModel]);

  // Assistant turns, excluding the synthetic notes Claude Code persists for local
  // slash-command output (not real model turns).
  const turns = useMemo(
    () => messages?.filter(m => m.role === 'assistant' && m.model !== '<synthetic>').length ?? 0,
    [messages]
  );

  // One `now` per render: every relative label in the feed reads the same clock,
  // so two rows a millisecond apart can't disagree about what "5m" means.
  const now = useNow();
  const feed = useMemo(
    () =>
      buildMissionFeed({
        processed,
        ownTools,
        agents,
        skills,
        memory: memoryActivity,
        changes,
        tasks,
        teams: teamRows,
        realPath,
        now,
      }),
    [processed, ownTools, agents, skills, memoryActivity, changes, tasks, teamRows, realPath, now]
  );
  const counts = useMemo(() => countByKind(feed), [feed]);
  const visible = useMemo(
    () => (filter === 'ALL' ? feed : feed.filter(e => e.kind === filter)),
    [feed, filter]
  );

  // Cache savings as a share of the bill that would have been paid without cache.
  const savings = summary?.cacheSavings ?? 0;
  const savingsPct =
    summary && summary.estimatedCost + savings > 0
      ? Math.round((savings / (summary.estimatedCost + savings)) * 100)
      : 0;

  const doneTasks = tasks.filter(t => t.status === 'completed').length;
  const pct = ctx?.pct ?? 0;
  const ctxDanger = !!ctx && pct >= 90;

  // The filter pills: only species the session actually produced, plus TEAMS
  // whenever the *project* has teams — so "no teams anywhere" (no pill) and "no
  // teams in this session" (pill, count 0, explicit empty state) stay apart.
  const filters = useMemo(() => {
    const kinds = FEED_KINDS.filter(k => counts[k] > 0 || (k === 'TEAMS' && projectTeamCount > 0));
    return [
      { key: 'ALL' as const, label: 'ALL', n: String(feed.length) },
      ...kinds.map(k => ({
        key: k,
        label: k,
        // TASKS carries the ratio the old gauge used to show — a bare count
        // would say how many tasks exist and never how far they got.
        n: k === 'TASKS' ? `${doneTasks}/${counts.TASKS}` : String(counts[k]),
      })),
    ];
  }, [counts, feed.length, projectTeamCount, doneTasks]);

  const empty = feed.length === 0;

  // Nastro: flat paper, no accent wash. The rail takes a hairline on the left
  // for its own edge against the workspace.
  const railWrap: CSSProperties = {
    width,
    flexShrink: 0,
    position: 'relative',
    background: 'var(--cl-paper)',
    borderLeft: '1px solid var(--cl-line)',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  };

  /** Route a row's single click: disclosure when the event bundles more than one
   *  operation, otherwise the event's destination. Every branch degrades to a
   *  no-op rather than opening the wrong thing. */
  const activate = (e: FeedEvent) => {
    if (e.expandable) {
      toggleExpanded(e.id);
      return;
    }
    const s = e.source;
    if (s.kind === 'agent') {
      if (s.agent.agentId) onOpenAgent(s.agent);
      else {
        const def = agentDefOf(s.agent.subagentType);
        if (def) onOpenAgentDef(def);
      }
    } else if (s.kind === 'team') {
      onOpenTeam(s.team.teamName);
    } else if (s.kind === 'skill') {
      // Priority: this run's produced artifact > the static definition > the
      // bare launch tool call (last resort, only when nothing better resolves).
      if (skillHasViewableOutput(s.skill.group)) onOpenTool(s.skill.group!);
      else if (s.skill.skill) onOpenSkillDef(s.skill.skill);
      else if (s.skill.group) onOpenTool(s.skill.group);
    } else if (s.kind === 'memory' || s.kind === 'change') {
      if (e.items.length > 0) onOpenTool(e.items[e.items.length - 1]);
    }
    // A task with no detail has nothing to open — its row is already the fact.
  };

  return (
    <aside style={railWrap}>
      {/* drag-to-resize handle on the left edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onPointerDown={onResizeStart}
        className="absolute top-0 h-full"
        style={{ left: -3, width: 7, cursor: 'col-resize', zIndex: 10 }}
      />

      {/* pinned band: identity + vitals. The live-status dot reflects THIS
          session's registry status (the only real-time "is it working now"
          signal): busy → violet working pulse, waiting → terracotta, idle →
          green, offline → grey. */}
      <div className="shrink-0" style={{ padding: '15px 20px 12px' }}>
        <div className="flex items-center" style={{ gap: 8 }}>
          <span
            aria-hidden
            className={
              liveStatus === 'busy' ? 'cl-run-dot' : liveStatus ? 'cl-live-dot' : undefined
            }
            title={
              liveStatus === 'busy'
                ? 'Session is working'
                : liveStatus === 'waiting'
                  ? 'Session is waiting for you'
                  : liveStatus
                    ? 'Session is idle'
                    : 'Session is not running'
            }
            style={(() => {
              const c =
                liveStatus === 'busy'
                  ? 'var(--cl-violet)'
                  : liveStatus === 'waiting'
                    ? 'var(--cl-accent)'
                    : liveStatus
                      ? 'var(--cl-ok)'
                      : 'var(--cl-ink-4)';
              return {
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: c,
                // the design's glowing status LED — unlit when the session is offline
                boxShadow: liveStatus ? `0 0 8px ${c}` : undefined,
              };
            })()}
          />
          <span
            className="font-mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.22em',
              color: 'var(--cl-ink)',
            }}
          >
            MISSION CONTROL
          </span>
          <span style={{ flex: 1 }} />
          {sessionId && (
            <span
              className="font-mono truncate"
              style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'var(--cl-ink-4)' }}
            >
              {sessionId.slice(0, 8)}
              {turns > 0 && ` · ${turns} turns`}
            </span>
          )}
        </div>

        {/* vitals — what the CONTEXT number and the SPEND/TASKS gauges used to
            say, folded into one line so the events keep the emphasis. */}
        <div
          className="font-mono flex items-baseline"
          style={{ gap: 9, marginTop: 14, fontVariantNumeric: 'tabular-nums' }}
        >
          <span
            title={
              ctx
                ? `${kTok(ctx.used)} used · ${kTok(Math.max(0, ctx.max - ctx.used))} left · ${kTok(ctx.max)} total`
                : 'waiting for the first turn…'
            }
            style={{
              font: '700 21px/1 var(--font-sans)',
              letterSpacing: '-0.03em',
              color: ctxDanger ? 'var(--cl-danger)' : 'var(--cl-ink)',
            }}
          >
            {ctx ? pct : '—'}
            <span style={{ fontSize: 11, color: 'var(--cl-ink-3)' }}>%</span>
          </span>
          <span style={{ fontSize: 9.5, color: 'var(--cl-ink-4)' }}>ctx</span>
          <span style={{ fontSize: 9.5, color: 'var(--cl-line)' }}>·</span>
          <span
            title={savings > 0 ? `cache −${fmtCost(savings)} · ${savingsPct}% saved` : undefined}
            style={{ font: '700 15px/1 var(--font-sans)', color: 'var(--cl-accent-ink)' }}
          >
            {summary ? fmtCost(summary.estimatedCost) : '—'}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 9.5, color: 'var(--cl-ok)' }}>+{fmt(totals.added)}</span>
          <span style={{ fontSize: 9.5, color: 'var(--cl-danger)' }}>−{fmt(totals.removed)}</span>
          <span style={{ fontSize: 9.5, color: 'var(--cl-ink-4)' }}>
            {changes.length} {changes.length === 1 ? 'file' : 'files'}
          </span>
        </div>
      </div>

      {/* the context fill, edge to edge — a 2px rule that doubles as a gauge */}
      <div className="shrink-0" style={{ height: 2, background: 'var(--cl-line-soft)' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            transition: 'width 0.4s ease',
            background: ctxDanger
              ? 'var(--cl-danger)'
              : 'linear-gradient(90deg, color-mix(in oklch, var(--cl-accent) 70%, white), var(--cl-accent))',
          }}
        />
      </div>

      {/* filters — the sections, demoted from headings to a choice */}
      <div
        className="shrink-0 flex flex-wrap items-center"
        style={{ gap: 6, padding: '13px 20px 12px', borderBottom: '1px solid var(--cl-line)' }}
      >
        {filters.map(f => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              className="font-mono transition-colors"
              style={{
                padding: '5px 10px',
                borderRadius: 999,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: '0.12em',
                border: `1px solid ${active ? 'var(--cl-ink)' : 'var(--cl-line)'}`,
                background: active ? 'var(--cl-ink)' : 'transparent',
                color: active ? 'var(--cl-paper)' : 'var(--cl-ink-3)',
              }}
            >
              {f.label} {f.n}
            </button>
          );
        })}
        <button
          type="button"
          className="font-mono transition-colors"
          onClick={toggleCompact}
          aria-pressed={compact}
          title="Toggle density"
          style={{
            marginLeft: 'auto',
            fontSize: 9,
            letterSpacing: '0.12em',
            color: compact ? 'var(--cl-accent-ink)' : 'var(--cl-ink-4)',
          }}
        >
          {compact ? 'COMPACT' : 'COMFY'}
        </button>
      </div>

      {/* the stream */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 20px 24px' }}>
        {!sessionId && (
          <p className="cl-transcript-state">Waiting for the CLI session to register…</p>
        )}

        {sessionId && isError && (
          <QueryError title="Failed to load session data" error={error} onRetry={() => refetch()} />
        )}

        {sessionId && !isError && empty && filter === 'ALL' && (
          <p className="cl-transcript-state">
            Agents, skills and file changes will appear here as Claude works.
          </p>
        )}

        {/* The project has teams but this session started none — worth saying,
            since an empty TEAMS filter would otherwise read as "no teams". */}
        {filter === 'TEAMS' && visible.length === 0 && projectTeamCount > 0 && (
          <p
            className="font-mono"
            style={{ fontSize: 10.5, color: 'var(--cl-ink-4)', margin: 0, padding: '10px 0 2px' }}
          >
            No teams in this session · {projectTeamCount} in the project
          </p>
        )}

        {visible.map(e => {
          const open = expanded.has(e.id);
          return (
            <div key={e.id}>
              <FeedRow
                e={e}
                now={now}
                compact={compact}
                open={open}
                onActivate={() => activate(e)}
              />
              {open && e.items.length > 0 && (
                <FeedOperations items={e.items} onOpenTool={onOpenTool} />
              )}
              {open && e.source.kind === 'task' && (
                <TaskDetail event={e.source} fontSize={compact ? 11 : 11.5} />
              )}
            </div>
          );
        })}

        {visible.length > 0 && (
          <div className="flex items-center" style={{ gap: 10, padding: '16px 0 0' }}>
            <span style={{ flex: 1, height: 1, background: 'var(--cl-line-soft)' }} />
            <span
              className="font-mono"
              style={{ fontSize: 8.5, letterSpacing: '0.16em', color: 'var(--cl-ink-4)' }}
            >
              SESSION START
            </span>
            <span style={{ flex: 1, height: 1, background: 'var(--cl-line-soft)' }} />
          </div>
        )}
      </div>

      {/* ENVIRONMENT — the session's standing setup, pinned under the stream */}
      <EnvironmentStrip init={init} />
    </aside>
  );
}
