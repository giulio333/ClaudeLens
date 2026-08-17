import { useEffect, useMemo, useState } from 'react';
import {
  useActiveSessions,
  useSessionActivity,
  useLiveSessions,
  useMemoryProjects,
} from '../../../hooks/useIPC';
import type { ActiveSession, SessionActivity, BgSession, TraceMark } from '../../../types';
import { Lens } from '../overview/Lens';
import { TopBar } from '../shared/TopBar';
import { fmtModel } from '../utils';
import { projectDisplayName } from '../shared/projectName';
import { buildTrace, lastLoudBucket } from './trace';

// The Monitor: every Claude process running on this machine, as a rack of
// instruments.
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
// ── The pulse strip ──────────────────────────────────────────────────────────
// The signature of this page, and the reason it is worth having: a session's
// STATE ("busy") is nearly useless on its own, because a session mid-tool and a
// session hung look identical from the registry. Its RHYTHM is what separates
// them, so each card draws the last 90 seconds of its own transcript — one mark
// per action, right edge is now.
//
// The device that makes the page readable in one glance: on a session waiting
// for you, the silence since it stopped is drawn IN THE ACCENT and grows in
// front of you. The information and the graphic are the same object — a long
// terracotta flatline is literally how long you have been the bottleneck.

type Project = { hash: string; realPath: string };

// `ready` is a session that is alive but has finished its turn — observed, not
// guessed. Worth its own state because "alive" and "working" are not the same
// claim, and a rack that calls every live session WORKING is lying about most of
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
  /** What it is doing, or what it is waiting on. */
  doing: string;
  /** The tool name, printed ahead of `doing` at full strength. */
  tool: string | null;
  model: string | null;
  /** Epoch ms the state clock counts from; null when unknown. */
  since: number | null;
  counts: string;
  trace: TraceMark[];
  onOpen: (() => void) | null;
}

const STATE_ORDER: Record<State, number> = { blocked: 0, working: 1, ready: 2, ended: 3 };
const STATE_LABEL: Record<State, string> = {
  blocked: 'NEEDS YOU',
  working: 'WORKING',
  ready: 'READY',
  ended: 'ENDED',
};

function clock(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function shortAge(ms: number | null): string {
  if (ms === null || ms < 0) return '';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
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
 *  conversation. The pid is only the fallback for a session not named yet —
 *  carried as a permanent suffix it was noise on every card, and a title long
 *  enough to need the CSS ellipsis cut the pid off the end anyway, losing the
 *  one part that could not be guessed. The untruncated line lives in the
 *  tooltip. */
function identOf(title: string | null | undefined, pid: number): string {
  return title?.trim() || `pid ${pid}`;
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
      // said nothing — and the pid is now only the fallback for a session not
      // named yet. With three sessions of the same project on screen, three
      // cards read `ClaudeLens · pid 63833` and a user reported on the wrong one.
      ident: identOf(activity?.title, s.pid),
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
      model: activity?.model ?? null,
      // One meaning in every state: how long it has been IN this state. The
      // registry stamps the transition into it, which is the only source that
      // answers that — the tail's last-append stamp was measuring the SILENCE
      // since the last action, so a working card's clock reset at every tool and
      // never answered "is this turn taking too long?". Silence is what the
      // pulse strip draws; making the clock say it too spent the card's biggest
      // number on a duplicate. Fallbacks cover a registry entry written before
      // its first transition.
      since: s.statusUpdatedAt ?? s.updatedAt ?? activity?.lastActivityAt ?? s.startedAt ?? null,
      counts: countsOf(activity),
      trace: activity?.recent ?? [],
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
      ident: a.sessionId.slice(0, 8),
      doing: a.errorCount > 0 ? `finished with ${a.errorCount} failed` : 'finished',
      tool: null,
      model: a.model,
      since: a.endedAt,
      counts: countsOf(a),
      trace: a.recent,
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
      return {
        key: `agent:${a.id}`,
        state: (blocked ? 'blocked' : 'working') as State,
        title: a.projectName || projectDisplayName(a.cwd),
        ident: `agent ${a.name || a.id}`,
        doing: blocked ? a.needs || 'a question' : a.detail || a.intent || 'running',
        tool: null,
        model: null,
        since: Date.parse(a.updatedAt) || null,
        counts: a.inFlightTasks > 0 ? `${a.inFlightTasks} in flight` : '',
        // The roster carries no transcript stamps, so an agent has no strip.
        trace: [],
        // Routing, not acting: stop, respawn and attach live in Agent View.
        onOpen: onOpenAgents,
      };
    });
}

/** A clock the rack re-reads once a second — only while something is live, so
 *  an idle Monitor is not a page that re-renders forever in the background. */
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
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
  const live = blocked + working + ready;
  const now = useTick(live > 0);

  return (
    <div
      className={embedded ? 'flex flex-col' : 'h-full flex flex-col'}
      style={embedded ? { flexGrow: 1 } : { background: 'var(--cl-paper)' }}
    >
      {!embedded && <TopBar onBack={onBack} backLabel="Back" crumbs={[{ label: 'MONITOR' }]} />}

      <div className={embedded ? 'flex-1' : 'flex-1 overflow-y-auto'}>
        <section className={`cl-hero${live > 0 ? ' is-live' : ''}`}>
          {live > 0 && <span className="cl-live-bar" aria-hidden />}
          <Lens />
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>Global · running processes</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Monitor</span>
            <span className="glyph">.</span>
          </h1>
          <div className="cl-h-meta">
            <span>
              <b>{live}</b> live
            </span>
            {working > 0 && (
              <>
                <span className="sep">·</span>
                <span>
                  <b>{working}</b> working
                </span>
              </>
            )}
            {blocked > 0 && (
              <>
                <span className="sep">·</span>
                <span className="cl-mx-alert">
                  <b>{blocked}</b> waiting on you
                </span>
              </>
            )}
          </div>
        </section>

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
            <div className="cl-mx-rack">
              {cards.map(card => (
                <ProcessCard key={card.key} card={card} now={now} />
              ))}
            </div>
            <div className="cl-mx-legend">
              <span>
                <i className="k working" /> working
              </span>
              <span>
                <i className="k blocked" /> waiting on you
              </span>
              <span>
                <i className="k ready" /> ready
              </span>
              <span>
                <i className="k ended" /> ended
              </span>
              <span className="rule" aria-hidden />
              <span className="how">
                each strip is the last 90 seconds of that transcript — flat means silence
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ProcessCard({ card, now }: { card: Card; now: number }) {
  const elapsed = card.since === null ? null : Math.max(0, now - card.since);
  const bars = buildTrace(card.trace, now);
  // Where the silence starts: everything after the last mark. On a blocked card
  // that run is drawn in the accent, so the wait is the graphic.
  const lastLoud = lastLoudBucket(bars);
  const open = card.onOpen;

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
        <div className="who">
          <h3>{card.title}</h3>
          {/* A conversation title is a sentence, so the row will often clip it:
              the tooltip keeps the whole of it one hover away. */}
          <span className="ident" title={card.ident}>
            {card.ident}
            {card.model ? ` · ${fmtModel(card.model)}` : ''}
          </span>
        </div>
        <div className="when">
          <span className="clk">{clock(elapsed)}</span>
          <span className="tag">
            <i aria-hidden />
            {STATE_LABEL[card.state]}
          </span>
        </div>
      </div>

      <div
        className="cl-mx-trace"
        aria-hidden
        title={card.trace.length ? undefined : 'No transcript activity in the last 90 seconds'}
      >
        {bars.map((bar, i) => (
          <i
            key={i}
            className={bar.quiet ? (i > lastLoud ? 'q since' : 'q') : bar.failed ? 'b failed' : 'b'}
            style={bar.quiet ? undefined : { height: `${Math.max(12, bar.h * 100)}%` }}
          />
        ))}
      </div>

      <div className="cl-mx-doing">
        <span className="caret" aria-hidden>
          ❯
        </span>
        {card.tool && <b>{card.tool}</b>}
        <span className="arg">{card.doing}</span>
      </div>

      <div className="cl-mx-foot">
        <span>{card.counts || '—'}</span>
        <span className="ago">
          {card.state === 'ended' ? `ended ${shortAge(elapsed)} ago` : 'in this state'}
        </span>
      </div>
    </article>
  );
}
