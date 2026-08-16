import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import {
  useMemoryProject,
  useSessionList,
  useClaudeMdHierarchy,
  useProjectRules,
  useGlobalMcp,
  useAllSkills,
  useGlobalAgents,
  useProjectAgents,
  useCleanupPeriodDays,
  useActiveSessions,
} from '../../../hooks/useIPC';
import { View } from '../types';
import { fmt, fmtCost, fmtModel, sessionTitle, formatTokens, buildModelMix } from '../utils';
import type { SessionSummary, MemoryTopic } from '../../../types';
import { Lens } from './Lens';
import { McpServerGrid } from '../mcp/McpServerGrid';
import { AgentsLiveView } from '../agents-live/AgentsLiveView';
import { TasksSection } from '../tasks/TasksSection';
import { projectDisplayName } from '../shared/projectName';
import { ReadoutShell, ReadoutCell, ReadoutPart, ReadoutRule } from '../shared/ReadoutCard';
import { READOUT_RAMP } from '../shared/readout';
import { kTok } from '../terminal/mission-feed';
import { PlansSection } from '../plans/PlansSection';
import { WorkflowsSection } from '../workflows/WorkflowsSection';
import { TeamsSection } from '../teams/TeamsSection';
import { MemoryGraphView } from '../memory/MemoryGraphView';
import { ProjectConfigView } from '../settings/ProjectConfigView';
import { usePinnedProjects } from '../../../hooks/usePinnedProjects';
import { usePinnedSessions } from '../../../hooks/usePinnedSessions';
import { useSessionTags } from '../../../hooks/useSessionTags';
import { useMemoryTags } from '../../../hooks/useMemoryTags';
import { PinIcon } from '../shared/SearchPopover';
import { searchTriggerProps } from '../shared/searchTrigger';
import { TagChip } from '../sessions/TagChip';
import { TagBar } from '../sessions/TagBar';
import { TagPicker } from '../sessions/TagPicker';
import { SessionRowMenu } from '../sessions/SessionRowMenu';
import { DeleteSessionDialog } from '../shared/DeleteSessionDialog';

function ChatGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5h16v11H8l-4 4V5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type ProjectSection =
  | 'overview'
  | 'sessions'
  | 'memory'
  | 'skills'
  | 'agents'
  | 'mcp'
  | 'live-agents'
  | 'tasks'
  | 'plans'
  | 'workflows'
  | 'teams'
  | 'config';

type Project = { hash: string; realPath: string };

function relIso(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Math.floor((Date.now() - t) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 14) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / (86400 * 7))}w`;
}

// Compact absolute date for memory tiles, so the date-sorted grid reads in order
// even across the two-column zig-zag layout (e.g. "27 giu 26").
function tileDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' });
}

function shortWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  // en-US, like every other date in the app: the UI is English-only, and the
  // it-IT month abbreviations this used to print ("10 ago") read as a bug next
  // to English column labels.
  return d.toLocaleString('en-US', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function modelFamily(m?: string): '' | 'opus' | 'haiku' {
  if (!m) return '';
  if (m.includes('opus')) return 'opus';
  if (m.includes('haiku')) return 'haiku';
  return '';
}

const DAY_MS = 86_400_000;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_STAT_BARS = 12;

type StatMetric = 'sessions' | 'tokens' | 'avg';

type TimelineBucket = {
  key: string;
  label: string;
  sessions: number;
  tokens: number;
};

function normalizeRetentionDays(days: number): number {
  return Number.isFinite(days) && days > 0 ? Math.max(1, Math.round(days)) : DEFAULT_RETENTION_DAYS;
}

// en-US, not it-IT: the UI is english-only, and an it-IT month abbreviation
// ("ago", "set") is the only italian word in the band's tooltips.
function fmtBucketDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}

function bucketLabel(startMs: number, endMs: number): string {
  const start = fmtBucketDate(startMs);
  const end = fmtBucketDate(Math.max(startMs, endMs - 1));
  return start === end ? start : `${start} - ${end}`;
}

/** Local midnight, `offsetDays` away from the day `ms` falls in. Going through
 *  `setDate` rather than adding `DAY_MS` keeps every boundary on a true
 *  midnight across a DST change, where a day is 23 or 25 hours long. */
function dayStart(ms: number, offsetDays = 0): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}

// Buckets span whole days, aligned to local midnight. Slicing the window into
// exactly MAX_STAT_BARS parts made 30 days into 2.5-day buckets cut at noon, so
// two adjacent bars both printed the day they shared ("14 Aug - 16 Aug" next to
// "16 Aug - 19 Aug") — the one thing a reader uses the label to rule out.
function buildTimelineBuckets(
  sessions: SessionSummary[],
  days: number,
  nowMs: number
): TimelineBucket[] {
  const daysPerBucket = Math.max(1, Math.ceil(days / MAX_STAT_BARS));
  const bucketCount = Math.max(1, Math.ceil(days / daysPerBucket));
  // Boundaries are computed, not derived by division: with DST in the window
  // they are not equally spaced in milliseconds.
  const edges = Array.from({ length: bucketCount + 1 }, (_, k) =>
    dayStart(nowMs, 1 - (bucketCount - k) * daysPerBucket)
  );
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    key: `${edges[i]}-${edges[i + 1]}`,
    label: bucketLabel(edges[i], edges[i + 1]),
    sessions: 0,
    tokens: 0,
  }));

  for (const s of sessions) {
    const t = new Date(s.date).getTime();
    if (isNaN(t) || t < edges[0] || t >= edges[bucketCount]) continue;
    let idx = bucketCount - 1;
    while (idx > 0 && t < edges[idx]) idx -= 1;
    buckets[idx].sessions += 1;
    buckets[idx].tokens += s.totalTokens;
  }

  return buckets;
}

/** Width of the token breakdown card — needed both to draw it and to clamp it
 *  inside the window before it is drawn. */
const PEEK_W = 300;

/**
 * A slug title with a break opportunity after each underscore.
 *
 * A line breaker treats `_` as an ordinary character, so
 * `feedback_no_manual_app_launch` is a single unbreakable word and overflowed
 * its card, while the kebab-case names beside it wrapped on their hyphens. The
 * `<wbr>` marks where a break is allowed without putting any character into
 * the text — the name still copies out verbatim — and it breaks after the
 * separator, where the eye expects it, rather than mid-word as the CSS
 * fallback would.
 */
function SlugName({ text }: { text: string }) {
  const parts = text.split('_');
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && '_'}
          {i > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </>
  );
}

function pctOf(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

function bucketValue(bucket: TimelineBucket, metric: StatMetric): number {
  if (metric === 'sessions') return bucket.sessions;
  if (metric === 'tokens') return bucket.tokens;
  return bucket.sessions > 0 ? bucket.tokens / bucket.sessions : 0;
}

function bucketTooltip(bucket: TimelineBucket, metric: StatMetric): string {
  if (metric === 'sessions')
    return `${bucket.label} · ${fmt(bucket.sessions)} sessions · ${fmt(bucket.tokens)} tok`;
  if (metric === 'tokens')
    return `${bucket.label} · ${fmt(bucket.tokens)} tok · ${fmt(bucket.sessions)} sessions`;
  const avg = bucket.sessions > 0 ? Math.round(bucket.tokens / bucket.sessions) : 0;
  return `${bucket.label} · ${fmt(avg)} tok/session · ${fmt(bucket.sessions)} sessions`;
}

function Bars({ buckets, metric }: { buckets: TimelineBucket[]; metric: StatMetric }) {
  const [active, setActive] = useState<{ index: number; text: string } | null>(null);
  const values = buckets.map(bucket => bucketValue(bucket, metric));
  const max = Math.max(...values, 1);
  const peakIdx = values.indexOf(Math.max(...values));
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
  };
  return (
    <div className="cl-bars" style={gridStyle}>
      {buckets.map((bucket, i) => {
        const value = values[i] ?? 0;
        const tooltip = bucketTooltip(bucket, metric);
        return (
          <span
            key={bucket.key}
            className={`cl-stat-bar${value > 0 && i === peakIdx ? ' peak' : ''}`}
            tabIndex={0}
            title={tooltip}
            aria-label={tooltip}
            onMouseEnter={() => setActive({ index: i, text: tooltip })}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive({ index: i, text: tooltip })}
            onBlur={() => setActive(null)}
          >
            <span
              className="cl-stat-bar-fill"
              style={{ height: `${value > 0 ? Math.max((value / max) * 100, 6) : 0}%` }}
            />
          </span>
        );
      })}
      {active && (
        <span
          className="cl-bars-tip"
          style={{ left: `${((active.index + 0.5) / Math.max(buckets.length, 1)) * 100}%` }}
        >
          {active.text}
        </span>
      )}
    </div>
  );
}

const MEM_PREVIEW_MAX = 70;
// The landing's index cards give the preview three lines of prose instead of a
// single mono line, so they get a longer slice of the same cleaned text.
const MEM_CARD_PREVIEW_MAX = 190;
/** How many sessions and memory topics the project landing shows before
 *  handing over to the subtab (design 1c: three rows, two rows of cards). */
const LANDING_SESSIONS = 3;
const LANDING_MEM_CARDS = 6;

const CLAUDE_MD_SCOPE_LABEL: Record<'global' | 'project' | 'local' | 'subdir', string> = {
  project: 'Project',
  local: 'Local',
  subdir: 'Subdir',
  global: 'Global',
};

// Ripulisce la sintassi markdown e tronca per un'anteprima pulita.
function memPreview(raw: string, max: number = MEM_PREVIEW_MAX): string {
  const clean = raw
    .replace(/```[\s\S]*?```/g, ' ') // blocchi di codice
    .replace(/`([^`]+)`/g, '$1') // codice inline
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // immagini
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // wikilink
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // link markdown
    .replace(/^#{1,6}\s+/gm, '') // heading
    .replace(/[*_~>#]/g, '') // enfasi e marcatori
    .replace(/\s+/g, ' ') // collassa whitespace
    .trim();
  return clean.length > max ? clean.slice(0, max).trimEnd() + '…' : clean;
}

export function ProjectView({
  project,
  section,
  onNavigate,
  onToggleProjectSearch,
  onDeleteProject,
}: {
  project: Project;
  section: ProjectSection;
  onNavigate: (v: View) => void;
  onToggleProjectSearch: (anchor: HTMLElement) => void;
  onDeleteProject: (project: Project) => void;
}) {
  const { isPinned, togglePin } = usePinnedProjects();
  const pinnedNow = isPinned(project.hash);
  const { isPinned: isSessionPinned } = usePinnedSessions();
  const {
    tags: projectTags,
    tagCounts,
    tagsForSession,
    renameTag,
    deleteTag,
  } = useSessionTags(project.hash);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const {
    tags: memTags,
    tagCounts: memTagCounts,
    tagsForMemory,
    toggleTagOnMemory,
    deleteTag: deleteMemTag,
    renameTag: renameMemTag,
  } = useMemoryTags(project.hash);
  const [memTagFilter, setMemTagFilter] = useState<string | null>(null);
  // Sort the memory grid by file creation date.
  const [memSort, setMemSort] = useState<'newest' | 'oldest'>('newest');
  // Optional grouping of the topic grid into sections by managed tag or by type
  // (a topic with several tags appears under each; untagged topics get their own
  // trailing group). Filters + sort still apply within each group.
  const [memGroupBy, setMemGroupBy] = useState<'none' | 'tag' | 'type'>('none');
  // Inline tag picker target for a memory tile (mirrors the session row picker).
  const [memPickerFor, setMemPickerFor] = useState<{ filename: string; rect: DOMRect } | null>(
    null
  );
  // Memory subtab layout: the list (filters/sort/group-by apply) or the graph of
  // the relations the topics declare between each other via [[wikilinks]].
  const [memLayout, setMemLayout] = useState<'list' | 'graph'>('list');
  const { data: memory } = useMemoryProject(project.hash);
  const { data: sessions = [] } = useSessionList(project.hash);
  const { data: claudeMd } = useClaudeMdHierarchy(project.realPath);
  const { data: rules = [] } = useProjectRules(project.realPath);
  const { data: mcpData } = useGlobalMcp();
  const { data: allSkills = [] } = useAllSkills(project.realPath);
  const { data: globalAgents = [] } = useGlobalAgents();
  const { data: projectAgents = [] } = useProjectAgents(project.realPath);
  const { data: cleanupDays = 30 } = useCleanupPeriodDays();

  // ── Live session (registry ~/.claude/sessions, push dal main) ──
  // Only the hero's `is-live` treatment reads it here: the PID/uptime readout
  // moved to the rail footer (design 5a), which owns the ticking clock.
  const { data: procs = [] } = useActiveSessions();
  const liveProc = procs.find(p => p.cwd === project.realPath);

  // Wall-clock for the retention window, kept in state so render never calls
  // Date.now() directly. The lazy initialiser runs once at mount, so the window
  // is correct on the FIRST render: seeding it from an effect left one frame
  // where `statsSessions` fell back to the whole history under a "/ 30d" label,
  // i.e. the band briefly printed project-wide totals as if they were the month's.
  // Hover/focus state of the token figure's breakdown card. The card is
  // portalled (the hero clips its children), so what is stored is where to pin
  // it in viewport coordinates, measured from the figure it explains.
  const tokenNumRef = useRef<HTMLDivElement>(null);
  const [tokenPeek, setTokenPeek] = useState<{ top: number; left: number } | null>(null);
  const openTokenPeek = useCallback(() => {
    const r = tokenNumRef.current?.getBoundingClientRect();
    if (!r) return;
    setTokenPeek({
      top: r.bottom + 8,
      // Clamped so the card never hangs off the right edge on a narrow window.
      left: Math.max(12, Math.min(r.left, window.innerWidth - PEEK_W - 12)),
    });
  }, []);
  const closeTokenPeek = useCallback(() => setTokenPeek(null), []);
  // A fixed card measured once would drift away from its figure on scroll, and
  // the pointer may never leave the cell while the page moves under it.
  useEffect(() => {
    if (!tokenPeek) return;
    const drop = () => setTokenPeek(null);
    window.addEventListener('scroll', drop, true);
    window.addEventListener('resize', drop);
    return () => {
      window.removeEventListener('scroll', drop, true);
      window.removeEventListener('resize', drop);
    };
  }, [tokenPeek]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Derived ──
  const projectName = projectDisplayName(project.realPath);
  // Teams is an operational view rather than a project landing page. It keeps
  // the project controls in a compact context bar so the team roster is visible
  // in the first viewport.
  const isTeamsSection = section === 'teams';
  const retentionDays = normalizeRetentionDays(cleanupDays);
  const statsSessions = useMemo(() => {
    const cutoff = nowMs - retentionDays * DAY_MS;
    return sessions.filter(s => {
      const t = new Date(s.date).getTime();
      return !isNaN(t) && t >= cutoff && t <= nowMs;
    });
  }, [sessions, retentionDays, nowMs]);
  const sessionCount = statsSessions.length;
  const totalTokens = statsSessions.reduce((s, x) => s + x.totalTokens, 0);
  const totalCost = statsSessions.reduce((s, x) => s + x.estimatedCost, 0);
  const totalMessages = statsSessions.reduce((s, x) => s + x.messageCount, 0);
  const tokensFmt = formatTokens(totalTokens);
  const avgMessages = sessionCount > 0 ? Math.round(totalMessages / sessionCount) : 0;
  // What the token figure is made of. `totalTokens` sums cache reads at full
  // weight even though they bill at a tenth of input, so on a long project the
  // headline number mostly measures re-read context — the composition is what
  // makes it honest, and it rides in the hover card rather than in the band.
  const tokenParts = useMemo(() => {
    const sum = (pick: (s: SessionSummary) => number) =>
      statsSessions.reduce((n, s) => n + pick(s), 0);
    const fresh = sum(s => s.inputTokens) + sum(s => s.outputTokens);
    const cacheRead = sum(s => s.cacheReadTokens);
    const cacheWrite = sum(s => s.cacheWriteTokens);
    const total = fresh + cacheRead + cacheWrite;
    return {
      fresh,
      cacheRead,
      cacheWrite,
      cacheSavings: sum(s => s.cacheSavings),
      cacheShare: total > 0 ? (cacheRead / total) * 100 : 0,
    };
  }, [statsSessions]);
  const allSessionCount = sessions.length;
  const olderSessionCount = Math.max(0, allSessionCount - sessionCount);
  const lastActive = sessions[0]?.date;
  const statBuckets = useMemo(
    () => buildTimelineBuckets(statsSessions, retentionDays, nowMs),
    [statsSessions, retentionDays, nowMs]
  );
  // Sessions in the window immediately before the retention one, so the hero
  // band's session figure can carry an honest delta instead of a bare count.
  const prevWindowSessions = useMemo(() => {
    const end = nowMs - retentionDays * DAY_MS;
    const start = end - retentionDays * DAY_MS;
    return sessions.filter(s => {
      const t = new Date(s.date).getTime();
      return !isNaN(t) && t >= start && t < end;
    }).length;
  }, [sessions, retentionDays, nowMs]);
  const sessionDelta = sessionCount - prevWindowSessions;
  const modelMix = useMemo(() => buildModelMix(statsSessions), [statsSessions]);

  const pinnedSessions = useMemo(
    () => sessions.filter(s => isSessionPinned(project.hash, s.filename)),
    [sessions, project.hash, isSessionPinned]
  );
  const hasPinnedSession = pinnedSessions.length > 0;
  // True 1-based position of each session in the full activity-sorted list, so
  // the pinned section shows the real rank (e.g. 04, 27) instead of 01, 02.
  const sessionRank = useMemo(() => {
    const m = new Map<string, number>();
    sessions.forEach((s, i) => m.set(s.filename, i + 1));
    return m;
  }, [sessions]);
  // Pinned sessions live exclusively in their own section; the regular list
  // shows only the unpinned ones so a pinned session never appears twice.
  const unpinnedSessions = useMemo(
    () => sessions.filter(s => !isSessionPinned(project.hash, s.filename)),
    [sessions, project.hash, isSessionPinned]
  );
  // Effective tag filter: a selection whose tag was deleted is treated as no
  // filter (derived, not an effect, so it can never get stuck on a stale tag).
  const activeTag = tagFilter && projectTags.some(t => t.name === tagFilter) ? tagFilter : null;
  const visibleSessions = useMemo(() => {
    if (!activeTag) return unpinnedSessions;
    return unpinnedSessions.filter(s => tagsForSession(s.filename).includes(activeTag));
  }, [unpinnedSessions, activeTag, tagsForSession]);

  // Stable navigation callbacks shared by every session list: onNavigate is
  // setView (stable) and `project` is stable for this view's lifetime (ProjectView
  // is keyed by project hash upstream), so the rows' memo never breaks on them.
  const openTerminal = useCallback(
    (s: SessionSummary) =>
      onNavigate({
        type: 'terminal',
        project,
        resumeSessionId: s.filename.replace(/\.jsonl$/, ''),
      }),
    [onNavigate, project]
  );
  const openChat = useCallback(
    // The row's "Chat" action goes straight to the live SDK chat (resume mode,
    // composer at the bottom) — LiveChatView locks the composer itself when the
    // session is currently live in a terminal.
    (s: SessionSummary) => onNavigate({ type: 'new-chat', project, resumeSession: s }),
    [onNavigate, project]
  );

  const memTopics = useMemo(
    () => [...(memory?.index ?? []), ...(memory?.projectLevelIndex ?? [])],
    [memory]
  );
  const topicContent = (filename: string) =>
    memory?.topics[filename] ?? memory?.projectLevelTopics[filename] ?? '';
  // Bodies of every topic, keyed by filename — the memory graph reads the
  // [[wikilinks]] out of them. Already in the IPC payload, so this is a merge,
  // not a read; memoized because it's the input of the graph build.
  const memoryContents = useMemo(
    () => ({ ...(memory?.topics ?? {}), ...(memory?.projectLevelTopics ?? {}) }),
    [memory]
  );
  const activeMemTag =
    memTagFilter && memTags.some(t => t.name === memTagFilter) ? memTagFilter : null;
  // Set of types actually present among topics — used by the "Group by Type" option.
  const presentMemTypes = useMemo(() => {
    const seen = new Set(memTopics.map(t => t.type));
    return (['project', 'reference', 'feedback', 'user'] as const).filter(t => seen.has(t));
  }, [memTopics]);
  const visibleMemTopics = useMemo(() => {
    let list = memTopics;
    if (activeMemTag) list = list.filter(t => tagsForMemory(t.filename).includes(activeMemTag));
    return [...list].sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0;
      const tb = Date.parse(b.createdAt) || 0;
      return memSort === 'newest' ? tb - ta : ta - tb;
    });
  }, [memTopics, activeMemTag, tagsForMemory, memSort]);
  // Group-by is only meaningful when there's something to group on; a stale mode
  // (e.g. 'tag' after the last tag is removed) degrades to a flat grid.
  const canGroupByTag = memTags.length > 0;
  const canGroupByType = presentMemTypes.length > 1;
  const activeMemGroup =
    (memGroupBy === 'tag' && canGroupByTag) || (memGroupBy === 'type' && canGroupByType)
      ? memGroupBy
      : 'none';
  const memGroups = useMemo(() => {
    if (activeMemGroup === 'type') {
      return presentMemTypes
        .map(ty => ({
          key: ty,
          label: ty,
          topics: visibleMemTopics.filter(t => t.type === ty),
        }))
        .filter(g => g.topics.length > 0);
    }
    if (activeMemGroup === 'tag') {
      const groups = memTags
        .map(tag => ({
          key: `tag:${tag.name}`,
          label: `#${tag.name}`,
          topics: visibleMemTopics.filter(t => tagsForMemory(t.filename).includes(tag.name)),
        }))
        .filter(g => g.topics.length > 0);
      const untagged = visibleMemTopics.filter(t => tagsForMemory(t.filename).length === 0);
      if (untagged.length > 0)
        groups.push({ key: '__untagged__', label: 'Untagged', topics: untagged });
      return groups;
    }
    return [];
  }, [activeMemGroup, presentMemTypes, memTags, visibleMemTopics, tagsForMemory]);
  const renderMemTile = (t: MemoryTopic, accent: boolean) => {
    const tTags = tagsForMemory(t.filename);
    const open = () =>
      onNavigate({
        type: 'memory-topic',
        topic: t,
        content: topicContent(t.filename),
        hash: project.hash,
      });
    return (
      <div
        key={t.filename}
        role="button"
        tabIndex={0}
        className={`cl-tile ${accent ? 'accent' : ''}`}
        onClick={open}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
      >
        <span className="glyph">{(t.name[0] ?? '?').toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          <div className="t-name">
            <SlugName text={t.name} />
          </div>
          <div className="t-desc">{t.description ? memPreview(t.description) : '—'}</div>
          <div
            className="cl-tile-tags"
            onClick={e => e.stopPropagation()}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              marginTop: 5,
              alignItems: 'center',
            }}
          >
            {tTags.map(name => (
              <TagChip
                key={name}
                name={name}
                tone="soft"
                variant="plain"
                removable
                onRemove={() => toggleTagOnMemory(t.filename, name)}
                style={{ fontSize: 10, height: 18 }}
              />
            ))}
            <button
              type="button"
              className="cl-row-tag-add"
              aria-label="Add tag"
              title="Add tag"
              data-haspicker={memPickerFor?.filename === t.filename}
              onClick={e => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setMemPickerFor({ filename: t.filename, rect });
              }}
            >
              + tag
            </button>
          </div>
        </div>
        <span className="t-meta cl-tile-meta--mem">
          <b>{t.type}</b>
          {t.createdAt && <span className="when">{tileDate(t.createdAt)}</span>}
        </span>
      </div>
    );
  };

  // ── Project landing (design 1c) ──
  // One session list, pins first: they no longer have a section of their own,
  // so putting them at the head of the three is what keeps a pinned — and
  // therefore possibly old — conversation reachable from the landing.
  const landingSessions = useMemo(
    () => [...pinnedSessions, ...unpinnedSessions].slice(0, LANDING_SESSIONS),
    [pinnedSessions, unpinnedSessions]
  );
  const landingMemTopics = useMemo(
    () =>
      [...memTopics]
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
        .slice(0, LANDING_MEM_CARDS),
    [memTopics]
  );
  // "12 topics · 5 reference · 4 feedback" — the total, then the two commonest
  // kinds. A full breakdown runs past the section head on any real memory, and
  // the two that dominate are what says what this project remembers.
  const memTypeBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of memTopics) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([type, n]) => `${n} ${type}`);
  }, [memTopics]);
  const renderMemCard = (t: MemoryTopic, accent: boolean) => {
    const tTags = tagsForMemory(t.filename);
    const open = () =>
      onNavigate({
        type: 'memory-topic',
        topic: t,
        content: topicContent(t.filename),
        hash: project.hash,
      });
    return (
      <div
        key={t.filename}
        role="button"
        tabIndex={0}
        className={`cl-mcard${accent ? ' accent' : ''}`}
        title={t.description || t.name}
        onClick={open}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
      >
        <div className="head">
          <span className="glyph">{(t.name[0] ?? '?').toUpperCase()}</span>
          <span className="kind">{t.type}</span>
          {t.createdAt && <span className="when">{relIso(t.createdAt)}</span>}
        </div>
        <div className="name">
          <SlugName text={t.name} />
        </div>
        <p className="preview">
          {t.description ? memPreview(t.description, MEM_CARD_PREVIEW_MAX) : '—'}
        </p>
        {tTags.length > 0 && (
          <div className="tags">
            {tTags.map(name => (
              <TagChip
                key={name}
                name={name}
                tone="soft"
                variant="plain"
                style={{ fontSize: 10, height: 18 }}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  const enabledMcp = useMemo(() => {
    const all = [...(mcpData?.cloudServers ?? []), ...(mcpData?.localServers ?? [])];
    return all.filter(s => !s.disabledProjectPaths.includes(project.realPath));
  }, [mcpData, project.realPath]);

  const claudeMdLayers = claudeMd?.layers.length ?? 0;
  const claudeMdLayerList = useMemo(() => {
    const order = { project: 0, local: 1, subdir: 2, global: 3 } as const;
    return [...(claudeMd?.layers ?? [])].sort((a, b) => order[a.scope] - order[b.scope]);
  }, [claudeMd]);
  const skillCount = allSkills.length;
  const agents = useMemo(() => {
    const seen = new Map<string, (typeof globalAgents)[number]>();
    for (const a of [...projectAgents, ...globalAgents]) if (!seen.has(a.name)) seen.set(a.name, a);
    return [...seen.values()];
  }, [projectAgents, globalAgents]);
  const agentCount = agents.length;
  const memoryCount = memTopics.length;

  return (
    <div
      style={{
        position: 'relative',
        // The Agent View embeds its dispatch bar at the bottom; let this wrapper
        // fill the scroll viewport (flex column) so the bar pins to the bottom
        // instead of trailing a short session list mid-page. Other sections keep
        // their natural content height.
        ...(section === 'live-agents'
          ? { display: 'flex', flexDirection: 'column', flexGrow: 1 }
          : {}),
      }}
    >
      {/* ─── HERO ─────────────────────────────────────── */}
      <section
        className={`cl-hero${liveProc && !isTeamsSection ? ' is-live' : ''}${
          isTeamsSection ? ' cl-hero--compact cl-hero--teams' : ' cl-hero--band'
        }`}
      >
        {!isTeamsSection && <Lens />}
        <div className="cl-hero-actions">
          <button
            className="cl-btn cl-btn--quiet"
            type="button"
            title="In-app chat through the Agent SDK — billed to Agent SDK credits, separate from your subscription plan"
            onClick={() => onNavigate({ type: 'new-chat', project })}
          >
            <ChatGlyph />
            SDK chat
          </button>
          <button
            className="cl-btn"
            type="button"
            title="Opens the interactive claude CLI embedded in ClaudeLens, with a Mission Control panel and a switch to read the same session as SDK chat (Lens). Terminal usage counts against your subscription plan."
            onClick={() => onNavigate({ type: 'terminal', project })}
          >
            Open in Claude Code
          </button>
        </div>

        <div className="cl-eyebrow">
          <span className="pip" />
          <span title={project.realPath}>Project · {project.realPath}</span>
          {isTeamsSection && <span className="cl-hero-section-label">Teams</span>}
          <button
            type="button"
            className={`cl-eyebrow-pin${pinnedNow ? ' is-pinned' : ''}`}
            title={pinnedNow ? 'Unpin project' : 'Pin project'}
            aria-label={pinnedNow ? 'Unpin project' : 'Pin project'}
            aria-pressed={pinnedNow}
            onClick={() => togglePin(project.hash)}
          >
            <PinIcon filled={pinnedNow} />
            <span>{pinnedNow ? 'Pinned' : 'Pin'}</span>
          </button>
        </div>

        <button
          className="cl-h-name"
          type="button"
          {...searchTriggerProps}
          onClick={e => onToggleProjectSearch(e.currentTarget)}
          aria-haspopup="dialog"
        >
          <span className="label-name">{projectName}</span>
          <span className="glyph">.</span>
          <span className="chev">↓</span>
        </button>

        {isTeamsSection ? (
          <div className="cl-h-meta">
            <span>
              <b>{fmt(sessionCount)}</b> sessions / {retentionDays}d
            </span>
            {lastActive && (
              <>
                <span className="sep">·</span>
                <span>
                  last active <b>{relIso(lastActive)} ago</b>
                </span>
              </>
            )}
          </div>
        ) : (
          /* Metrics band (design 5b): the project's numbers read as a strip of
             hairline-divided cells under the name, replacing both the old meta
             line and the 4-cell stat strip that used to sit below the hero. The
             timeline bars ride inside the first two cells so the retention
             distribution survives the move. */
          <div className="cl-hband">
            <div className="cl-hcell">
              <div className="lbl">
                Sessions / {retentionDays}d
                {lastActive && <span className="when">last {relIso(lastActive)} ago</span>}
              </div>
              <div className="num">
                {fmt(sessionCount)}
                {sessionDelta !== 0 && (
                  /* The delta is against the window immediately before this one.
                     It carried no reference at all, and a green "+3" also read as
                     a verdict the data does not hold — more sessions is not
                     better — so it states its baseline and stays neutral. */
                  <span
                    className="delta"
                    title={`${fmt(prevWindowSessions)} in the previous ${retentionDays} days`}
                  >
                    {sessionDelta > 0 ? '+' : '−'}
                    {Math.abs(sessionDelta)}
                  </span>
                )}
              </div>
              {/* The only sparkline left: sessions and tokens trace nearly the
                  same curve, so a second one spent a quarter of the band
                  re-drawing this one. */}
              <Bars buckets={statBuckets} metric="sessions" />
              <div className="sub">
                {olderSessionCount > 0
                  ? `${fmt(olderSessionCount)} older · ${fmt(allSessionCount)} total`
                  : `all ${fmt(allSessionCount)} in window`}
              </div>
            </div>

            <div
              className="cl-hcell cl-hcell--hover"
              onMouseEnter={openTokenPeek}
              onMouseLeave={closeTokenPeek}
            >
              <div className="lbl">Tokens / {retentionDays}d</div>
              <div
                className="num"
                ref={tokenNumRef}
                tabIndex={0}
                onFocus={openTokenPeek}
                onBlur={closeTokenPeek}
              >
                {tokensFmt.value}
                <small>{tokensFmt.unit}</small>
              </div>
              <div className="sub">
                {Math.round(tokenParts.cacheShare)}% cache read
                <span className="cl-hpeek-hint"> · hover</span>
              </div>
              {/* Portalled to <body> on purpose: `.cl-hero` clips its children
                  (`overflow: hidden` keeps the Lens, which overhangs by 120px,
                  inside), so a card anchored inside the cell was cut off at the
                  hero's bottom edge. Same move MemoryPeekCard makes. */}
              {tokenPeek &&
                totalTokens > 0 &&
                createPortal(
                  <ReadoutShell
                    title="TOKENS"
                    meta={`${retentionDays}d`}
                    style={{
                      position: 'fixed',
                      top: tokenPeek.top,
                      left: tokenPeek.left,
                      width: PEEK_W,
                    }}
                  >
                    <div className="flex" style={{ gap: 12, marginTop: 11 }}>
                      <ReadoutCell label="TOTAL" value={kTok(totalTokens)} />
                      <ReadoutCell
                        label="CACHE READ"
                        value={`${Math.round(tokenParts.cacheShare)}%`}
                      />
                      <ReadoutCell
                        label="SAVED"
                        value={fmtCost(tokenParts.cacheSavings)}
                        color="var(--cl-ok)"
                      />
                    </div>
                    <ReadoutRule />
                    <ReadoutPart
                      label="fresh in/out"
                      value={kTok(tokenParts.fresh)}
                      share={pctOf(tokenParts.fresh, totalTokens)}
                      color={READOUT_RAMP.soft}
                    />
                    <ReadoutPart
                      label="cache read"
                      value={kTok(tokenParts.cacheRead)}
                      share={pctOf(tokenParts.cacheRead, totalTokens)}
                      color={READOUT_RAMP.full}
                    />
                    <ReadoutPart
                      label="cache write"
                      value={kTok(tokenParts.cacheWrite)}
                      share={pctOf(tokenParts.cacheWrite, totalTokens)}
                      color={READOUT_RAMP.mid}
                    />
                  </ReadoutShell>,
                  document.body
                )}
            </div>

            {/* Spend takes the cell Messages held: it is the question an
                overview gets asked, and it used to be the smallest line of the
                band. Messages survives as the qualifier it always was. */}
            <div className="cl-hcell">
              <div className="lbl">Spend / {retentionDays}d</div>
              <div className="num">{fmtCost(totalCost)}</div>
              <div className="sub">
                {fmt(avgMessages)} msg avg · {fmt(totalMessages)} total
              </div>
            </div>

            <div className="cl-hcell cl-hcell--mix">
              <div className="lbl">Model mix / {retentionDays}d</div>
              {modelMix.length === 0 ? (
                <div className="sub">No usage in this window</div>
              ) : (
                <>
                  <div className="cl-mixbar">
                    {modelMix.map(slice => (
                      <i
                        key={slice.key}
                        className={`seg ${slice.key}`}
                        style={{ width: `${slice.pct}%` }}
                        title={`${slice.label} · ${fmt(slice.tokens)} tok · ${slice.sessions} ${
                          slice.sessions === 1 ? 'session' : 'sessions'
                        }`}
                      />
                    ))}
                  </div>
                  {/* One line, dot-separated: bar plus a stacked legend was the
                      same share encoded twice, over two rows. */}
                  <div className="cl-mixlegend">
                    {modelMix.map(slice => (
                      <span key={slice.key}>
                        <i className={`dot ${slice.key}`} />
                        {slice.label} {slice.pctLabel}%
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ─── SECTION CONTENT ──────────────────────────── */}
      {section === 'overview' && (
        <>
          {/* One session block, not two (design 1c): the pinned section and the
              thinner "Recent" strip were the same list read twice, and the strip
              had to drop pins, tags and the figure cluster to justify sitting
              under a section that carried them. Three full rows instead, pins
              first, with the caption saying how many pins the history holds. */}
          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Sessions</h2>
              <span className="ct">
                {hasPinnedSession ? `${pinnedSessions.length} pinned · ` : ''}
                {fmt(sessions.length)} total
              </span>
              <button
                className="all"
                type="button"
                onClick={() => onNavigate({ type: 'sessions', project })}
              >
                View all
              </button>
            </div>
            {/* SessionRows prints its own "No sessions yet." empty state. */}
            <SessionRows
              sessions={landingSessions}
              projectHash={project.hash}
              cleanupDays={cleanupDays}
              onOpen={openTerminal}
              onOpenChat={openChat}
              rankOf={s => sessionRank.get(s.filename) ?? 0}
            />
          </section>

          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>Memory</h2>
              <span className="ct">
                {memoryCount} {memoryCount === 1 ? 'topic' : 'topics'}
                {memTypeBreakdown.length > 0 && ` · ${memTypeBreakdown.join(' · ')}`}
              </span>
              <button
                className="all"
                type="button"
                onClick={() => onNavigate({ type: 'project-memory', project })}
              >
                View all
              </button>
            </div>
            {/* One view, newest first. The landing shows six cards out of a
                history that runs to dozens: at that size grouping by type was a
                control over a sample, and the subtab it links to owns the
                complete list with the sorting and grouping that belong there. */}
            {landingMemTopics.length === 0 ? (
              <div className="cl-empty">No memory topics yet.</div>
            ) : (
              <div className="cl-mem-cards">
                {landingMemTopics.map((t, i) => renderMemCard(t, i === 0))}
              </div>
            )}
          </section>

          <section className="cl-section">
            <div className="cl-sec-head">
              <h2>CLAUDE.md</h2>
              <span className="ct">
                {claudeMdLayers} {claudeMdLayers === 1 ? 'layer' : 'layers'} · global → project →
                local → subdir
              </span>
            </div>
            {claudeMdLayers === 0 ? (
              <div className="cl-empty">No CLAUDE.md instructions for this project.</div>
            ) : (
              <div className="cl-tile-grid">
                {claudeMdLayerList.map((l, i) => {
                  const lines = l.content.split('\n').length;
                  const path =
                    l.scope === 'global'
                      ? '~/.claude/CLAUDE.md'
                      : l.filePath.startsWith(project.realPath + '/')
                        ? l.filePath.slice(project.realPath.length + 1)
                        : l.filePath;
                  return (
                    <button
                      key={l.filePath}
                      type="button"
                      className={`cl-tile ${i === 0 ? 'accent' : ''}`}
                      onClick={() =>
                        l.scope === 'global'
                          ? onNavigate({ type: 'global-claudemd' })
                          : onNavigate({ type: 'project-claudemd', project, layer: l })
                      }
                    >
                      <span className="glyph">M</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="t-name">{CLAUDE_MD_SCOPE_LABEL[l.scope]}</div>
                        <div className="t-desc">{path}</div>
                      </div>
                      <span className="t-meta">
                        <b>{lines}</b> lines
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="cl-config-strip">
            <button
              className={`item ${skillCount ? 'on' : ''}`}
              type="button"
              onClick={() => onNavigate({ type: 'project-skills', project })}
            >
              <span className="pip" />
              <span>Skills</span>
              <span className="num">{skillCount}</span>
            </button>
            <button
              className={`item ${agentCount ? 'on' : ''}`}
              type="button"
              onClick={() => onNavigate({ type: 'project-agents', project })}
            >
              <span className="pip" />
              <span>Agents</span>
              <span className="num">{agentCount}</span>
            </button>
            <button
              className={`item ${enabledMcp.length ? 'on' : ''}`}
              type="button"
              onClick={() => onNavigate({ type: 'project-mcp', project })}
            >
              <span className="pip" />
              <span>MCP</span>
              <span className="num">{enabledMcp.length}</span>
            </button>
            <button
              className={`item ${rules.length ? 'on' : ''}`}
              type="button"
              onClick={() => onNavigate({ type: 'project-mcp', project })}
            >
              <span className="pip" />
              <span>Rules</span>
              <span className="num">{rules.length} active</span>
            </button>
          </section>
        </>
      )}

      {section === 'sessions' && (
        <>
          <PinnedSessionsSection
            sessions={pinnedSessions}
            projectHash={project.hash}
            cleanupDays={cleanupDays}
            onOpen={openTerminal}
            onOpenChat={openChat}
            rankOf={s => sessionRank.get(s.filename) ?? 0}
            style={{ paddingTop: 38 }}
          />
          <section className="cl-section" style={{ paddingTop: hasPinnedSession ? undefined : 38 }}>
            <div className="cl-sec-head">
              <h2>Sessions</h2>
              <span className="ct">
                {activeTag
                  ? `${visibleSessions.length} tagged #${activeTag}`
                  : `${unpinnedSessions.length} total · sorted by last activity`}
              </span>
              {/* The tag filter rides the head, next to the count it filters —
                  as its own band below it cost a hairline and 28px for two
                  words. No "SDK chat" here either: the hero already carries it
                  next to "Open in Claude Code". */}
              <TagBar
                tags={projectTags}
                counts={tagCounts}
                activeTag={activeTag}
                totalCount={sessions.length}
                onSelect={setTagFilter}
                onRename={renameTag}
                onDelete={deleteTag}
              />
            </div>
            {visibleSessions.length === 0 ? (
              <div className="cl-empty">
                {activeTag ? `No sessions tagged #${activeTag}.` : 'No sessions yet.'}
              </div>
            ) : (
              <SessionRows
                key={activeTag ?? '__all__'}
                sessions={visibleSessions}
                projectHash={project.hash}
                cleanupDays={cleanupDays}
                pageSize={60}
                onOpen={openTerminal}
                onOpenChat={openChat}
              />
            )}
          </section>
        </>
      )}

      {section === 'memory' && (
        <section className="cl-section" style={{ paddingTop: 38 }}>
          <div className="cl-sec-head">
            <h2>Project memory</h2>
            <span className="ct">
              MEMORY.md · {memoryCount} {memoryCount === 1 ? 'topic' : 'topics'}
            </span>
            {memTopics.length > 1 && memLayout === 'list' && (
              <button
                type="button"
                className="cl-sort-toggle"
                onClick={() => setMemSort(s => (s === 'newest' ? 'oldest' : 'newest'))}
                title="Sort by creation date"
              >
                Created · {memSort === 'newest' ? 'Newest first' : 'Oldest first'}
                <span aria-hidden>⇅</span>
              </button>
            )}
            {memTopics.length > 1 && (
              <div className="cl-seg cl-seg--paper" style={{ marginLeft: 'auto' }}>
                <button
                  type="button"
                  className={memLayout === 'list' ? 'on' : ''}
                  onClick={() => setMemLayout('list')}
                >
                  List
                </button>
                <button
                  type="button"
                  className={memLayout === 'graph' ? 'on' : ''}
                  onClick={() => setMemLayout('graph')}
                  title="Relations declared between memories via [[wikilinks]]"
                >
                  Graph
                </button>
              </div>
            )}
          </div>
          {memLayout === 'graph' ? (
            <MemoryGraphView
              topics={memTopics}
              contents={memoryContents}
              onOpenTopic={t =>
                onNavigate({
                  type: 'memory-topic',
                  topic: t,
                  content: topicContent(t.filename),
                  hash: project.hash,
                })
              }
            />
          ) : (
            <>
              {(() => {
                const showGroupBy =
                  (canGroupByTag || canGroupByType) && visibleMemTopics.length > 0;
                if (memTags.length === 0 && !showGroupBy) return null;
                return (
                  <div className="cl-mem-toolbar">
                    {memTags.length > 0 ? (
                      <TagBar
                        tags={memTags}
                        counts={memTagCounts}
                        activeTag={activeMemTag}
                        totalCount={memTopics.length}
                        onSelect={setMemTagFilter}
                        onRename={renameMemTag}
                        onDelete={deleteMemTag}
                      />
                    ) : (
                      <span />
                    )}
                    {showGroupBy && (
                      <div className="cl-mem-groupby">
                        <span className="lbl">Group by</span>
                        <button
                          type="button"
                          className={`cl-tagbar-all${activeMemGroup === 'none' ? ' on' : ''}`}
                          onClick={() => setMemGroupBy('none')}
                        >
                          None
                        </button>
                        {canGroupByTag && (
                          <button
                            type="button"
                            className={`cl-tagbar-all${activeMemGroup === 'tag' ? ' on' : ''}`}
                            onClick={() => setMemGroupBy('tag')}
                          >
                            Tag
                          </button>
                        )}
                        {canGroupByType && (
                          <button
                            type="button"
                            className={`cl-tagbar-all${activeMemGroup === 'type' ? ' on' : ''}`}
                            onClick={() => setMemGroupBy('type')}
                          >
                            Type
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
              {memTopics.length === 0 ? (
                <div className="cl-empty">No memory topics yet.</div>
              ) : visibleMemTopics.length === 0 ? (
                <div className="cl-empty">No topics match these filters.</div>
              ) : activeMemGroup === 'none' ? (
                <div className="cl-tile-grid cl-tile-grid--list">
                  {visibleMemTopics.map((t, i) => renderMemTile(t, i === 0 && !activeMemTag))}
                </div>
              ) : (
                memGroups.map(g => (
                  <div key={g.key} className="cl-mem-group">
                    <div className="cl-mem-group-head">
                      <span className="lbl">{g.label}</span>
                      <span className="ct">{g.topics.length}</span>
                    </div>
                    <div className="cl-tile-grid cl-tile-grid--list">
                      {g.topics.map(t => renderMemTile(t, false))}
                    </div>
                  </div>
                ))
              )}
              {memPickerFor && (
                <TagPicker
                  anchorRect={memPickerFor.rect}
                  allTags={memTags}
                  selected={tagsForMemory(memPickerFor.filename)}
                  onToggle={name => toggleTagOnMemory(memPickerFor.filename, name)}
                  onClose={() => setMemPickerFor(null)}
                />
              )}
            </>
          )}
        </section>
      )}

      {section === 'skills' && (
        <section className="cl-section" style={{ paddingTop: 38 }}>
          <div className="cl-sec-head">
            <h2>Skills</h2>
            <span className="ct">{skillCount} available</span>
            <button
              className="all"
              type="button"
              onClick={() => onNavigate({ type: 'skill-create', project })}
            >
              + New
            </button>
          </div>
          {skillCount === 0 ? (
            <div className="cl-empty">No skills available for this project.</div>
          ) : (
            <div className="cl-tile-grid">
              {allSkills.map((s, i) => (
                <button
                  key={s.path}
                  type="button"
                  className={`cl-tile ${i === 0 ? 'accent' : ''}`}
                  onClick={() => onNavigate({ type: 'skill-detail', skill: s })}
                >
                  <span className="glyph">{(s.name[0] ?? '?').toUpperCase()}</span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      className="t-name"
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      /{s.name}
                      <span
                        title={
                          s.scope === 'project'
                            ? 'Defined in this project (.claude/skills)'
                            : 'Defined globally (~/.claude/skills)'
                        }
                        style={{
                          fontSize: 10,
                          fontFamily: 'var(--font-mono)',
                          padding: '1px 5px',
                          borderRadius: 4,
                          letterSpacing: '0.05em',
                          lineHeight: 1.4,
                          background:
                            s.scope === 'project'
                              ? 'var(--cl-accent-soft)'
                              : 'color-mix(in srgb, var(--cl-ink-3) 14%, transparent)',
                          color: s.scope === 'project' ? 'var(--cl-accent-ink)' : 'var(--cl-ink-3)',
                        }}
                      >
                        {s.scope}
                      </span>
                    </div>
                    <div className="t-desc">{s.description || '—'}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {section === 'agents' && (
        <section className="cl-section" style={{ paddingTop: 38 }}>
          <div className="cl-sec-head">
            <h2>Agents</h2>
            <span className="ct">{agentCount} available · delegate-and-summarize</span>
            <button
              className="all"
              type="button"
              onClick={() => onNavigate({ type: 'agent-create', project })}
            >
              + New
            </button>
          </div>
          {agentCount === 0 ? (
            <div className="cl-empty">No agents available for this project.</div>
          ) : (
            <div className="cl-tile-grid">
              {agents.map((a, i) => {
                const glyphs = ['◐', '◑', '◒', '◓'];
                const mode = a.disableModelInvocation ? 'manual' : 'auto';
                const issues = [
                  ...(a.missingRequired.length > 0
                    ? [
                        {
                          label: `missing ${a.missingRequired.join(', ')}`,
                          title: `Missing required frontmatter: ${a.missingRequired.join(', ')}`,
                        },
                      ]
                    : []),
                  ...(a.filenameHasSpaces
                    ? [
                        {
                          label: 'spaces in filename',
                          title:
                            'Claude Code requires agent file names without spaces — this agent may not be loaded.',
                        },
                      ]
                    : []),
                ];
                return (
                  <button
                    key={a.path}
                    type="button"
                    className={`cl-tile ${i === 0 ? 'accent' : ''}`}
                    onClick={() => onNavigate({ type: 'agent-detail', agent: a })}
                  >
                    <span className="glyph">{glyphs[i % glyphs.length]}</span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        className="t-name"
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        {a.name}
                        <span
                          title={
                            a.scope === 'project'
                              ? 'Defined in this project (.claude/agents)'
                              : 'Defined globally (~/.claude/agents)'
                          }
                          style={{
                            fontSize: 10,
                            fontFamily: 'var(--font-mono)',
                            padding: '1px 5px',
                            borderRadius: 4,
                            letterSpacing: '0.05em',
                            lineHeight: 1.4,
                            background:
                              a.scope === 'project'
                                ? 'var(--cl-accent-soft)'
                                : 'color-mix(in srgb, var(--cl-ink-3) 14%, transparent)',
                            color:
                              a.scope === 'project' ? 'var(--cl-accent-ink)' : 'var(--cl-ink-3)',
                          }}
                        >
                          {a.scope}
                        </span>
                        {issues.map(issue => (
                          <span
                            key={issue.label}
                            title={issue.title}
                            style={{
                              fontSize: 10,
                              fontFamily: 'var(--font-mono)',
                              background: 'color-mix(in srgb, #f59e0b 20%, transparent)',
                              color: '#f59e0b',
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
                      <div className="t-desc">{a.description || '—'}</div>
                    </div>
                    <span className="t-meta">
                      {a.model ? `${fmtModel(a.model)} · ` : ''}
                      <b>{mode}</b>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {section === 'mcp' && (
        <section className="cl-section" style={{ paddingTop: 38 }}>
          {enabledMcp.length === 0 ? (
            <>
              <div className="cl-sec-head">
                <h2>MCP servers</h2>
                <span className="ct">0 active · project-scoped</span>
                <button
                  className="all"
                  type="button"
                  onClick={() => onNavigate({ type: 'global-mcp' })}
                >
                  Manage
                </button>
              </div>
              <div className="cl-empty">No MCP servers active for this project.</div>
            </>
          ) : (
            <McpServerGrid
              servers={enabledMcp}
              onSelect={s =>
                onNavigate({
                  type: 'mcp-detail',
                  server: s,
                  totalProjects: s.enabledInProjects + s.disabledInProjects,
                })
              }
              headerAction={
                <button
                  className="all"
                  type="button"
                  onClick={() => onNavigate({ type: 'global-mcp' })}
                >
                  Manage
                </button>
              }
            />
          )}

          <div className="cl-sec-head" style={{ marginTop: 42 }}>
            <h2>Conditional rules</h2>
            <span className="ct">
              {rules.length} {rules.length === 1 ? 'rule' : 'rules'} · path-scoped
            </span>
          </div>
          {rules.length === 0 ? (
            <div className="cl-empty">No conditional rules.</div>
          ) : (
            <div className="cl-rules">
              {rules.map(r => (
                <div key={r.filename} className="cl-rule">
                  <span className="rname">{r.filename}</span>
                  <span className="rwhen">
                    {r.paths && r.paths.length > 0 ? `path: ${r.paths.join(', ')}` : 'always'}
                  </span>
                  <span className="ron">
                    <span className="led" /> on
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {section === 'tasks' && (
        <TasksSection
          project={project}
          onOpenChat={s =>
            onNavigate({
              type: 'terminal',
              project,
              resumeSessionId: s.filename.replace(/\.jsonl$/, ''),
            })
          }
        />
      )}

      {section === 'plans' && (
        <PlansSection
          project={project}
          onOpenChat={s =>
            onNavigate({
              type: 'terminal',
              project,
              resumeSessionId: s.filename.replace(/\.jsonl$/, ''),
            })
          }
          onOpenPlan={plan => onNavigate({ type: 'plan-detail', project, plan })}
        />
      )}

      {section === 'workflows' && (
        <WorkflowsSection
          project={project}
          onOpenChat={s =>
            onNavigate({
              type: 'terminal',
              project,
              resumeSessionId: s.filename.replace(/\.jsonl$/, ''),
            })
          }
          onOpenRun={(sessionId, runId) =>
            onNavigate({ type: 'workflow-detail', project, sessionId, runId })
          }
        />
      )}

      {section === 'teams' && (
        <TeamsSection
          project={project}
          onOpenChat={s =>
            onNavigate({
              type: 'terminal',
              project,
              resumeSessionId: s.filename.replace(/\.jsonl$/, ''),
            })
          }
          onOpenTeam={teamName => onNavigate({ type: 'team-detail', project, teamName })}
        />
      )}

      {section === 'live-agents' && (
        <AgentsLiveView
          embedded
          hideHero
          project={project}
          onBack={() => onNavigate({ type: 'overview' })}
          onOpenSession={(p, s, bg) =>
            onNavigate({
              type: 'terminal',
              project: p,
              resumeSessionId: s.filename.replace(/\.jsonl$/, ''),
              attachJobId: bg?.alive ? bg.jobId : undefined,
              from: 'agents-live',
            })
          }
        />
      )}

      {section === 'config' && (
        <ProjectConfigView project={project} onDeleteProject={() => onDeleteProject(project)} />
      )}
    </div>
  );
}

function sessionAgeDays(date: string): number {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
}

/** Badge for a session currently running in a terminal (active-sessions registry). */
function LiveTag() {
  return (
    <span
      title="This session is running in your terminal right now"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--cl-ok)',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--cl-ok)' }}
      />
      live
    </span>
  );
}

function ExpiryTag({ date, cleanupDays }: { date: string; cleanupDays: number }) {
  const remaining = cleanupDays - sessionAgeDays(date);
  let color: string;
  let opacity: number;
  let label: string;

  if (remaining <= 0) {
    color = 'oklch(0.60 0.18 25)';
    opacity = 1;
    label = 'expired';
  } else if (remaining <= 3) {
    color = 'oklch(0.60 0.18 25)';
    opacity = 1;
    label = `${remaining}d`;
  } else if (remaining <= 7) {
    color = 'oklch(0.65 0.15 55)';
    opacity = 0.9;
    label = `${remaining}d`;
  } else {
    color = 'var(--cl-ink-4)';
    opacity = 0.4;
    label = `${remaining}d`;
  }

  return (
    <span
      title={`Auto-deleted after ${cleanupDays} days · cleanupPeriodDays in ~/.claude/settings.json`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color,
        opacity,
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      <svg
        width="7"
        height="7"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      {label}
    </span>
  );
}

function PinnedSessionsSection({
  sessions,
  projectHash,
  cleanupDays,
  onOpen,
  onOpenChat,
  rankOf,
  style,
}: {
  sessions: SessionSummary[];
  projectHash: string;
  cleanupDays: number;
  onOpen: (s: SessionSummary) => void;
  onOpenChat: (s: SessionSummary) => void;
  rankOf?: (s: SessionSummary) => number;
  style?: CSSProperties;
}) {
  if (sessions.length === 0) return null;
  return (
    <section className="cl-section" style={style}>
      <div className="cl-sec-head">
        <h2>Pinned sessions</h2>
        <span className="ct">{sessions.length} pinned</span>
      </div>
      <SessionRows
        sessions={sessions}
        projectHash={projectHash}
        cleanupDays={cleanupDays}
        onOpen={onOpen}
        onOpenChat={onOpenChat}
        rankOf={rankOf}
      />
    </section>
  );
}

type SessionRowProps = {
  session: SessionSummary;
  rank: number;
  pinned: boolean;
  live: boolean;
  tags: string[];
  cleanupDays: number;
  pickerOpen: boolean;
  onOpen: (s: SessionSummary) => void;
  onOpenChat: (s: SessionSummary) => void;
  onTogglePin: (filename: string) => void;
  onAddTag: (filename: string, rect: DOMRect) => void;
  onRemoveTag: (filename: string, tag: string) => void;
  onDelete: (s: SessionSummary) => void;
};

// The session list re-renders on every active-sessions heartbeat and every
// `data:changed`; this comparator lets an individual row skip those unless its
// own data actually changed. `session` is compared by reference — React Query's
// structural sharing (on by default) keeps an unchanged session referentially
// stable across a refetch — and `tags` shallowly, because the tags hook returns
// a fresh `[]` for untagged sessions each render. Callbacks are stable by
// construction (useCallback / latest-ref in SessionRows) and not compared.
function sessionRowEqual(a: SessionRowProps, b: SessionRowProps): boolean {
  if (
    a.session !== b.session ||
    a.rank !== b.rank ||
    a.pinned !== b.pinned ||
    a.live !== b.live ||
    a.cleanupDays !== b.cleanupDays ||
    a.pickerOpen !== b.pickerOpen ||
    a.tags.length !== b.tags.length
  ) {
    return false;
  }
  for (let i = 0; i < a.tags.length; i++) {
    if (a.tags[i] !== b.tags[i]) return false;
  }
  return true;
}

const SessionRow = memo(function SessionRow({
  session: s,
  rank,
  pinned,
  live,
  tags,
  cleanupDays,
  pickerOpen,
  onOpen,
  onOpenChat,
  onTogglePin,
  onAddTag,
  onRemoveTag,
  onDelete,
}: SessionRowProps) {
  const fam = modelFamily(s.model);
  // No title of any kind on disk → sessionTitle() falls back to the placeholder,
  // which the row prints in the muted italic of the mock.
  const untitled = !(s.customTitle?.trim() || s.aiTitle?.trim() || s.firstUserMessage?.trim());
  return (
    <div
      role="button"
      tabIndex={0}
      className={`cl-srow${pinned ? ' is-pinned' : ''}`}
      onClick={() => onOpen(s)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(s);
        }
      }}
    >
      <button
        type="button"
        className={`cl-srow-pin${pinned ? ' pinned' : ''}`}
        title={pinned ? 'Unpin session' : 'Pin session'}
        aria-label={pinned ? 'Unpin session' : 'Pin session'}
        onClick={e => {
          e.stopPropagation();
          onTogglePin(s.filename);
        }}
        onKeyDown={e => e.stopPropagation()}
      >
        <PinIcon filled={pinned} />
      </button>
      <span className="idx">{String(rank).padStart(2, '0')}</span>
      <span className={`title${untitled ? ' is-untitled' : ''}`}>{sessionTitle(s)}</span>
      {live && <LiveTag />}
      <ExpiryTag date={s.date} cleanupDays={cleanupDays} />
      {/* rendered only when there are tags: an empty flex item would still take
          the row's 12px gap and eat into the space before the figures */}
      {tags.length > 0 && (
        <span className="cl-srow-tags" onClick={e => e.stopPropagation()}>
          {tags.map(t => (
            <TagChip
              key={t}
              name={t}
              variant="plain"
              tone="soft"
              removable
              onRemove={() => onRemoveTag(s.filename, t)}
            />
          ))}
        </span>
      )}

      {/* Plain empty space between the title cluster and the figures. It carried a
          dotted leader (design 5b/4b) with the row actions floating on it: with
          the actions collapsed into one kebab there is nothing left for the
          leader to connect, and a run of grey dots down every row was reading as
          decoration. The figures keep their fixed column widths — that is what
          actually aligns the list. */}
      <span className="cl-srow-gap" aria-hidden />

      <span className="meta">
        <span className="msg">{fmt(s.messageCount)} msg</span>
        <span className={`model ${fam}`}>
          <span className="dot" /> {s.model ? fmtModel(s.model) : '—'}
        </span>
        <span className="toks">{fmt(s.totalTokens)}</span>
        <span className="when">{shortWhen(s.date)}</span>
      </span>

      <SessionRowMenu
        title={sessionTitle(s)}
        pinned={pinned}
        pickerOpen={pickerOpen}
        onOpenChat={() => onOpenChat(s)}
        onAddTag={rect => onAddTag(s.filename, rect)}
        onTogglePin={() => onTogglePin(s.filename)}
        onDelete={() => onDelete(s)}
      />
    </div>
  );
}, sessionRowEqual);

function SessionRows({
  sessions,
  projectHash,
  cleanupDays,
  onOpen,
  onOpenChat,
  rankOf,
  pageSize,
}: {
  sessions: SessionSummary[];
  projectHash: string;
  cleanupDays: number;
  onOpen: (s: SessionSummary) => void;
  onOpenChat: (s: SessionSummary) => void;
  // When provided, overrides the sequential row number with the session's true
  // position in the full list (used by the pinned section, which gets a subset).
  rankOf?: (s: SessionSummary) => number;
  // When set, only the first `pageSize` rows mount, behind a "Show more" button
  // (the full Sessions view, with hundreds of rows). Omitted for the small
  // pinned/preview lists, which render in full.
  pageSize?: number;
}) {
  const { isPinned, togglePin } = usePinnedSessions();
  const { data: activeSessions = [] } = useActiveSessions();
  const liveIds = useMemo(
    () => new Set(activeSessions.map(a => a.sessionId).filter(Boolean)),
    [activeSessions]
  );
  const {
    tags: allTags,
    tagsForSession,
    toggleTagOnSession,
    removeTagFromSession,
  } = useSessionTags(projectHash);
  const [pickerFor, setPickerFor] = useState<{ filename: string; rect: DOMRect } | null>(null);
  const [deleteFor, setDeleteFor] = useState<SessionSummary | null>(null);

  // Progressive rendering: cap mounted rows when a pageSize is given. The list is
  // remounted (keyed by project + tag filter at the call site) when its identity
  // changes, so `shown` resets then — a plain watcher refetch never does.
  const [shown, setShown] = useState(pageSize ?? Infinity);

  // onOpen/onOpenChat are already referentially stable (useCallback in
  // ProjectView), so they pass straight to the memoized rows; the rest wrap
  // stable hook fns / setState.
  const handleTogglePin = useCallback(
    (filename: string) => togglePin(projectHash, filename),
    [togglePin, projectHash]
  );
  const handleAddTag = useCallback(
    (filename: string, rect: DOMRect) => setPickerFor({ filename, rect }),
    []
  );
  const handleRemoveTag = useCallback(
    (filename: string, tag: string) => removeTagFromSession(filename, tag),
    [removeTagFromSession]
  );
  const handleDelete = useCallback((s: SessionSummary) => setDeleteFor(s), []);

  if (sessions.length === 0) return <div className="cl-empty">No sessions yet.</div>;

  const visible = shown >= sessions.length ? sessions : sessions.slice(0, shown);
  const remaining = sessions.length - visible.length;

  return (
    <div className="cl-srows">
      {visible.map((s, i) => (
        <SessionRow
          key={s.filename}
          session={s}
          rank={rankOf ? rankOf(s) : i + 1}
          pinned={isPinned(projectHash, s.filename)}
          live={liveIds.has(s.filename.replace(/\.jsonl$/, ''))}
          tags={tagsForSession(s.filename)}
          cleanupDays={cleanupDays}
          pickerOpen={pickerFor?.filename === s.filename}
          onOpen={onOpen}
          onOpenChat={onOpenChat}
          onTogglePin={handleTogglePin}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onDelete={handleDelete}
        />
      ))}
      {/* Footer in the 5b idiom: the range on the left, the progressive-load
          control on the right where the mock puts its pager. Loading stays
          progressive (mounted rows only) rather than paged. */}
      {pageSize !== undefined && (
        <div className="cl-srow-foot">
          <span className="range">
            <b>1–{visible.length}</b> of {sessions.length}
          </span>
          {remaining > 0 && (
            <button
              type="button"
              className="cl-srow-more"
              onClick={() => setShown(n => n + (pageSize ?? sessions.length))}
            >
              Show more · {remaining} remaining
            </button>
          )}
        </div>
      )}
      {pickerFor && (
        <TagPicker
          anchorRect={pickerFor.rect}
          allTags={allTags}
          selected={tagsForSession(pickerFor.filename)}
          onToggle={name => toggleTagOnSession(pickerFor.filename, name)}
          onClose={() => setPickerFor(null)}
        />
      )}
      {deleteFor && (
        <DeleteSessionDialog
          hash={projectHash}
          sessionFilename={deleteFor.filename}
          title={sessionTitle(deleteFor)}
          onCancel={() => setDeleteFor(null)}
          onDeleted={() => setDeleteFor(null)}
        />
      )}
    </div>
  );
}
