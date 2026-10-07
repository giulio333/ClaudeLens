// Which embedded terminals exist, and which one is on screen.
//
// A terminal used to live exactly as long as its view: leaving the view
// unmounted Mission Control, and the unmount killed the `claude` process. Now a
// session can be parked: its Mission Control stays mounted (hidden) in
// `TerminalHost`, so the PTY and the xterm buffer carry on while the user is
// elsewhere, in this project or another one.
//
// Navigation and instances are one state because one decides the other: every
// navigation to a terminal either finds the instance already running that
// session or starts a new one, and every navigation away drops the instance on
// screen unless it was parked first. Resolving that inside the navigation's own
// dispatch keeps the ~20 places that open a terminal unchanged, and keeps the
// reducer pure (ids come from a counter in state), so StrictMode's double call
// returns the same state twice.

import type { ActiveSession, AgentColor } from '../../../types';
import type { View } from '../types';
import type { TerminalStatus } from './terminal-theme';

export type TerminalView = Extract<View, { type: 'terminal' }>;

/** What a mounted Mission Control reports about its own terminal. */
export interface InstanceReport {
  pid: number | null;
  /** The session the CLI is writing, once the registry has said so. */
  sessionId: string | null;
  title: string | null;
  /** The session's `/color`: its title wears it wherever the session is listed. */
  color: AgentColor | null;
  /** Null while no PTY is mounted: Mission Control opened on its Lens side. */
  termStatus: TerminalStatus | null;
  /** The branch the session's latest turn ran on, from its transcript. */
  gitBranch: string | null;
}

export interface TerminalInstance {
  id: string;
  /** What the terminal was opened with. Its launch fields (project, resume id,
   *  job id) never change under a mounted pane; the navigation fields are
   *  refreshed each time the instance is reached again. */
  view: TerminalView;
  report: InstanceReport;
}

export interface NavState {
  view: View;
  instances: readonly TerminalInstance[];
  /** The instance on screen; null exactly when `view` is not a terminal. Every
   *  other instance is parked. */
  currentId: string | null;
  seq: number;
}

export type NavAction =
  | { type: 'navigate'; next: View | ((prev: View) => View) }
  | { type: 'park' }
  | { type: 'restore'; id: string }
  | { type: 'close'; id: string }
  | { type: 'closeTab'; id: string }
  | { type: 'openNew' }
  | { type: 'report'; id: string; patch: Partial<InstanceReport> };

const NO_REPORT: InstanceReport = {
  pid: null,
  sessionId: null,
  title: null,
  color: null,
  termStatus: null,
  gitBranch: null,
};

export function initNav(view: View): NavState {
  return navReducer(
    { view: { type: 'global-home' }, instances: [], currentId: null, seq: 0 },
    { type: 'navigate', next: view }
  );
}

function hasEnded(report: InstanceReport): boolean {
  return report.termStatus === 'exited' || report.termStatus === 'error';
}

/** Where Back goes from a terminal: the place it was opened from. */
export function exitViewFor(v: TerminalView): View {
  const sessions: View = { type: 'sessions', project: v.project };
  switch (v.from) {
    case 'agents-live':
      return { type: 'agents-live', project: v.project };
    case 'search':
      // Back to the results, with the query that produced them: a search is a
      // place you come back to, and re-running it from an empty field is the
      // one thing a result page must not ask.
      return { type: 'search', query: v.searchQuery ?? '' };
    case 'memory-topic':
      return v.memoryTopic ? { type: 'memory-topic', ...v.memoryTopic } : sessions;
    case 'exchange':
      // The exchange may sit in another project than the session: the entry
      // carries its own.
      return v.exchange ? { type: 'exchange', ...v.exchange } : sessions;
    default:
      return sessions;
  }
}

/** Where parking lands: Back's target when it shows the parked chips (the
 *  editorial chrome), else the project's sessions. A search page has no top bar,
 *  so a session parked onto it would drop out of sight. */
export function parkTargetFor(v: TerminalView): View {
  const back = exitViewFor(v);
  return back.type === 'sessions' || back.type === 'agents-live'
    ? back
    : { type: 'sessions', project: v.project };
}

/** The instance already running what `v` asks for, so a session is never
 *  resumed twice. A fresh terminal (no ids) matches nothing. */
export function matchInstance(
  list: readonly TerminalInstance[],
  v: TerminalView
): TerminalInstance | undefined {
  if (v.attachJobId) {
    const byJob = list.find(i => i.view.attachJobId === v.attachJobId);
    if (byJob) return byJob;
  }
  const id = v.resumeSessionId;
  if (!id) return undefined;
  return list.find(i => i.view.resumeSessionId === id || i.report.sessionId === id);
}

function withoutCurrent(s: NavState): readonly TerminalInstance[] {
  return s.currentId === null ? s.instances : s.instances.filter(i => i.id !== s.currentId);
}

/** The tabs are drawn grouped by project (`tabGroups`), so a new instance goes
 *  after the last one of its project rather than at the end: the order on
 *  screen is then the array's own, and the neighbour `closeTab` brings on
 *  screen is the tab drawn beside the one closed. Keyed on the real path — the
 *  hash of a new project is provisional and changes under a running pane. */
function insertGrouped(
  list: readonly TerminalInstance[],
  inst: TerminalInstance
): TerminalInstance[] {
  const key = inst.view.project.realPath;
  let last = -1;
  list.forEach((i, n) => {
    if (i.view.project.realPath === key) last = n;
  });
  if (last === -1) return [...list, inst];
  return [...list.slice(0, last + 1), inst, ...list.slice(last + 1)];
}

function navigate(s: NavState, next: View): NavState {
  if (next.type !== 'terminal') {
    return { ...s, view: next, instances: withoutCurrent(s), currentId: null };
  }
  const found = matchInstance(s.instances, next);
  // An ended session is no place to land: its "New session" button starts a
  // fresh `claude`, not a resume of the session asked for. Replace it.
  if (found && hasEnded(found.report)) {
    return navigate({ ...s, instances: s.instances.filter(i => i.id !== found.id) }, next);
  }
  if (found) {
    const view: TerminalView = {
      ...next,
      project: found.view.project,
      resumeSessionId: found.view.resumeSessionId,
      attachJobId: found.view.attachJobId,
    };
    return {
      ...s,
      view,
      instances: s.instances
        .filter(i => i.id === found.id || i.id !== s.currentId)
        .map(i => (i.id === found.id ? { ...i, view } : i)),
      currentId: found.id,
    };
  }
  const id = `t${s.seq + 1}`;
  return {
    view: next,
    instances: insertGrouped(withoutCurrent(s), { id, view: next, report: NO_REPORT }),
    currentId: id,
    seq: s.seq + 1,
  };
}

export function navReducer(s: NavState, a: NavAction): NavState {
  switch (a.type) {
    case 'navigate':
      return navigate(s, typeof a.next === 'function' ? a.next(s.view) : a.next);
    case 'park': {
      const current = s.instances.find(i => i.id === s.currentId);
      if (!current) return s;
      return { ...s, view: parkTargetFor(current.view), currentId: null };
    }
    case 'restore': {
      const target = s.instances.find(i => i.id === a.id);
      if (!target || a.id === s.currentId) return s;
      const current = s.instances.find(i => i.id === s.currentId);
      // The one on screen is parked in the swap, as Minimize would park it —
      // idle or Lens-only included. Only an ended one is dropped: there is
      // nothing left to come back to.
      const instances =
        current && hasEnded(current.report)
          ? s.instances.filter(i => i.id !== current.id)
          : s.instances;
      return { ...s, view: target.view, instances, currentId: target.id };
    }
    case 'close': {
      const target = s.instances.find(i => i.id === a.id);
      if (!target) return s;
      const instances = s.instances.filter(i => i.id !== a.id);
      if (a.id !== s.currentId) return { ...s, instances };
      return { ...s, view: exitViewFor(target.view), instances, currentId: null };
    }
    case 'closeTab': {
      // A tab's ✕: closing the one on screen brings its neighbour on screen,
      // as a browser does; only the last one leaves, as Back does.
      if (a.id !== s.currentId) return navReducer(s, { type: 'close', id: a.id });
      const at = s.instances.findIndex(i => i.id === a.id);
      const neighbour = s.instances[at + 1] ?? s.instances[at - 1];
      if (!neighbour) return navReducer(s, { type: 'close', id: a.id });
      const shown = navReducer(s, { type: 'restore', id: neighbour.id });
      return navReducer(shown, { type: 'close', id: a.id });
    }
    case 'openNew': {
      // `+`: a fresh `claude` in the project on screen, the current one kept
      // running — a plain navigation would drop it, and its process with it.
      const current = s.instances.find(i => i.id === s.currentId);
      if (!current) return s;
      const parked = navReducer(s, { type: 'park' });
      return navigate(parked, { type: 'terminal', project: current.view.project });
    }
    case 'report': {
      const target = s.instances.find(i => i.id === a.id);
      if (!target) return s;
      const keys = Object.keys(a.patch) as Array<keyof InstanceReport>;
      if (keys.every(k => a.patch[k] === target.report[k])) return s;
      return {
        ...s,
        instances: s.instances.map(i =>
          i.id === a.id ? { ...i, report: { ...i.report, ...a.patch } } : i
        ),
      };
    }
  }
}

/** The registry entry for an instance's process: by pid first (the PTY is the
 *  CLI itself), then by session id (a legacy Windows `claude.cmd` wraps it). */
export function registryEntryFor(
  r: InstanceReport,
  active: readonly ActiveSession[] | undefined
): ActiveSession | undefined {
  if (!active) return undefined;
  return (
    (r.pid !== null ? active.find(s => s.pid === r.pid) : undefined) ??
    (r.sessionId ? active.find(s => s.sessionId === r.sessionId) : undefined)
  );
}

/** `lens`: parked on its Lens with no terminal of its own. */
export type ChipTone = 'starting' | 'busy' | 'waiting' | 'idle' | 'lens' | 'ended';

export function chipTone(
  r: InstanceReport,
  active: readonly ActiveSession[] | undefined
): ChipTone {
  if (hasEnded(r)) return 'ended';
  if (r.termStatus === 'starting') return 'starting';
  // `status` is a free string in the registry: anything unknown reads as idle.
  // Without a terminal of its own (Lens only) the registry can still say the
  // session is working or waiting in a terminal elsewhere.
  switch (registryEntryFor(r, active)?.status) {
    case 'busy':
      return 'busy';
    case 'waiting':
      return 'waiting';
    default:
      return r.termStatus === null ? 'lens' : 'idle';
  }
}

export const TONE_LABEL: Record<ChipTone, string> = {
  starting: 'Starting',
  busy: 'Claude is working',
  waiting: 'Waiting for you',
  idle: 'Your turn',
  lens: 'Lens only, no terminal',
  ended: 'Session ended',
};

/** Claude asks the user a question — the one wait the `?` stands for. Claude
 *  Code names the dialog it waits on in the registry's `waitingFor`, from a
 *  table of its dialogs (read off 2.1.293): `input needed` for an
 *  `AskUserQuestion`, `permission prompt` for a tool's approval, `dialog open`
 *  and a few others for the rest. `input needed` is not only Claude's, though:
 *  an MCP server's input prompt, a queued elicitation and the teammate-setup
 *  choice (iTerm2 or tmux) wear it too, and nothing in the registry tells them
 *  apart — rare dialogs that ask the user something all the same. */
export function asksQuestion(waitingFor: string | null | undefined): boolean {
  return waitingFor === 'input needed';
}

/** What a session's state is called on its row, its card and its tab's label:
 *  a wait says on what, and a question says so in words. */
export function stateLabel(tone: ChipTone, entry: ActiveSession | undefined): string {
  if (tone !== 'waiting') return TONE_LABEL[tone];
  if (asksQuestion(entry?.waitingFor)) return 'Claude asks you a question';
  return entry?.waitingFor ? `${TONE_LABEL.waiting}: ${entry.waitingFor}` : TONE_LABEL.waiting;
}

/** The last segment of the instance's project path, for its tab and its row. */
export function instanceProjectName(inst: TerminalInstance): string {
  const path = inst.view.project.realPath;
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export interface TabGroup {
  /** The project's real path: what the run is keyed on. */
  key: string;
  /** The run's React key: the path and how many runs of it came before. Never
   *  a tab's id — closing a group's first tab would remount the whole group and
   *  replay every animation in it. */
  id: string;
  /** Its name, printed once before its tabs instead of on every tab. */
  project: string;
  instances: TerminalInstance[];
}

/** The tabs as runs of one project, in the order given. The reducer keeps a
 *  project's instances together, so a project is one run; a list that does not
 *  (a preview) gets two runs rather than an order of this function's own. */
export function tabGroups(list: readonly TerminalInstance[]): TabGroup[] {
  const groups: TabGroup[] = [];
  const runs = new Map<string, number>();
  for (const inst of list) {
    const key = inst.view.project.realPath;
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.instances.push(inst);
      continue;
    }
    const n = runs.get(key) ?? 0;
    runs.set(key, n + 1);
    groups.push({ key, id: `${key}#${n}`, project: instanceProjectName(inst), instances: [inst] });
  }
  return groups;
}

export function instanceTitle(inst: TerminalInstance): string {
  return inst.report.title ?? 'New session';
}

/** Ending a session asks first only when Claude works in its own terminal: a
 *  Lens-only one busy elsewhere loses nothing when its tab goes. */
export function endNeedsConfirm(tone: ChipTone, r: InstanceReport): boolean {
  return tone === 'busy' && r.termStatus === 'running';
}

// What needs the user first: an answer, then a turn still going, then a turn to
// take. The badge wears the first of these that any parked session is in.
const URGENCY: readonly ChipTone[] = ['waiting', 'busy', 'idle', 'starting', 'lens', 'ended'];

export function mostUrgentTone(tones: readonly ChipTone[]): ChipTone {
  return URGENCY.find(t => tones.includes(t)) ?? 'ended';
}
