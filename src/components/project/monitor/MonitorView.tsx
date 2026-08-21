import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  useActiveSessions,
  useSessionActivity,
  useLiveSessions,
  useMemoryProjects,
} from '../../../hooks/useIPC';
import type { ActiveSession, SessionActivity, BgSession, TraceMark } from '../../../types';
import { TopBar } from '../shared/TopBar';
import { fmt, fmtCost, fmtModel } from '../utils';
import { projectDisplayName } from '../shared/projectName';
import { TOOL_TINT } from '../chat/utils';
import { buildTape, TAPE_ROWS, TAPE_SPAN_MS } from './trace';

// The Monitor: every Claude process running on this machine, as one index card
// per process.
//
// Deliberately NOT a second Agent View. That page is a ROSTER — everything you
// dispatched, most of it finished or asleep, with the controls to act on it.
// This one is machine state: what has a pid right now, across every project. A
// background agent that is actually running shows up here too (it is a claude
// process burning tokens), but as a card that ROUTES to Agent View — the
// dispatch/stop/respawn controls stay in one place.
//
// Two sources, joined by sessionId: the registry says a session is busy or
// waiting (`useActiveSessions`), the transcript tail says at what
// (`useSessionActivity`). Neither is derived from the other.
//
// ── Why a card, and why its body is a tape ───────────────────────────────────
// Two earlier forms were rejected as bare: a grid of dark cards, then a dark
// board of full-width lanes. Both failed for the same structural reason — a wide
// dark surface holding five short strings is mostly empty by construction, and
// on this app's warm paper a black slab also reads as a foreign object. Nothing
// about a process makes it a terminal; that analogy was borrowed, and it cost
// the page twice.
//
// So the card is the app's own index card, and its body is the TAPE: what the
// session actually did, newest first, each action with the subject it acted on
// (`Edit MonitorView.tsx`, `Bash npm run typecheck ✕`). A card whose body is
// real text cannot look empty.
//
// The pulse strip went with the board. What it answered — "is this hung?" — the
// tape answers in words: a top row that says `4m` is a session that has done
// nothing for four minutes. A session's STATE ("busy") never answered that on
// its own, because a session mid-tool and a session hung are identical from the
// registry; what separates them is when it last did something, which is now
// printed rather than drawn.

type Project = { hash: string; realPath: string };

// `ready` is a session that is alive but has finished its turn — observed, not
// guessed. Worth its own state because "alive" and "working" are not the same
// claim, and a page that calls every live session WORKING is lying about most of
// them most of the time. It takes BOTH sources to assert (see `isReady`): the
// transcript's `end_turn` alone called a session ready while an async sub-agent
// worked on for minutes.
type State = 'blocked' | 'working' | 'ready' | 'ended';

interface Card {
  key: string;
  state: State;
  /** The project — the identity a person recognises. */
  title: string;
  /** What distinguishes this process from a sibling in the same project. */
  ident: string;
  /** The machine facts, in their own row: pid, model, uptime, subdirectory.
   *  Each is a field of its own — never a suffix glued to `ident`, which is
   *  where a long conversation title used to eat the pid off the end. */
  machine: string[];
  /** What it is doing, or what it is waiting on. */
  doing: string;
  /** The tool name, printed ahead of `doing` at full strength. */
  tool: string | null;
  /** Epoch ms the state clock counts from; null when unknown. */
  since: number | null;
  counts: string;
  /** Epoch ms of the last transcript append — how long the session has been
   *  silent, said in the vitals row. Null when nothing has been read yet. */
  lastAppendAt: number | null;
  /** Set while a sub-agent is running: it explains the silence, so it takes the
   *  slot `quiet` would have had. */
  delegateSince: number | null;
  /** How full the window is. The one measure on the card with a real
   *  denominator, and therefore the only one drawn as a gauge. */
  context: { used: number; max: number } | null;
  /** Dollars, and whether the price had to be estimated. */
  spend: number | null;
  spendEstimated: boolean;
  tokens: number;
  trace: TraceMark[];
  /** A background agent has no transcript of its own to tail, so it has no
   *  tape. Saying so beats printing an empty body. */
  noTrace: boolean;
  /** Printed where the silence figure goes, for a card that only routes. */
  routeNote: string | null;
  onOpen: (() => void) | null;
}

const STATE_ORDER: Record<State, number> = { blocked: 0, working: 1, ready: 2, ended: 3 };
const STATE_LABEL: Record<State, string> = {
  blocked: 'NEEDS YOU',
  working: 'WORKING',
  ready: 'READY',
  ended: 'ENDED',
};

/** Silence shorter than this is just the gap between two tool calls, and saying
 *  `quiet 2s` about a session hammering the filesystem is noise. */
const QUIET_FLOOR_MS = 10_000;

/** The tape's window, in the unit the tooltip says it in. */
const TAPE_MINUTES = Math.round(TAPE_SPAN_MS / 60_000);

const ESTIMATE_NOTE =
  'Approximate: this model has no exact entry in the pricing table, so it is priced by family.';

/** The dot that opens a tape row. It carries `TOOL_TINT` — the transcript's own
 *  tool encoding, reused verbatim now that the card is on paper and needs no
 *  dark-lift variants. The colour sits on a 5px swatch rather than on the tool's
 *  name: colouring text you have to read is worse than colouring a marker beside
 *  it, and the swatches line up into a column that gives each card the signature
 *  of the kind of work it is doing — a run of cyan is a session reading, violet
 *  a session editing. */
function toolTint(tool: string | null): string {
  if (!tool) return 'var(--cl-ink-4)';
  return TOOL_TINT[tool] ?? 'var(--cl-ink-3)';
}

function contextPct(context: { used: number; max: number }): number {
  return Math.min(100, Math.round((context.used / context.max) * 100));
}

/** Three bands, because the question is not "how full" but "how worried".
 *  Under 75% the window is a non-issue and the gauge stays neutral; `high` is
 *  where a long turn starts being at risk; `critical` is a session about to
 *  compact, which loses fidelity — the only thing on this page you can still
 *  act on by intervening now. */
function contextLoad(context: { used: number; max: number }): 'ok' | 'high' | 'critical' {
  const pct = contextPct(context);
  if (pct >= 90) return 'critical';
  return pct >= 75 ? 'high' : 'ok';
}

/** Note: the token tally is deliberately NOT on the card. The dollars answer the
 *  question a person actually has ("what is this costing me"), and the token
 *  count is the same fact in a unit nobody budgets in — on a card this dense it
 *  was a second figure competing with the one that means something. It stays in
 *  the digest for whoever needs it. */

function clock(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** A single-unit duration, for the figures that are context rather than the
 *  anchor: uptime and silence. Never two units — nobody reads `14m 03s` of
 *  uptime, and the clock beside it is already the precise one.
 *
 *  Seconds run to 120 rather than 60 on purpose. This is the unit that spells
 *  out the accent flatline on a blocked lane, and it rounds DOWN: cutting over
 *  at a minute reported a 119-second wait as `1m`, understating the one figure on
 *  the page that says how long you have been the bottleneck. `95s` reads fine;
 *  past two minutes the minute is the honest grain. */
function span(ms: number | null): string {
  if (ms === null || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 120) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, '0')}`;
}

/** The project a cwd belongs to. Exact match first, then the longest known
 *  project the cwd sits inside — a session started in `packages/api` of a
 *  monorepo belongs to the repo, not to nothing. */
function projectForCwd(cwd: string | null, projects: Project[]): Project | null {
  if (!cwd) return null;
  let best: Project | null = null;
  for (const p of projects) {
    if (p.realPath === cwd) return p;
    if (cwd.startsWith(p.realPath + '/') && (!best || p.realPath.length > best.realPath.length)) {
      best = p;
    }
  }
  return best;
}

/** Where in the project this process was started, printed only when that adds
 *  something. The lane's title is already the project, so a cwd equal to the
 *  project root would repeat it; a cwd BELOW the root is the case the title
 *  cannot show — `projectForCwd` deliberately maps a monorepo subdirectory to
 *  the repo, so without this two lanes of one repo look like the same shell. A
 *  cwd in no known project keeps its full path: there the title is only its
 *  basename, so the rest is the only thing that locates it. */
function cwdNote(cwd: string | null, project: Project | null): string | null {
  if (!cwd) return null;
  if (!project) return cwd;
  if (cwd === project.realPath) return null;
  return './' + cwd.slice(project.realPath.length + 1);
}

/** What a session is doing, from the tail digest. Never invents a state: a
 *  session whose transcript has told us nothing yet says so. */
function doingOf(activity: SessionActivity | undefined, status: string): string {
  if (activity?.lastTool) return activity.lastTool.arg || 'running';
  switch (activity?.activity) {
    case 'thinking':
      return 'thinking';
    case 'busy':
      return 'working';
    case 'idle':
      // The registry is the faster authority on whether the turn is over: it
      // stays `busy` while an async sub-agent runs, where the transcript has
      // already written `end_turn`. Saying "waiting for your next prompt" there
      // told the user to type at a session that was working.
      return status === 'busy' ? 'working' : 'waiting for your next prompt';
    default:
      return status === 'busy' ? 'starting up' : 'no activity yet';
  }
}

/** What tells two sessions of one project apart: the title Claude wrote for the
 *  conversation. The pid is not carried inside it — a title long enough to need
 *  the CSS ellipsis cut it off the end, losing the one part that could not be
 *  guessed — but it is not dropped either: it has its own field in the machine
 *  row below, where nothing truncates it and it is what you need to `kill`. The
 *  untruncated title lives in the tooltip.
 *
 *  Which is also why the missing-title fallback is no longer the pid: with the
 *  pid a permanent field, printing it here too said the same thing twice on
 *  every session Claude has not named yet. The honest fallback is the absence. */
const UNNAMED = 'not named yet';
function identOf(title: string | null | undefined): string {
  return title?.trim() || UNNAMED;
}

/** The agents a session is waiting on, named by their `subagent_type`. */
function delegateLabel(delegates: SessionActivity['delegates']): string {
  const [first, ...rest] = delegates;
  if (!first) return '';
  return rest.length ? `${first.name} +${rest.length}` : first.name;
}

/**
 * `ready` — alive, turn finished, your move. It is a claim about BOTH sources,
 * because each one is blind to a different case:
 *
 *  - the registry is the fast authority on a turn being over, and it is the ONLY
 *    one that knows a session is still working when its transcript has gone
 *    quiet (an async dispatch writes `end_turn` and then nothing for minutes);
 *  - the tail is the only one that knows a turn ended when the registry has not
 *    been rewritten since — `updatedAt` is not a heartbeat.
 *
 * `unknown` is a registry file written before its first status: observed on a
 * brand-new session, and reading it as "working" put a card that had never done
 * anything above the sessions that were actually running.
 */
function isReady(activity: SessionActivity | undefined, status: string): boolean {
  if (status === 'busy' || status === 'waiting') return false;
  return activity?.activity === 'idle' || status === 'idle' || status === 'unknown';
}

function countsOf(activity: SessionActivity | undefined): string {
  if (!activity?.toolCount) return '';
  const tools = `${activity.toolCount} ${activity.toolCount === 1 ? 'tool' : 'tools'}`;
  return activity.errorCount > 0 ? `${tools} · ${activity.errorCount} failed` : tools;
}

function sessionCards(
  sessions: ActiveSession[],
  activityById: Map<string, SessionActivity>,
  projects: Project[],
  onOpenSession: (project: Project, sessionId: string) => void
): Card[] {
  return sessions.map(s => {
    const activity = activityById.get(s.sessionId);
    const project = projectForCwd(s.cwd, projects);
    const blocked = s.status === 'waiting';
    const delegates = activity?.delegates ?? [];
    // A dispatch this session has not seen finish, with no tool of its own in
    // flight: the sub-agent is then the only thing that explains the silence,
    // and the only work the tail cannot see (it runs in a sidecar transcript).
    // With a tool in flight the session's own action wins — it is more current.
    const delegating = delegates.length > 0 && !activity?.lastTool;
    const sub = cwdNote(s.cwd, project);
    return {
      key: `session:${s.pid}:${s.sessionId}`,
      state: blocked
        ? 'blocked'
        : !delegates.length && isReady(activity, s.status)
          ? 'ready'
          : 'working',
      title: projectDisplayName(s.cwd),
      // What distinguishes two sessions of ONE project: the title Claude wrote
      // for the conversation. The CLI's derived registry `name` stays dropped —
      // it is the project plus two random characters, so beside the project it
      // said nothing. With three sessions of the same project on screen, three
      // cards read `ClaudeLens · pid 63833` and a user reported on the wrong one.
      ident: identOf(activity?.title),
      machine: [
        `pid ${s.pid}`,
        activity?.model ? fmtModel(activity.model) : null,
        s.startedAt ? `up ${span(Date.now() - s.startedAt)}` : null,
        sub,
      ].filter((f): f is string => !!f),
      doing: blocked
        ? s.waitingFor || 'a prompt in the terminal'
        : delegating
          ? delegates.length > 1
            ? 'sub-agents running'
            : 'sub-agent running'
          : doingOf(activity, s.status),
      // The agent's name takes the slot the tool name has: while a sub-agent
      // runs it IS what this process is up to. Deliberately no tool tally for
      // it — those calls belong to the sub-agent, not to this session.
      tool: blocked
        ? null
        : delegating
          ? delegateLabel(delegates)
          : (activity?.lastTool?.name ?? null),
      // One meaning in every state: how long it has been IN this state. The
      // registry stamps the transition into it, which is the only source that
      // answers that — the tail's last-append stamp was measuring the SILENCE
      // since the last action, so a working card's clock reset at every tool and
      // never answered "is this turn taking too long?". Silence is what the
      // tape shows and what the vitals row spells out. Fallbacks cover a
      // registry entry written before its first transition.
      since: s.statusUpdatedAt ?? s.updatedAt ?? activity?.lastActivityAt ?? s.startedAt ?? null,
      counts: countsOf(activity),
      lastAppendAt: activity?.lastActivityAt ?? null,
      delegateSince: delegating ? delegates[0].at : null,
      context: activity?.context ?? null,
      spend: activity?.spend ?? null,
      spendEstimated: activity?.spendEstimated ?? false,
      tokens: activity?.tokens ?? 0,
      trace: activity?.recent ?? [],
      noTrace: false,
      routeNote: null,
      onOpen: project && s.sessionId ? () => onOpenSession(project, s.sessionId) : null,
    };
  });
}

/** Sessions the registry dropped, kept briefly by the tail module. */
function endedCards(
  ended: SessionActivity[],
  projects: Project[],
  onOpenSession: (project: Project, sessionId: string) => void
): Card[] {
  return ended.map(a => {
    const project = projectForCwd(a.cwd, projects);
    return {
      key: `ended:${a.sessionId}`,
      state: 'ended',
      title: a.cwd ? projectDisplayName(a.cwd) : 'Unknown project',
      ident: identOf(a.title),
      machine: [
        `session ${a.sessionId.slice(0, 8)}`,
        a.model ? fmtModel(a.model) : null,
        cwdNote(a.cwd, project),
      ].filter((f): f is string => !!f),
      doing: a.errorCount > 0 ? `finished with ${a.errorCount} failed` : 'finished',
      tool: null,
      since: a.endedAt,
      counts: countsOf(a),
      lastAppendAt: a.lastActivityAt,
      delegateSince: null,
      // A finished session's last reading is still the truth about it: what it
      // ended up costing, and how full it got.
      context: a.context,
      spend: a.spend,
      spendEstimated: a.spendEstimated,
      tokens: a.tokens,
      trace: a.recent,
      noTrace: false,
      routeNote: null,
      onOpen: project ? () => onOpenSession(project, a.sessionId) : null,
    };
  });
}

/** Background agents that are actually running. The roster's finished and
 *  sleeping workers are Agent View's business, not the Monitor's. */
function agentCards(agents: BgSession[], onOpenAgents: () => void): Card[] {
  return agents
    .filter(a => a.alive)
    .map(a => {
      const blocked = !!a.hasPendingQuestion || !!a.needs || a.state === 'blocked';
      const started = Date.parse(a.createdAt);
      return {
        key: `agent:${a.id}`,
        state: (blocked ? 'blocked' : 'working') as State,
        title: a.projectName || projectDisplayName(a.cwd),
        ident: `agent ${a.name || a.id}`,
        machine: [
          a.pid ? `pid ${a.pid}` : null,
          Number.isFinite(started) ? `up ${span(Date.now() - started)}` : null,
          a.template ? `${a.template} worker` : null,
        ].filter((f): f is string => !!f),
        doing: blocked ? a.needs || 'a question' : a.detail || a.intent || 'running',
        tool: null,
        since: Date.parse(a.updatedAt) || null,
        counts: a.inFlightTasks > 0 ? `${a.inFlightTasks} in flight` : '',
        lastAppendAt: null,
        delegateSince: null,
        // The roster carries neither usage nor a bill, and the sidecar transcript
        // it writes is not this page's to read. Absent, not zero: `$0.00` on a
        // worker burning tokens would be the one wrong figure on the board.
        context: null,
        spend: null,
        spendEstimated: false,
        tokens: 0,
        // The roster carries no transcript stamps, so an agent has no strip.
        trace: [],
        noTrace: true,
        // Routing, not acting: stop, respawn and attach live in Agent View.
        routeNote: 'open in Agent View ↗',
        onOpen: onOpenAgents,
      };
    });
}

/** A clock the page re-reads once a second — only while it has something to
 *  count, so an empty Monitor is not a page that re-renders forever in the
 *  background. An ended card counts too: its figure is "how long ago". */
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** The header's one sentence, and the only thing on this page that is about the
 *  whole machine rather than one process. Deliberately prose with figures in it
 *  rather than a band of stat tiles: the tiles were removed once already because
 *  they printed the same numbers the cards carry, and the count that matters is
 *  the one asking for something — so that clause leads, in the accent. */
function census(blocked: number, working: number, ready: number, ended: number): ReactNode {
  const parts: { key: string; node: ReactNode }[] = [];
  if (blocked)
    parts.push({
      key: 'blocked',
      node: (
        <span className="alert">
          <b>{blocked}</b> waiting on you
        </span>
      ),
    });
  if (working)
    parts.push({
      key: 'working',
      node: (
        <span>
          <b>{working}</b> working
        </span>
      ),
    });
  if (ready)
    parts.push({
      key: 'ready',
      node: (
        <span>
          <b>{ready}</b> ready for a prompt
        </span>
      ),
    });
  if (!parts.length && ended)
    parts.push({
      key: 'ended',
      node: (
        <span>
          <b>{ended}</b> just ended
        </span>
      ),
    });
  if (!parts.length) return <span className="hush">Nothing is running</span>;
  return parts.map((p, i) => (
    <span key={p.key}>
      {/* A plain space: a sentence of three clauses has to be allowed to wrap
          after a comma, which is exactly where a non-breaking one would not. */}
      {i > 0 && <i className="sep">{', '}</i>}
      {p.node}
    </span>
  ));
}

export function MonitorView({
  onBack,
  onOpenSession,
  onOpenAgents,
  embedded = false,
}: {
  onBack: () => void;
  onOpenSession: (project: Project, sessionId: string) => void;
  onOpenAgents: () => void;
  embedded?: boolean;
}) {
  const { data: sessions = [], isLoading } = useActiveSessions();
  const { data: activity = [] } = useSessionActivity();
  const { data: agents = [] } = useLiveSessions();
  const { data: allProjects = [] } = useMemoryProjects();

  const projects = useMemo(
    () => allProjects.map(p => ({ hash: p.hash, realPath: p.realPath })),
    [allProjects]
  );

  const cards = useMemo(() => {
    const activityById = new Map(activity.filter(a => !a.endedAt).map(a => [a.sessionId, a]));
    const live = new Set(sessions.map(s => s.sessionId));
    // An ended digest whose id is live again is a running card: the registry is
    // the authority on what is running.
    const gone = activity.filter(a => a.endedAt && !live.has(a.sessionId));

    return [
      ...sessionCards(sessions, activityById, projects, onOpenSession),
      ...agentCards(agents, onOpenAgents),
      ...endedCards(gone, projects, onOpenSession),
      // What needs you first, then what runs; within a state, whatever has been
      // there longest leads.
    ].sort(
      (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || (a.since ?? 0) - (b.since ?? 0)
    );
  }, [sessions, activity, agents, projects, onOpenSession, onOpenAgents]);

  const blocked = cards.filter(c => c.state === 'blocked').length;
  const working = cards.filter(c => c.state === 'working').length;
  const ready = cards.filter(c => c.state === 'ready').length;
  const ended = cards.filter(c => c.state === 'ended').length;
  const live = blocked + working + ready;
  const now = useTick(cards.length > 0);

  return (
    <div
      className={embedded ? 'flex flex-col' : 'h-full flex flex-col'}
      style={embedded ? { flexGrow: 1 } : { background: 'var(--cl-paper)' }}
    >
      {!embedded && <TopBar onBack={onBack} backLabel="Back" crumbs={[{ label: 'MONITOR' }]} />}

      <div className={embedded ? 'flex-1' : 'flex-1 overflow-y-auto'}>
        {/* The console header. It replaces the page-name hero on purpose: a
            132px word "Monitor" was ~300px of the one page whose whole subject
            is the next 90 seconds, and the reader already knows where they are.
            What earns that space is the census, which changes. */}
        <header className="cl-mxtop">
          <div className="cl-eyebrow">
            <span className={`pip${live > 0 ? ' live' : ''}`} />
            <span>Monitor · this machine</span>
          </div>
          <p className="cl-mxtop-say">{census(blocked, working, ready, ended)}</p>
        </header>

        {isLoading ? (
          <section className="cl-section">
            <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
          </section>
        ) : cards.length === 0 ? (
          <section className="cl-section">
            <div className="cl-empty">
              Nothing is running. Start a session in a terminal, or dispatch a background agent —
              both show up here.
            </div>
          </section>
        ) : (
          <section className="cl-section">
            <div className="cl-mx-grid">
              {cards.map(card => (
                <ProcessCard key={card.key} card={card} now={now} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * One live process, as an index card.
 *
 * The form is the memory index card (`.cl-mcard`) rather than a dark instrument
 * lane, and the reason is the same one that made two earlier attempts read as
 * bare: a wide dark band holding five short strings is mostly empty by
 * construction, and on this app's warm paper it also reads as a foreign object.
 *
 * The card's ANATOMY IS FIXED, and that is the fourth form. Letting the body be
 * the tape made every card a different height — a session that had run six tools
 * stood a third taller than one that had run none — so a rack of them had no
 * baseline to read across and the ragged bottom edge was the first thing the eye
 * had to parse. Now every card is the same five blocks at the same height: state
 * and clock, who, the NOW line, a three-row slot, vitals. What varies is what is
 * printed IN them, never where they are: the slot is drawn whether or not there
 * is anything to put in it (empty rows stay ruled), and a busier session says so
 * with `+3` on its last row rather than by growing. The cost is honest — a few
 * ruled millimetres on a quiet card — and it buys a grid you can scan by column:
 * every clock, every gauge, every bill at the same height on the page.
 *
 * The one bold thing on the page is the border: only the card that wants
 * something from you has a heavy edge. Everything else is hairlines.
 */
function ProcessCard({ card, now }: { card: Card; now: number }) {
  const elapsed = card.since === null ? null : Math.max(0, now - card.since);
  // The in-flight call is already printed as the NOW line, and the newest mark
  // IS that call: without this the card would show the same action twice.
  const tape = buildTape(card.trace, now, { dropNewest: !!card.tool });
  // The slot prints the newest rows and says how many it is not printing. A
  // card that quietly showed three of eleven actions would read as a calm
  // session; `+8` is the difference between a summary and a lie by omission.
  const rows = tape.slice(0, TAPE_ROWS);
  const more = tape.length - rows.length;
  // Whatever the slot has left over stays ruled. An agent's note takes one of
  // those lines, since "there is no transcript" is not the same claim as "it did
  // nothing" and only one of the two can be fixed by waiting.
  const rules = TAPE_ROWS - rows.length - (card.noTrace ? 1 : 0);
  const open = card.onOpen;

  // What the silence since the last action means. A running sub-agent takes the
  // slot: it is the explanation, and the one thing the tail cannot see for
  // itself. Below the floor nothing is said — a gap of two seconds between two
  // tool calls is not a signal.
  const quiet = card.routeNote
    ? card.routeNote
    : card.delegateSince !== null
      ? `${span(now - card.delegateSince)} in flight`
      : card.lastAppendAt !== null && now - card.lastAppendAt >= QUIET_FLOOR_MS
        ? `quiet ${span(now - card.lastAppendAt)}`
        : '';

  return (
    <article
      className="cl-mx"
      data-state={card.state}
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      onClick={() => open?.()}
      onKeyDown={e => {
        if (open && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="cl-mx-head">
        <span className="tag">
          <i aria-hidden />
          {STATE_LABEL[card.state]}
        </span>
        {/* The clock is the card's one large figure and answers one question in
            every state: how long it has been in THIS state. */}
        <span
          className="clk"
          title={
            card.state === 'ended' ? 'How long ago it ended' : 'How long it has been in this state'
          }
        >
          {clock(elapsed)}
          {card.state === 'ended' && <i className="ago">ago</i>}
        </span>
      </div>

      <div className="cl-mx-who">
        <h3>{card.title}</h3>
        {/* A conversation title is a sentence, so the line will often clip it:
            the tooltip keeps the whole of it one hover away. */}
        <span className={card.ident === UNNAMED ? 'ident is-unnamed' : 'ident'} title={card.ident}>
          {card.ident}
        </span>
        <span className="machine">
          {card.machine.map((f, i) => (
            <span key={f}>
              {i > 0 && <i className="sep">·</i>}
              {f}
            </span>
          ))}
        </span>
      </div>

      {/* NOW — what the session is doing this second, and the only line on the
          card that is not history. It has its own inset block rather than being
          the tape's first row: what a process is doing right now is a different
          kind of claim from what it did, and the row it used to sit in made the
          two look like one list. */}
      <div className="cl-mx-now">
        <i className="dot" style={{ background: toolTint(card.tool) }} aria-hidden />
        {card.tool && <b>{card.tool}</b>}
        <span className="arg">{card.doing}</span>
      </div>

      {/* The slot: three rows, always. What it did, newest first, each with the
          subject it acted on. Rows with nothing to say stay ruled — the card is
          the same height either way, which is the point of the form. */}
      <ol className="cl-mx-slot">
        {card.noTrace && <li className="none">no transcript to tail</li>}
        {rows.map((step, i) => (
          <li key={`${step.at}-${i}`} className={step.failed ? 'failed' : undefined}>
            <span className="when">{span(now - step.at) || 'now'}</span>
            <i className="dot" style={{ background: toolTint(step.tool) }} aria-hidden />
            <b>{step.tool}</b>
            <span className="arg">{step.arg}</span>
            <span className="mark">
              {step.count > 1 && <i className="times">×{step.count}</i>}
              {step.failed && (
                <i className="x" title="This call came back an error">
                  ✕
                </i>
              )}
              {i === rows.length - 1 && more > 0 && (
                <i className="more" title={`${more} more in the last ${TAPE_MINUTES} min`}>
                  +{more}
                </i>
              )}
            </span>
          </li>
        ))}
        {Array.from({ length: Math.max(0, rules) }, (_, i) => (
          <li key={`rule-${i}`} className="rule" aria-hidden>
            <i />
          </li>
        ))}
      </ol>

      {/* Vitals. The context is the only measure here with a real denominator, so
          it is the only one drawn as a gauge; spend has no ceiling and stays a
          figure — a bar against an invented ceiling would be decoration
          pretending to be a measurement. */}
      <div className="cl-mx-vitals">
        {card.context ? (
          // No `ctx` label on the gauge: a bar with a percentage beside it says
          // what it is, and on a card this narrow those three characters were
          // taken from the figures that do need their unit spelled out.
          <span
            className="ctx"
            data-load={contextLoad(card.context)}
            title={`Context window: ${fmt(card.context.used)} of ${fmt(card.context.max)} tokens`}
          >
            <span className="bar">
              <i style={{ width: `${contextPct(card.context)}%` }} />
            </span>
            <span className="v">{contextPct(card.context)}%</span>
          </span>
        ) : (
          // The label survives here: a lone dash names nothing.
          <span className="ctx is-none">
            <span className="k">ctx</span>
            <span className="v">—</span>
          </span>
        )}
        {card.spend !== null && (
          <span className="money" title={card.spendEstimated ? ESTIMATE_NOTE : undefined}>
            {card.spendEstimated && '~'}
            {fmtCost(card.spend)}
          </span>
        )}
        {quiet && <span className="quiet">{quiet}</span>}
        {card.counts && <span className="vol">{card.counts}</span>}
      </div>
    </article>
  );
}
