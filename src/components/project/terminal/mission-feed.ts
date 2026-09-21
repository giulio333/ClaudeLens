import type { Task, TeamSummary } from '../../../types';
import {
  fileExt,
  isQuestionDismissed,
  MEMORY_TYPE_TINT,
  parseAnswersFromResultText,
  parseAskUserQuestions,
  QUESTION_TOOL,
  touchedFiles,
} from '../chat/utils';
import { changeStat, fileName } from '../chat/file-view';
import { artifactIsPrivate, shortArtifactUrl } from '../chat/artifact';
import type { ArtifactActivity } from '../chat/artifact';
import type {
  MemoryAction,
  MemoryActivity,
  MemoryTouch,
  ProcessedMessage,
  SessionAgent,
  SessionSkill,
  ToolGroup,
  TouchedFile,
} from '../chat/utils';
import {
  parseHttpFailure,
  parseRedirectNotice,
  parseWebSearchResult,
  webCanonicalUrl,
  webHost,
  webOutcome,
  webPageLabel,
  WEB_FETCH,
  WEB_SEARCH,
  WEB_TOOLS,
} from '../chat/web';
import type { WebLink, WebRedirect } from '../chat/web';

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

/** +added/−removed of one file-mutating call — the diff's numbers, the same
 *  the chat prints — or null for a call that mutates nothing. */
export function editStats(g: ToolGroup): { added: number; removed: number } | null {
  return EDIT_TOOLS.has(g.use.name) ? changeStat([{ kind: 'tool', group: g }]) : null;
}

export type FileChange = {
  path: string;
  name: string;
  /** Every call that touched the file, in order — a Bash run once, however
   *  many of its files it appears under. */
  items: ToolGroup[];
  added: number;
  removed: number;
  hasError: boolean;
  /** The file did not exist before this session: a `Write` whose result says
   *  so, or a shell run Claude Code recorded as creating it. A file both
   *  created and later edited still counts as created. */
  created: boolean;
  deleted: boolean;
  /** The file as the chat's strip sees it: the sources behind each number, so
   *  the rail can draw the same diff the turn does. */
  file: TouchedFile;
};

/** Per-file aggregate of every mutating call — the session's work product.
 *  Built on the chat's `touchedFiles`, so the two agree on what a change is:
 *  the file tools from their input, and the files a shell command rewrote from
 *  its result (#265) — which is how Claude edits in auto mode, and what this
 *  used to miss altogether. The numbers are the diff's (`changeStat`), the
 *  recorded hunks when the row has them, not a count of the input's lines. */
export function buildFileChanges(groups: ToolGroup[]): FileChange[] {
  return touchedFiles(groups)
    .filter(f => f.action !== 'read')
    .map(f => {
      const items: ToolGroup[] = [];
      for (const s of f.sources) if (!items.includes(s.group)) items.push(s.group);
      return {
        path: f.path,
        name: fileName(f.path),
        items,
        ...changeStat(f.sources),
        hasError: items.some(g => !!g.result?.isError),
        created: f.action === 'created',
        deleted: f.action === 'deleted',
        file: f,
      };
    });
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

/* ── web activity ─────────────────────────────────────────────────────── */

/**
 * What the session read from outside the machine.
 *
 * The web tools were the one kind of work the feed never showed: a research
 * session could pull ten pages and run five searches and the rail stayed empty
 * except for the files it wrote afterwards — the sources of an answer were
 * invisible, and a fetch that never landed (a redirect, a dead host) was
 * invisible twice over.
 *
 * The unit is **the page, or the query** — one row per distinct URL and per
 * distinct query, aggregating repeated calls the way `buildFileChanges`
 * aggregates repeated edits of one file. Two fetches of the same URL are the
 * same source read twice (usually asking it for something different), not two
 * events; two different pages of one host are two sources, so they stay apart.
 *
 * What this cannot see, by construction: a **sub-agent's** fetches, which live
 * in its own sidechain transcript (the AGENTS row is their entry point), and any
 * page pulled through a shell command or an MCP browser tool — neither carries a
 * `url` input this can read.
 */

export type WebVisitKind = 'fetch' | 'search';

export type WebVisit = {
  /** Stable row identity: the URL for a fetch, the query for a search. */
  key: string;
  kind: WebVisitKind;
  /** Page label (fetch) or the query itself (search) — the row's title. */
  title: string;
  /** Empty for a search, which has no single source. */
  url: string;
  /** Host of the URL; empty for a search. */
  host: string;
  /** The extraction ask (fetch) or the domain restriction (search) — tooltip
   *  material: it explains *why* the page was pulled. */
  ask: string;
  /** Every call on this source, in transcript order. */
  items: ToolGroup[];
  /** Sources a search returned, from the call that produced them. */
  links: WebLink[];
  /** Where a fetch was redirected — evidence kept even when a later call to the
   *  same URL succeeded, so the row can decide which fact it reports. */
  redirect: WebRedirect | null;
  /** Calls that came back with actual content. */
  reads: number;
  hasError: boolean;
  /** Why it failed, in the tool's own words (first line) — a network error for a
   *  fetch, `unavailable` for a search that never ran. */
  failure: string | null;
};

function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  return typeof v === 'string' ? v : '';
}

export function buildWebActivity(groups: ToolGroup[]): WebVisit[] {
  const byKey = new Map<string, WebVisit>();
  for (const g of groups) {
    const name = g.use.name;
    if (!WEB_TOOLS.has(name)) continue;
    const input = g.use.input as Record<string, unknown>;
    const fetch = name === WEB_FETCH;
    // A call whose defining input is missing can't be aggregated under any
    // source — skipping it beats inventing a row titled "".
    const rawSubject = fetch ? str(input, 'url') : str(input, 'query');
    if (!rawSubject) continue;
    // A fetch is grouped by the *document* it asked for, not by the exact string:
    // two spellings of one page (an anchor, a trailing slash) are one source.
    const subject = fetch ? webCanonicalUrl(rawSubject) : rawSubject;

    const key = `${fetch ? 'fetch' : 'search'}:${subject}`;
    let v = byKey.get(key);
    if (!v) {
      const domains = input.allowed_domains;
      v = {
        key,
        kind: fetch ? 'fetch' : 'search',
        title: fetch ? webPageLabel(subject) : subject,
        url: fetch ? subject : '',
        host: fetch ? webHost(subject) : '',
        ask: fetch
          ? str(input, 'prompt')
          : Array.isArray(domains)
            ? domains.filter(d => typeof d === 'string').join(', ')
            : '',
        items: [],
        links: [],
        redirect: null,
        reads: 0,
        hasError: false,
        failure: null,
      };
      byKey.set(key, v);
    }
    v.items.push(g);

    const raw = g.result?.content ?? '';
    switch (webOutcome(name, g.result)) {
      case 'read':
        v.reads += 1;
        if (name === WEB_SEARCH) {
          const links = parseWebSearchResult(raw).links;
          if (links.length > 0) v.links = links;
        }
        break;
      case 'redirect':
        v.redirect = parseRedirectNotice(raw);
        break;
      case 'failed':
        v.hasError = true;
        v.failure =
          (name === WEB_SEARCH
            ? parseWebSearchResult(raw).error
            : // `HTTP 404 Not Found` reads as a row's meta; the sentence it opens
              // ("The server returned …", plus advice about authenticated tools)
              // does not. A transport error has no such shape, so it keeps its
              // first line.
              (parseHttpFailure(raw) ?? raw.split('\n')[0]?.trim())) || null;
        break;
      case 'pending':
        break;
    }
  }
  return [...byKey.values()];
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

export type FeedKind =
  'AGENTS' | 'TEAMS' | 'SKILLS' | 'QUESTIONS' | 'MEMORY' | 'WEB' | 'CHANGES' | 'PAGES' | 'TASKS';

/** Every filter the rail can offer, in the order the pills are laid out: who did
 *  the work, then what informed it (asked of the user, recalled, then read from
 *  outside), then what it produced — the files it changed, the pages it
 *  published — and what is still planned. */
export const FEED_KINDS: FeedKind[] = [
  'AGENTS',
  'TEAMS',
  'SKILLS',
  'QUESTIONS',
  'MEMORY',
  'WEB',
  'CHANGES',
  'PAGES',
  'TASKS',
];

/** The domain object behind a row — the view routes the click from this. */
export type FeedSource =
  | { kind: 'agent'; agent: SessionAgent }
  | { kind: 'skill'; skill: SessionSkill }
  /** The turn the question was asked on — the row locates it rather than opening
   *  a panel: the transcript already draws the ask with all its options. */
  | { kind: 'question'; turnN: number }
  | { kind: 'memory'; touch: MemoryTouch }
  | { kind: 'web'; visit: WebVisit }
  | { kind: 'change'; change: FileChange }
  | { kind: 'artifact'; artifact: ArtifactActivity }
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
  /** CHANGES rows only: which action the row's icon draws — a file created by
   *  `Write` vs. one only edited. Absent for every other species. */
  actionGlyph?: 'edit' | 'write' | 'delete';
  title: string;
  meta: string;
  /** Third tooltip line: the fact the row had to truncate — a page's full URL and
   *  the ask behind it. Never something the row already prints. */
  hint?: string;
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
  /** Pages fetched and searches run — `buildWebActivity(ownTools)`. */
  web: WebVisit[];
  changes: FileChange[];
  /** Pages published with the `Artifact` tool — `buildArtifactActivity(ownTools)`. */
  artifacts: ArtifactActivity[];
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

/**
 * QUESTIONS — the moments the session stopped and asked the user something.
 *
 * It used to be a turn filter in the control pill, next to Thinking and Plan.
 * It is not that kind of thing: an `AskUserQuestion` is a tool call, an event
 * with a time and an outcome, exactly like a skill invocation or a fetched page
 * — and the pill's filter could only say how many there were. Here a row names
 * the question, carries the answer that was actually chosen, and dates it.
 *
 * The three states are the transcript card's, not new ones (`AskQuestionCard`
 * in `MessageBubble`): a call with no result is **pending**, a result with no
 * parsed answers that reads as a rejection is **dismissed** (the user closed the
 * ask and kept talking), everything else is **answered**. Pending is the only
 * one tinted — it is the only one that is still waiting on somebody.
 */
function questionEvents(input: MissionFeedInput, turnAt: number[]): FeedEvent[] {
  const events: FeedEvent[] = [];
  input.processed.forEach((p, i) => {
    for (const g of p.toolGroups) {
      if (g.use.name !== QUESTION_TOOL) continue;
      const questions = parseAskUserQuestions(g.use.input as Record<string, unknown>);
      // A call we cannot read a question out of has nothing to put in a row; the
      // transcript card skips it for the same reason.
      if (questions.length === 0) continue;
      const resultText = g.result?.content ?? '';
      const answers = g.result ? parseAnswersFromResultText(resultText) : {};
      const chosen = questions.map(q => answers[q.question]).filter(Boolean);
      const state = !g.result
        ? 'pending'
        : chosen.length === 0 && isQuestionDismissed(resultText)
          ? 'dismissed'
          : 'answered';
      // The answer is the fact worth carrying; the count only earns its place
      // when one call asked more than one thing.
      const meta =
        [questions.length > 1 ? `${questions.length} questions` : null, ...chosen]
          .filter(Boolean)
          .join(' · ') || (state === 'pending' ? 'waiting for reply' : 'kept talking');
      events.push({
        id: `question:${g.use.id || `${i}`}`,
        kind: 'QUESTIONS' as const,
        at: turnAt[i] ?? 0,
        // Never live, not even pending — the same line WEB's PENDING draws. A
        // call with no result on disk may be a session waiting on you right now
        // or a CLI killed mid-ask a week ago, and the transcript cannot tell
        // them apart; `live` floats a row over everything and takes the live
        // tint, which would be that claim. It does not cost salience either: a
        // question that is genuinely still open is the last thing written, so
        // the newest-first sort already puts it on top — because it IS newest,
        // which is a fact, rather than because we guessed it was current.
        live: false,
        glyph: '?',
        // The amber the transcript already gives an ask — the same encoding, not
        // a tint of its own.
        glyphTint: 'var(--cl-warn)',
        title: questions[0].question,
        meta,
        // The row truncates at rail width, so the whole ask — every question and
        // what was picked — stays recoverable without opening anything.
        hint: questions
          .map(q => `${q.question}${answers[q.question] ? ` → ${answers[q.question]}` : ''}`)
          .join(' · '),
        right: state === 'answered' ? 'ANSWERED' : state === 'pending' ? 'PENDING' : 'NO ANSWER',
        rightTint: state === 'pending' ? 'var(--cl-warn)' : 'var(--cl-ink-4)',
        items: [],
        expandable: false,
        source: { kind: 'question' as const, turnN: i + 1 },
      });
    }
  });
  return events;
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

/**
 * What one call of a bundled web row asked for — the disclosure's differentiator.
 *
 * A row that groups two fetches of the same URL would otherwise list `WebFetch`
 * twice, and the tool name is the one thing the two calls share; what differs is
 * the ask (the same page read once for dates and once for its PDF links). Empty
 * for every non-web tool, so the shared disclosure can call it blind.
 */
export function webItemNote(g: ToolGroup): string {
  if (!WEB_TOOLS.has(g.use.name)) return '';
  const input = g.use.input as Record<string, unknown>;
  const text = g.use.name === WEB_FETCH ? str(input, 'prompt') : str(input, 'query');
  return clip(text.split('\n')[0]?.trim() ?? '', 80);
}

/** Up to two distinct result hosts, `+N` for the rest: a search's meta answers
 *  "where did this answer come from" with the sources themselves. */
function linkHosts(links: WebLink[]): string {
  const hosts: string[] = [];
  for (const l of links) {
    const h = webHost(l.url);
    if (h && !hosts.includes(h)) hosts.push(h);
  }
  if (hosts.length === 0) return '';
  const head = hosts.slice(0, 2).join(' · ');
  return hosts.length > 2 ? `${head} · +${hosts.length - 2}` : head;
}

/** Native tooltips take whatever they're given; a 600-character extraction ask
 *  is not a tooltip. */
function clip(s: string, max = 240): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function webEvents(input: MissionFeedInput, at: Map<string, number>): FeedEvent[] {
  return input.web.map(v => {
    // Precedence follows the question the reader is asking: did the session end
    // up with the page? A URL called twice — once redirected, once read — was
    // read, and reporting REDIRECT there would be false.
    const read = v.reads > 0;
    const failed = !read && v.hasError;
    const redirected = !read && !failed && !!v.redirect;
    const pending = !read && !failed && !redirected;
    const search = v.kind === 'search';
    const source = search ? linkHosts(v.links) || 'web search' : v.host === v.title ? '' : v.host;
    return {
      id: `web:${v.key}`,
      kind: 'WEB' as const,
      at: latestOf(v.items, at),
      live: false,
      glyph: 'W',
      // The hue the transcript already gives the web tools (`TOOL_TINT`), so a
      // fetch reads the same in the rail and in the chat.
      glyphTint: 'var(--cl-haiku)',
      title: v.title,
      meta: [
        source,
        failed ? v.failure : null,
        redirected && v.redirect?.to ? `→ ${webHost(v.redirect.to)}` : null,
        v.reads > 1 ? `×${v.reads}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      hint: search
        ? v.ask
          ? `restricted to ${v.ask}`
          : undefined
        : clip([v.url, v.ask].filter(Boolean).join('\n')),
      right: failed
        ? 'FAILED'
        : redirected
          ? 'REDIRECT'
          : pending
            ? 'PENDING'
            : search
              ? v.links.length > 0
                ? `${v.links.length} LINKS`
                : 'SEARCHED'
              : 'FETCHED',
      rightTint: failed ? 'var(--cl-danger)' : redirected ? 'var(--cl-warn)' : 'var(--cl-ink-4)',
      danger: failed,
      items: v.items,
      expandable: v.items.length > 1,
      source: { kind: 'web' as const, visit: v },
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
      actionGlyph: fc.created ? 'write' : fc.deleted ? 'delete' : 'edit',
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

/**
 * One row per page the session published, not one per publish.
 *
 * Four republishes of the same page are one outcome — the rail already reads a
 * file's edits that way, and the chat is where each publish sits at the moment
 * it happened. The row is not expandable for the same reason: what a publish
 * answered is a kilobyte of prose written for the harness, so the click is
 * worth more spent on the page itself.
 */
function artifactEvents(input: MissionFeedInput, at: Map<string, number>): FeedEvent[] {
  return input.artifacts.map(a => {
    const isPrivate = artifactIsPrivate(a);
    const what = a.publishes > 1 ? `${a.publishes} publishes` : a.created ? 'created' : 'updated';
    return {
      id: `artifact:${a.id}`,
      kind: 'PAGES' as const,
      at: latestOf(a.items, at),
      live: false,
      // The arrow the app already uses for a link that leaves it (`UrlChip`):
      // the one thing worth saying about this row before its name is that it
      // points somewhere outside.
      glyph: '↗',
      glyphTint: 'var(--cl-accent)',
      title: a.title || 'Untitled page',
      meta: `${what} · ${shortArtifactUrl(a.url)}`,
      hint: [a.description, isPrivate === undefined ? '' : isPrivate ? 'private' : 'shared']
        .filter(Boolean)
        .join(' — '),
      // No `seq` on older transcripts, and a version counted from the publishes
      // this session happens to show would be wrong on any page published from
      // more than one of them.
      right: a.seq && a.seq > 0 ? `v${a.seq}` : 'PUBLISHED',
      rightTint: 'var(--cl-accent-ink)',
      items: a.items,
      expandable: false,
      source: { kind: 'artifact' as const, artifact: a },
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
    ...questionEvents(input, turnAt),
    ...memoryEvents(input, at),
    ...webEvents(input, at),
    ...changeEvents(input, at),
    ...artifactEvents(input, at),
    ...taskEvents(input, at),
  ];
  // Stable sort (ES2019+): rows that tie keep the order their species produced.
  return events.sort((a, b) => Number(b.live) - Number(a.live) || b.at - a.at);
}

/** How many events each filter would show. */
export function countByKind(events: FeedEvent[]): Record<FeedKind, number> {
  const counts = {
    AGENTS: 0,
    TEAMS: 0,
    SKILLS: 0,
    QUESTIONS: 0,
    MEMORY: 0,
    WEB: 0,
    CHANGES: 0,
    PAGES: 0,
    TASKS: 0,
  };
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
