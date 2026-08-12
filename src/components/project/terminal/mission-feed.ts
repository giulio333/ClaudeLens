import type { Task, TeamSummary } from '../../../types';
import { fileExt, MEMORY_TYPE_TINT } from '../chat/utils';
import type {
  MemoryAction,
  MemoryActivity,
  MemoryTouch,
  ProcessedMessage,
  SessionAgent,
  SessionSkill,
  ToolGroup,
} from '../chat/utils';

/**
 * The data model behind Mission Control's **event feed** (design "1d · Feed").
 *
 * The rail used to be a taxonomy: one block per species (agents, skills, memory,
 * changes, tasks, teams), each with its own eyebrow and its own rules. Every
 * block weighed the same, so nothing arrived first — the reader had to scan the
 * whole rail to find what was happening *now*. The feed drops the taxonomy: one
 * chronological stream of events, live rows on top, and the species become
 * filters over the same stream.
 *
 * This module is pure and unit-tested (`test/mission-feed.test.ts`). It owns the
 * two things a feed lives or dies by:
 *
 *  - **When each event happened.** The transcript timestamps every assistant
 *    turn, so a tool-use id is enough to date a file edit or a memory touch
 *    (`buildToolTimes`). Sub-agents carry their own `startedAt`/`endedAt` from
 *    the sidecar transcript. Tasks are the awkward one: `~/.claude/tasks/*.json`
 *    carries no timestamp at all, so their position is recovered from the
 *    `TaskCreate`/`TaskUpdate` calls that wrote them (`buildTaskTimes`) — a task
 *    whose tool calls are out of the read window keeps `at: 0` and sinks to the
 *    bottom with a `—` instead of pretending to a position it can't prove.
 *  - **What each row says.** Title / meta / right-hand status, resolved per
 *    species, plus the brand token that tints it. Tints are CSS custom
 *    properties (same convention as `MEMORY_TYPE_TINT` in `chat/utils`), so the
 *    view stays a renderer and the copy stays testable.
 */

/* ── file changes ─────────────────────────────────────────────────────── */

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function lines(s: unknown): number {
  return typeof s === 'string' && s.length > 0 ? s.split('\n').length : 0;
}

/** +added/−removed estimate for a file-mutating tool, from its input alone. */
export function editStats(g: ToolGroup): { added: number; removed: number } | null {
  const input = g.use.input as Record<string, unknown>;
  if (g.use.name === 'Write') return { added: lines(input.content), removed: 0 };
  if (g.use.name === 'Edit')
    return { added: lines(input.new_string), removed: lines(input.old_string) };
  if (g.use.name === 'MultiEdit' && Array.isArray(input.edits)) {
    let added = 0;
    let removed = 0;
    for (const e of input.edits as Array<Record<string, unknown>>) {
      added += lines(e.new_string);
      removed += lines(e.old_string);
    }
    return { added, removed };
  }
  return null;
}

export type FileChange = {
  path: string;
  name: string;
  items: ToolGroup[];
  added: number;
  removed: number;
  hasError: boolean;
};

/** Per-file aggregate of every mutating tool run — the session's work product. */
export function buildFileChanges(groups: ToolGroup[]): FileChange[] {
  const byPath = new Map<string, FileChange>();
  for (const g of groups) {
    if (!EDIT_TOOLS.has(g.use.name)) continue;
    const input = g.use.input as Record<string, unknown>;
    const path = (input.file_path || input.notebook_path) as string | undefined;
    if (!path) continue;
    let fc = byPath.get(path);
    if (!fc) {
      fc = {
        path,
        name: path.split(/[\\/]/).pop() || path,
        items: [],
        added: 0,
        removed: 0,
        hasError: false,
      };
      byPath.set(path, fc);
    }
    fc.items.push(g);
    const stats = editStats(g);
    if (stats) {
      fc.added += stats.added;
      fc.removed += stats.removed;
    }
    fc.hasError ||= !!g.result?.isError;
  }
  return [...byPath.values()];
}

/** Directory of a file relative to the project root — the row's "area". Files
 *  outside the project (e.g. global memory under ~/.claude) fall back to their
 *  parent dir name; repo-root files read "(root)". */
export function areaOf(path: string, realPath: string): string {
  const norm = path.replace(/\\/g, '/');
  const root = realPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (norm.startsWith(root + '/')) {
    const rel = norm.slice(root.length + 1);
    const slash = rel.lastIndexOf('/');
    return slash === -1 ? '(root)' : rel.slice(0, slash);
  }
  const parts = norm.split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : 'external';
}

/* ── memory labels ────────────────────────────────────────────────────── */

export const MEMORY_ACTION_LABEL: Record<MemoryAction, string> = {
  new: 'NEW',
  revised: 'REVISED',
  wrote: 'WROTE',
  read: 'READ',
};

/** A remembered fact is the session's one durable outcome — it outlives the
 *  session — so its label is the only one that takes the accent. A consultation
 *  is context, not an outcome: muted. */
export const MEMORY_ACTION_TINT: Record<MemoryAction, string> = {
  new: 'var(--cl-accent-ink)',
  revised: 'var(--cl-ink-2)',
  wrote: 'var(--cl-ink-2)',
  read: 'var(--cl-ink-4)',
};

/* ── the feed ─────────────────────────────────────────────────────────── */

export type FeedKind = 'AGENTS' | 'TEAMS' | 'SKILLS' | 'MEMORY' | 'CHANGES' | 'TASKS';

/** Every filter the rail can offer, in the order the pills are laid out. */
export const FEED_KINDS: FeedKind[] = ['AGENTS', 'TEAMS', 'SKILLS', 'MEMORY', 'CHANGES', 'TASKS'];

/** The domain object behind a row — the view routes the click from this. */
export type FeedSource =
  | { kind: 'agent'; agent: SessionAgent }
  | { kind: 'skill'; skill: SessionSkill }
  | { kind: 'memory'; touch: MemoryTouch }
  | { kind: 'change'; change: FileChange }
  | { kind: 'task'; task: Task }
  | { kind: 'team'; team: TeamSummary };

export type FeedEvent = {
  /** Stable React key and expansion identity. */
  id: string;
  kind: FeedKind;
  /** Epoch ms; 0 when the event can't be dated (rendered as `—`, sorted last). */
  at: number;
  /** Still running — floats to the top of the feed and takes the live row tint. */
  live: boolean;
  /** Single glyph for the row's badge; `ext` instead means "draw the file icon". */
  glyph: string;
  glyphTint: string;
  /** File extension for CHANGES rows — the badge draws the real language icon. */
  ext?: string;
  title: string;
  meta: string;
  right: string;
  rightTint: string;
  /** CHANGES rows print a two-tone +N −N instead of a flat label. */
  rightDiff?: { added: number; removed: number };
  /** Something failed in this row's operations — the title takes the danger tint. */
  danger?: boolean;
  /** The operations behind the row; more than one makes the row expandable. */
  items: ToolGroup[];
  expandable: boolean;
  source: FeedSource;
};

export type MissionFeedInput = {
  processed: ProcessedMessage[];
  /** Non-agent tool groups of the session — the source of task timestamps. */
  ownTools: ToolGroup[];
  agents: SessionAgent[];
  skills: SessionSkill[];
  memory: MemoryActivity;
  changes: FileChange[];
  tasks: Task[];
  /** Session-scoped teams, already resolved to a display title and liveness. */
  teams: { team: TeamSummary; title: string; live: boolean }[];
  realPath: string;
  /** Injected so the "quiet Nm" stuck-team signal stays pure. */
  now: number;
};

function ms(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** tool_use id → the timestamp of the assistant turn that issued it. */
export function buildToolTimes(processed: ProcessedMessage[]): Map<string, number> {
  const at = new Map<string, number>();
  for (const p of processed) {
    const t = ms(p.msg.timestamp);
    if (!t) continue;
    for (const g of p.toolGroups) if (g.use.id) at.set(g.use.id, t);
  }
  return at;
}

function latestOf(items: ToolGroup[], at: Map<string, number>): number {
  let max = 0;
  for (const g of items) max = Math.max(max, at.get(g.use.id) ?? 0);
  return max;
}

/**
 * When each task was last written, recovered from the transcript.
 *
 * A task file under `~/.claude/tasks/<session>/` carries no timestamp, so the
 * only dating evidence is the call that wrote it: `TaskCreate` (identified by
 * its `subject`, since the id is only known from the result) and `TaskUpdate`
 * (identified by `taskId`). The last update wins — that is the moment the row
 * actually reports.
 */
export function buildTaskTimes(
  tools: ToolGroup[],
  at: Map<string, number>
): { byId: Map<string, number>; bySubject: Map<string, number> } {
  const byId = new Map<string, number>();
  const bySubject = new Map<string, number>();
  for (const g of tools) {
    const t = at.get(g.use.id) ?? 0;
    if (!t) continue;
    const input = g.use.input as Record<string, unknown>;
    if (g.use.name === 'TaskCreate') {
      const subject = typeof input.subject === 'string' ? input.subject : '';
      if (subject) bySubject.set(subject, t);
    } else if (g.use.name === 'TaskUpdate') {
      const id = input.taskId ?? input.task_id ?? input.id;
      if (id != null && id !== '') byId.set(String(id), t);
    }
  }
  return { byId, bySubject };
}

/** Minutes since `at`, for the "quiet Nm" stuck-team signal. */
function minutesBetween(at: number, now: number): number {
  return at > 0 ? Math.max(0, Math.floor((now - at) / 60_000)) : 0;
}

function agentEvents(input: MissionFeedInput, turnAt: number[]): FeedEvent[] {
  return input.agents.map(a => {
    const live = a.runState === 'running';
    const failed = a.runState === 'failed';
    return {
      id: `agent:${a.key}`,
      kind: 'AGENTS' as const,
      at: ms(a.endedAt) || ms(a.startedAt) || (turnAt[a.turnN - 1] ?? 0),
      live,
      glyph: 'A',
      glyphTint: live ? 'var(--cl-violet)' : failed ? 'var(--cl-danger)' : 'var(--cl-violet)',
      title: a.subagentType,
      meta: a.description || a.prompt,
      right: live
        ? 'WORKING'
        : failed
          ? 'FAILED'
          : a.messageCount != null
            ? `${a.messageCount} MSGS`
            : 'DONE',
      rightTint: live ? 'var(--cl-violet-ink)' : failed ? 'var(--cl-danger)' : 'var(--cl-ink-4)',
      danger: failed,
      items: [],
      expandable: false,
      source: { kind: 'agent' as const, agent: a },
    };
  });
}

function teamEvents(input: MissionFeedInput): FeedEvent[] {
  return input.teams.map(({ team, title, live }) => {
    const quietMins = live ? minutesBetween(team.lastActivity, input.now) : 0;
    const quiet = live && quietMins >= 5;
    const meta = [
      `${team.memberCount} ${team.memberCount === 1 ? 'member' : 'members'}`,
      `${team.transcriptCount} ${team.transcriptCount === 1 ? 'transcript' : 'transcripts'}`,
      team.sessionIds.length > 1 ? `${team.sessionIds.length} sessions` : null,
      quiet ? `quiet ${quietMins}m` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      id: `team:${team.teamName}`,
      kind: 'TEAMS' as const,
      at: team.lastActivity,
      live,
      glyph: 'T',
      glyphTint: live ? 'var(--cl-cyan)' : 'var(--cl-ink-4)',
      title,
      meta,
      right: live ? 'LEAD LIVE' : team.hasConfig ? 'ENDED' : 'HISTORICAL',
      rightTint: live ? 'var(--cl-ok)' : 'var(--cl-ink-4)',
      items: [],
      expandable: false,
      source: { kind: 'team' as const, team },
    };
  });
}

function skillEvents(input: MissionFeedInput, turnAt: number[]): FeedEvent[] {
  return input.skills.map(s => ({
    id: `skill:${s.key}`,
    kind: 'SKILLS' as const,
    at: turnAt[s.turnN - 1] ?? 0,
    live: false,
    glyph: s.group ? '✦' : '/',
    glyphTint: 'var(--cl-accent)',
    title: s.name,
    meta: s.description || s.args || (s.group ? 'agentic skill' : 'slash command'),
    right: (s.scope ?? 'skill').toUpperCase(),
    rightTint: 'var(--cl-ink-4)',
    items: [],
    expandable: false,
    source: { kind: 'skill' as const, skill: s },
  }));
}

function memoryEvents(input: MissionFeedInput, at: Map<string, number>): FeedEvent[] {
  return input.memory.touches.map(t => {
    const count = t.writes > 0 ? t.writes : t.reads;
    const meta = [
      t.action === 'read' ? 'consulted' : 'remembered',
      t.scope === 'project' ? 'repo' : null,
      count > 1 ? `×${count}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      id: `memory:${t.path}`,
      kind: 'MEMORY' as const,
      at: latestOf(t.items, at),
      live: false,
      glyph: 'M',
      glyphTint: MEMORY_TYPE_TINT[t.type] ?? MEMORY_TYPE_TINT.user,
      title: t.title,
      meta,
      right: t.hasError ? 'FAILED' : MEMORY_ACTION_LABEL[t.action],
      rightTint: t.hasError ? 'var(--cl-danger)' : MEMORY_ACTION_TINT[t.action],
      danger: t.hasError,
      items: t.items,
      expandable: t.items.length > 1,
      source: { kind: 'memory' as const, touch: t },
    };
  });
}

function changeEvents(input: MissionFeedInput, at: Map<string, number>): FeedEvent[] {
  return input.changes.map(fc => {
    const area = areaOf(fc.path, input.realPath);
    return {
      id: `change:${fc.path}`,
      kind: 'CHANGES' as const,
      at: latestOf(fc.items, at),
      live: false,
      glyph: '',
      glyphTint: 'var(--cl-ink-3)',
      ext: fileExt(fc.name),
      title: fc.name,
      meta: fc.items.length > 1 ? `${fc.items.length} edits · ${area}` : area,
      right: fc.hasError ? 'FAILED' : '',
      rightTint: 'var(--cl-danger)',
      rightDiff: fc.hasError ? undefined : { added: fc.added, removed: fc.removed },
      danger: fc.hasError,
      items: fc.items,
      expandable: fc.items.length > 1,
      source: { kind: 'change' as const, change: fc },
    };
  });
}

function taskEvents(input: MissionFeedInput, at: Map<string, number>): FeedEvent[] {
  const { byId, bySubject } = buildTaskTimes(input.ownTools, at);
  return input.tasks.map(t => {
    const running = t.status === 'in_progress';
    const done = t.status === 'completed';
    const activeForm = running ? t.activeForm?.trim() : '';
    const hasDeps = t.blockedBy.length > 0 || t.blocks.length > 0;
    return {
      id: `task:${t.id}`,
      kind: 'TASKS' as const,
      at: byId.get(t.id) ?? bySubject.get(t.subject) ?? 0,
      live: running,
      glyph: done ? '✓' : running ? '●' : '○',
      glyphTint: running ? 'var(--cl-ok)' : 'var(--cl-ink-4)',
      title: t.subject,
      meta: running
        ? activeForm || 'in progress'
        : done
          ? 'completed'
          : t.blockedBy.length > 0
            ? `blocked by ${t.blockedBy.map(id => `#${id}`).join(' ')}`
            : 'pending',
      right: running ? 'RUNNING' : done ? 'DONE' : 'TODO',
      rightTint: running ? 'var(--cl-ok)' : 'var(--cl-ink-4)',
      items: [],
      expandable: Boolean(activeForm) || Boolean(t.description?.trim()) || hasDeps,
      source: { kind: 'task' as const, task: t },
    };
  });
}

/**
 * The unified feed: every species folded into one stream, live rows first and
 * the rest newest-first. Undated rows (`at: 0`) sink to the bottom instead of
 * claiming the top, which is where a naïve descending sort would put them.
 */
export function buildMissionFeed(input: MissionFeedInput): FeedEvent[] {
  const at = buildToolTimes(input.processed);
  const turnAt = input.processed.map(p => ms(p.msg.timestamp));
  const events = [
    ...agentEvents(input, turnAt),
    ...teamEvents(input),
    ...skillEvents(input, turnAt),
    ...memoryEvents(input, at),
    ...changeEvents(input, at),
    ...taskEvents(input, at),
  ];
  // Stable sort (ES2019+): rows that tie keep the order their species produced.
  return events.sort((a, b) => Number(b.live) - Number(a.live) || b.at - a.at);
}

/** How many events each filter would show. */
export function countByKind(events: FeedEvent[]): Record<FeedKind, number> {
  const counts = { AGENTS: 0, TEAMS: 0, SKILLS: 0, MEMORY: 0, CHANGES: 0, TASKS: 0 };
  for (const e of events) counts[e.kind]++;
  return counts;
}

/** Compact token count for the vitals line and its hover cards: 156_312 →
 *  "156k", 1_240_000 → "1.2M". Sub-1k counts keep their digits — rounding a
 *  fresh-input of 420 tokens to "0k" would read as "nothing was sent". */
export function kTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n < 1000) return String(n);
  return `${Math.round(n / 1000)}k`;
}

/** Compact age for the feed's time gutter: `now`, `7m`, `3h`, `2d`, `—`. */
export function shortAgo(at: number, now: number, live = false): string {
  if (live) return 'now';
  if (!at) return '—';
  const delta = Math.max(0, now - at);
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}
