import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  useActiveSessions,
  useSessionActivity,
  useLiveSessions,
  useMemoryProjects,
} from '../../../hooks/useIPC';
import type { ActiveSession, SessionActivity, BgSession, TraceMark } from '../../../types';
import { TopBar } from '../shared/TopBar';
import { fmt, fmtCost, fmtModel, formatTokens } from '../utils';
import { projectDisplayName } from '../shared/projectName';
import { TOOL_TINT } from '../chat/utils';
import { buildRibbon, RIBBON_WINDOW } from './trace';

// The Monitor: every Claude process running on this machine — what is blocked on
// you as a band, everything else as one cell of a hairline grid.
//
// Deliberately NOT a second Agent View. That page is a ROSTER — everything you
// dispatched, most of it finished or asleep, with the controls to act on it.
// This one is machine state: what has a pid right now, across every project. A
// background agent that is actually running shows up here too (it is a claude
// process burning tokens), but as a cell that ROUTES to Agent View — the
// dispatch/stop/respawn controls stay in one place.
//
// Two sources, joined by sessionId: the registry says a session is busy or
// waiting (`useActiveSessions`), the transcript tail says at what
// (`useSessionActivity`). Neither is derived from the other.
//
// ── Why a band and a grid, and not a rack of cards ───────────────────────────
// Two earlier forms were rejected as bare: a grid of dark cards, then a dark
// board of full-width lanes. Both failed for the same structural reason — a wide
// dark surface holding five short strings is mostly empty by construction, and
// on this app's warm paper a black slab also reads as a foreign object. Nothing
// about a process makes it a terminal; that analogy was borrowed, and it cost
// the page twice.
//
// The third form put every process on an identical index card. It fixed the
// ragged rack, but it also said that a session waiting on YOU and a session
// quietly editing a file are the same size of news — which is the one thing this
// page exists to deny. So the fourth form (design handoff *Monitor Variants*,
// option 2b) tiers by state instead of by uniformity:
//
//   - whatever is BLOCKED becomes a full-bleed dark band, edge to edge, with the
//     question it is waiting on set at display size and the clock counting how
//     long you have been the bottleneck. It is the only dark surface on the page
//     and the only one that pulses;
//   - everything else is a hairline grid with NO card borders at all: three
//     columns divided by rules, the same anatomy in each cell, nothing raised.
//
// The construction carries the triage, so no cell has to shout to be read in
// order. What a session is doing right now stays in words (the NOW line); what
// it did compresses into the RIBBON — runs of tool-tinted blocks on a 2.5-minute
// axis (`trace.ts`). A lane whose right-hand end is empty is a session that has
// done nothing for that long, which is the "is this hung?" question the three
// printed rows used to answer in prose and the strip answers in shape.

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
  /** How full the window is. The one measure here with a real denominator, and
   *  therefore the only one drawn as a gauge. */
  context: { used: number; max: number } | null;
  /** Dollars, and whether the price had to be estimated. */
  spend: number | null;
  spendEstimated: boolean;
  tokens: number;
  trace: TraceMark[];
  /** A background agent has no transcript of its own to tail, so it has no
   *  ribbon. Saying so beats drawing an empty lane. */
  noTrace: boolean;
  /** Printed where the silence figure goes, for a cell that only routes. */
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

const ESTIMATE_NOTE =
  'Approximate: this model has no exact entry in the pricing table, so it is priced by family.';

/** The dot that opens a tape row. It carries `TOOL_TINT` — the transcript's own
 *  tool encoding, reused verbatim now that the page is on paper and needs no
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

/** Note: the token tally is deliberately NOT on a cell. The dollars answer the
 *  question a person actually has ("what is this costing me"), and the token
 *  count is the same fact in a unit nobody budgets in — in a cell this dense it
 *  was a second figure competing with the one that means something. It survives
 *  once, as a machine-wide total in the header, where it is a different claim. */

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

  // The two tiers of the page. Blocked is not "the first card": it is a
  // different surface, so the split happens here rather than inside a loop.
  const bands = cards.filter(c => c.state === 'blocked');
  const cells = cards.filter(c => c.state !== 'blocked');

  const blocked = bands.length;
  const working = cards.filter(c => c.state === 'working').length;
  const ready = cards.filter(c => c.state === 'ready').length;
  const ended = cards.filter(c => c.state === 'ended').length;
  const live = blocked + working + ready;
  const now = useTick(cards.length > 0);
  const totals = machineTotals(cards);

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
          <div className="cl-mxtop-say-wrap">
            <div className="cl-eyebrow">
              <span className={`pip${live > 0 ? ' live' : ''}`} />
              <span>Monitor · this machine</span>
            </div>
            <p className="cl-mxtop-say">{census(blocked, working, ready, ended)}</p>
          </div>
          {/* The one figure the cells do not carry: what the whole machine is
              burning. A per-cell token count was dropped as a unit nobody
              budgets in, but summed over every live process it stops being a
              second copy of the bill and becomes the only reading of scale on
              the page. */}
          {totals && <span className="cl-mxtop-tot">{totals}</span>}
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
          <>
            {bands.map(card => (
              <BlockedBand key={card.key} card={card} now={now} />
            ))}
            {cells.length > 0 && (
              <div className="cl-mx-grid">
                {cells.map(card => (
                  <ProcessCell key={card.key} card={card} now={now} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** What the silence since the last action means. A running sub-agent takes the
 *  slot: it is the explanation, and the one thing the tail cannot see for
 *  itself. Below the floor nothing is said — a gap of two seconds between two
 *  tool calls is not a signal. */
function quietNote(card: Card, now: number): string {
  if (card.routeNote) return card.routeNote;
  if (card.delegateSince !== null) return `${span(now - card.delegateSince)} in flight`;
  if (card.lastAppendAt !== null && now - card.lastAppendAt >= QUIET_FLOOR_MS) {
    return `quiet ${span(now - card.lastAppendAt)}`;
  }
  return '';
}

/** The header's right-hand figure: what every live process on this machine has
 *  cost and burned, together. Both halves are omitted when nothing has reported
 *  them — a `$0.00 · 0 tokens` beside a rack of running sessions would be the
 *  one wrong reading on the page, for the same reason a background agent's
 *  vitals stay blank.
 *
 *  Ended sessions are left out even though their cells are still on screen: the
 *  header says what this machine is doing, and a session that finished is not
 *  burning anything. Its own final figures stay on its cell, where they are a
 *  claim about it rather than about the machine. */
function machineTotals(all: Card[]): string | null {
  const cards = all.filter(c => c.state !== 'ended');
  const parts: string[] = [];
  if (cards.some(c => c.spend !== null)) {
    parts.push(fmtCost(cards.reduce((sum, c) => sum + (c.spend ?? 0), 0)));
  }
  const tokens = cards.reduce((sum, c) => sum + c.tokens, 0);
  if (tokens > 0) {
    const { value, unit } = formatTokens(tokens);
    parts.push(`${value}${unit} tokens`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** The tool-tinted lane of what a session did in the last couple of minutes, or
 *  the one sentence that says why there is no lane to draw. Shared shape between
 *  the band and a cell: the ribbon is the same claim at both sizes, and only its
 *  height differs. */
function Ribbon({ card, now }: { card: Card; now: number }) {
  const runs = buildRibbon(card.trace, now);
  if (card.noTrace) {
    return (
      <div className="cl-mx-ribbon">
        <span className="none">no transcript to tail</span>
      </div>
    );
  }
  return (
    <div className="cl-mx-ribbon" title={`Tool calls in the last ${RIBBON_WINDOW}`}>
      {runs.map(run => (
        <i
          key={`${run.tool}-${run.left}`}
          className={run.failed ? 'failed' : undefined}
          style={{
            left: `${run.left}%`,
            width: `${run.width}%`,
            background: run.failed ? 'var(--cl-danger)' : toolTint(run.tool),
          }}
          title={run.failed ? `${run.tool} — came back an error` : run.tool}
        />
      ))}
      {runs.length === 0 && <span className="none">nothing in the last {RIBBON_WINDOW}</span>}
    </div>
  );
}

/** The vitals row, identical in the band and in a cell: the context gauge, the
 *  bill, the silence and the tally. The context is the only measure here with a
 *  real denominator, so it is the only one drawn as a gauge; spend has no
 *  ceiling and stays a figure — a bar against an invented ceiling would be
 *  decoration pretending to be a measurement. */
function Vitals({ card, quiet }: { card: Card; quiet: string }) {
  return (
    <div className="cl-mx-vitals">
      {card.context ? (
        // No `ctx` label on the gauge: a bar with a percentage beside it says
        // what it is, and in a cell this narrow those three characters were
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
  );
}

/**
 * A process that is blocked on you, as a full-bleed dark band.
 *
 * It is the only dark surface on the page, and that is the whole argument for
 * it: two earlier forms failed by making a dark slab the DEFAULT, where a wide
 * dark band holding five short strings is mostly empty by construction. Here it
 * is the exception, it runs edge to edge, and what fills it is the one string on
 * this page long enough to earn display size — the question the session is
 * waiting on.
 *
 * What leads is therefore the QUESTION, not the project: the identity drops to
 * one mono line under it (project · title · pid · model · uptime), because you
 * already know which of your projects you are looking at by the time you read
 * what it wants. The clock is the second big figure and it counts the one thing
 * only this state can measure: how long you have been the bottleneck.
 */
function BlockedBand({ card, now }: { card: Card; now: number }) {
  const elapsed = card.since === null ? null : Math.max(0, now - card.since);
  const quiet = quietNote(card, now);
  const open = card.onOpen;

  return (
    <section className="cl-mxband" data-state={card.state}>
      <div className="cl-mxband-say">
        <div className="cl-eyebrow">
          <span className="pip" />
          <span>Needs you{quiet && ` · ${quiet}`}</span>
        </div>
        <p className="ask">{card.doing}</p>
        <div className="meta">
          <b className="proj">{card.title}</b>
          <i className="sep">·</i>
          <span className={card.ident === UNNAMED ? 'is-unnamed' : undefined}>{card.ident}</span>
          {card.machine.map(f => (
            <span key={f}>
              <i className="sep">·</i>
              {f}
            </span>
          ))}
        </div>
        <Ribbon card={card} now={now} />
        <Vitals card={card} quiet="" />
      </div>

      <div className="cl-mxband-act">
        <div className="clk">{clock(elapsed)}</div>
        <div className="lbl">blocked for</div>
        {open && (
          // Deliberately not "Reply in terminal": the prompt is waiting in the
          // user's own shell and nothing here can answer it. The button says
          // what it does — open this session in ClaudeLens.
          <button type="button" onClick={open}>
            {card.routeNote ? 'Open in Agent View ↗' : 'Open session ↗'}
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Every other live process, as one cell of a hairline grid.
 *
 * NO BORDER, NO RADIUS, NO SURFACE: a cell is defined by the rules between it
 * and its neighbours, which is what lets the band above be the only raised thing
 * on the page. The anatomy stays fixed across cells — state and clock, who, the
 * NOW line, the ribbon, vitals — so the grid can be scanned by column: every
 * clock, every gauge, every bill on the same line of the page.
 */
function ProcessCell({ card, now }: { card: Card; now: number }) {
  const elapsed = card.since === null ? null : Math.max(0, now - card.since);
  const quiet = quietNote(card, now);
  const open = card.onOpen;

  return (
    <article
      className="cl-mxcell"
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
        <div className="cl-mx-who">
          <span className="tag">
            <i aria-hidden />
            {STATE_LABEL[card.state]}
          </span>
          <h3>{card.title}</h3>
          {/* A conversation title is a sentence, so the line will often clip it:
              the tooltip keeps the whole of it one hover away. */}
          <span
            className={card.ident === UNNAMED ? 'ident is-unnamed' : 'ident'}
            title={card.ident}
          >
            {card.ident}
          </span>
          {/* The machine facts stay on the cell even though the design keeps
              them for the band alone: the pid is what you need to `kill`, and a
              fact that only exists in the one state you are already acting on is
              a fact you cannot use. */}
          <span className="machine">
            {card.machine.map((f, i) => (
              <span key={f}>
                {i > 0 && <i className="sep">·</i>}
                {f}
              </span>
            ))}
          </span>
        </div>
        {/* The cell's one large figure, and it answers one question in every
            state: how long it has been in THIS state. */}
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

      {/* NOW — what the session is doing this second, and the only line here
          that is not history. Its own inset block, because what a process is
          doing right now is a different kind of claim from what it did. */}
      <div className="cl-mx-now">
        <i className="dot" style={{ background: toolTint(card.tool) }} aria-hidden />
        {card.tool && <b>{card.tool}</b>}
        <span className="arg">{card.doing}</span>
      </div>

      <Ribbon card={card} now={now} />
      <Vitals card={card} quiet={quiet} />
    </article>
  );
}
