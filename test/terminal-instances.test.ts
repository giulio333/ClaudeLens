// Parked terminals, as the navigation state keeps them.
//
// One reducer decides both where the user is and which `claude` processes stay
// alive: a navigation to a terminal finds the instance already running that
// session or starts one, a navigation away drops the instance on screen unless
// it was parked. What matters is what it must never do — resume a session twice,
// land on an ended one, lose a parked one to an unrelated navigation.

import { describe, expect, it } from 'vitest';
import {
  chipTone,
  exitViewFor,
  mostUrgentTone,
  initNav,
  navReducer,
  parkTargetFor,
  type InstanceReport,
  type NavAction,
  type NavState,
  type TerminalView,
} from '../src/components/project/terminal/terminal-instances';
import type { View } from '../src/components/project/types';
import type { ActiveSession } from '../src/types';

const ACME = { hash: '-synthetic-acme', realPath: '/synthetic/acme' };
const ZETA = { hash: '-synthetic-zeta', realPath: '/synthetic/zeta' };

const fresh = (project = ACME): TerminalView => ({ type: 'terminal', project });
const resume = (id: string, extra: Partial<TerminalView> = {}): TerminalView => ({
  type: 'terminal',
  project: ACME,
  resumeSessionId: id,
  ...extra,
});

function run(state: NavState, ...actions: NavAction[]): NavState {
  return actions.reduce(navReducer, state);
}
const go = (next: View): NavAction => ({ type: 'navigate', next });
const running = (id: string, patch: Partial<InstanceReport> = {}): NavAction => ({
  type: 'report',
  id,
  patch: { termStatus: 'running', ...patch },
});
const home = () => initNav({ type: 'global-home' });
const ids = (s: NavState) => s.instances.map(i => i.id);

function invariant(s: NavState) {
  expect(s.currentId !== null).toBe(s.view.type === 'terminal');
  if (s.currentId) expect(ids(s)).toContain(s.currentId);
}

describe('navigate', () => {
  it('returns the same state for the same action twice (StrictMode calls reducers twice)', () => {
    const s = run(home(), go(fresh()), running('t1'));
    const a = navReducer(s, go(resume('s-9')));
    const b = navReducer(s, go(resume('s-9')));
    expect(a).toEqual(b);
  });

  it('drops the terminal on screen when leaving it, and keeps the parked ones', () => {
    const s = run(
      home(),
      go(fresh()),
      running('t1'),
      { type: 'park' },
      go(fresh(ZETA)),
      running('t2'),
      go({ type: 'global-home' })
    );
    expect(ids(s)).toEqual(['t1']);
    expect(s.currentId).toBeNull();
  });

  it('restores a parked session instead of resuming it a second time', () => {
    const viaResumeId = run(home(), go(resume('s-1')), running('t1'), { type: 'park' });
    expect(navReducer(viaResumeId, go(resume('s-1'))).currentId).toBe('t1');

    // A fresh terminal learns its session id from the registry only later.
    const viaReport = run(home(), go(fresh()), running('t1', { sessionId: 's-2' }), {
      type: 'park',
    });
    const back = navReducer(viaReport, go(resume('s-2')));
    expect(back.currentId).toBe('t1');
    expect(back.instances).toHaveLength(1);

    const viaJob = run(home(), go(resume('s-3', { attachJobId: 'job-1' })), running('t1'), {
      type: 'park',
    });
    expect(navReducer(viaJob, go(resume('s-other', { attachJobId: 'job-1' }))).currentId).toBe(
      't1'
    );
  });

  it('takes the new navigation context on reuse but never changes how it was launched', () => {
    const s = run(home(), go(resume('s-1', { attachJobId: 'job-1' })), running('t1'), {
      type: 'park',
    });
    const next = navReducer(
      s,
      go({
        type: 'terminal',
        project: { hash: '-synthetic-acme-real', realPath: ACME.realPath },
        resumeSessionId: 's-1',
        from: 'search',
        searchQuery: 'acme',
        focusMessageUuid: 'u-1',
      })
    );
    const view = next.instances[0].view;
    expect(view).toMatchObject({ from: 'search', searchQuery: 'acme', focusMessageUuid: 'u-1' });
    expect(view.project).toEqual(ACME);
    expect(view.attachJobId).toBe('job-1');
    expect(next.view).toBe(view);
  });

  it('replaces an ended session instead of landing on it', () => {
    const s = run(
      home(),
      go(resume('s-1')),
      running('t1'),
      { type: 'park' },
      {
        type: 'report',
        id: 't1',
        patch: { termStatus: 'exited' },
      }
    );
    const next = navReducer(s, go(resume('s-1')));
    expect(ids(next)).toEqual(['t2']);
    expect(next.currentId).toBe('t2');
  });

  it('keeps two fresh terminals apart', () => {
    const s = run(home(), go(fresh()), running('t1'), { type: 'park' }, go(fresh()));
    expect(ids(s)).toEqual(['t1', 't2']);
    expect(s.currentId).toBe('t2');
  });

  it('closes the terminal on screen when another session is opened over it', () => {
    const s = run(home(), go(resume('s-1')), running('t1'), go(resume('s-2')));
    expect(ids(s)).toEqual(['t2']);
  });

  it('hands an updater the view as it was', () => {
    const s = run(home(), go({ type: 'sessions', project: ACME }));
    const next = navReducer(s, {
      type: 'navigate',
      next: prev => (prev.type === 'sessions' ? { type: 'project-skills', project: ZETA } : prev),
    });
    expect(next.view).toEqual({ type: 'project-skills', project: ZETA });
  });
});

describe('park, restore, close', () => {
  it('parks onto the place Back would go, when that place shows the chips', () => {
    const s = run(home(), go(resume('s-1', { from: 'agents-live' })), running('t1'), {
      type: 'park',
    });
    expect(s.view).toEqual({ type: 'agents-live', project: ACME });
    expect(ids(s)).toEqual(['t1']);
    expect(s.currentId).toBeNull();
  });

  it('swaps on restore: the one on screen is parked, Lens-only too; an ended one is dropped', () => {
    const base = run(home(), go(fresh()), running('t1'), { type: 'park' });

    const fromLive = run(base, go(resume('s-2')), running('t2'), { type: 'restore', id: 't1' });
    expect(ids(fromLive)).toEqual(['t1', 't2']);
    expect(fromLive.currentId).toBe('t1');

    const fromLens = run(base, go(resume('s-2')), { type: 'restore', id: 't1' });
    expect(ids(fromLens)).toEqual(['t1', 't2']);
    expect(fromLens.view).toBe(fromLens.instances[0].view);

    const fromEnded = run(
      base,
      go(resume('s-2')),
      { type: 'report', id: 't2', patch: { termStatus: 'exited' } },
      { type: 'restore', id: 't1' }
    );
    expect(ids(fromEnded)).toEqual(['t1']);
  });

  it('parks a session with no terminal running, as it parks a live one', () => {
    const s = run(home(), go(resume('s-1')), { type: 'park' });
    expect(ids(s)).toEqual(['t1']);
    expect(s.currentId).toBeNull();
    expect(s.view).toEqual({ type: 'sessions', project: ACME });
  });

  it('closing a parked one leaves the screen alone; closing the current one goes back', () => {
    const s = run(home(), go(fresh()), running('t1'), { type: 'park' }, go(resume('s-2')));
    const parkedGone = navReducer(s, { type: 'close', id: 't1' });
    expect(ids(parkedGone)).toEqual(['t2']);
    expect(parkedGone.view).toBe(s.view);

    const currentGone = navReducer(s, { type: 'close', id: 't2' });
    expect(ids(currentGone)).toEqual(['t1']);
    expect(currentGone.view).toEqual({ type: 'sessions', project: ACME });
  });

  it('returns the same object for a report that changes nothing', () => {
    const s = run(home(), go(fresh()), running('t1', { pid: 41 }));
    expect(navReducer(s, running('t1', { pid: 41 }))).toBe(s);
    expect(navReducer(s, running('nope'))).toBe(s);
  });

  it('keeps "a terminal on screen" and "a terminal view" the same fact throughout', () => {
    const script: NavAction[] = [
      go(fresh()),
      running('t1'),
      { type: 'park' },
      go(resume('s-2', { from: 'search', searchQuery: 'q' })),
      running('t2'),
      { type: 'restore', id: 't1' },
      { type: 'park' },
      go({ type: 'monitor' }),
      { type: 'restore', id: 't2' },
      { type: 'close', id: 't2' },
      { type: 'close', id: 't1' },
      go(fresh(ZETA)),
      go({ type: 'settings' }),
    ];
    let s = home();
    for (const action of script) {
      s = navReducer(s, action);
      invariant(s);
    }
    expect(s.instances).toHaveLength(0);
  });
});

describe('tabs: closeTab, openNew', () => {
  it('closing the tab on screen brings its neighbour on screen and keeps the rest', () => {
    const s = run(
      home(),
      go(resume('s-1')),
      { type: 'openNew' },
      { type: 'openNew' },
      { type: 'restore', id: 't2' }
    );
    expect(ids(s)).toEqual(['t1', 't2', 't3']);
    const closed = run(s, { type: 'closeTab', id: 't2' });
    expect(ids(closed)).toEqual(['t1', 't3']);
    expect(closed.currentId).toBe('t3');
    expect(closed.view.type).toBe('terminal');
    invariant(closed);
  });

  it('falls back to the tab before it when the last one in the row closes', () => {
    const s = run(home(), go(resume('s-1')), { type: 'openNew' });
    const closed = run(s, { type: 'closeTab', id: 't2' });
    expect(ids(closed)).toEqual(['t1']);
    expect(closed.currentId).toBe('t1');
    invariant(closed);
  });

  it('closing a tab that is not on screen leaves the screen alone', () => {
    const s = run(home(), go(resume('s-1')), { type: 'openNew' });
    const closed = run(s, { type: 'closeTab', id: 't1' });
    expect(ids(closed)).toEqual(['t2']);
    expect(closed.currentId).toBe('t2');
  });

  it('closing the only tab leaves for where it was opened from', () => {
    const s = run(home(), go(resume('s-1', { from: 'agents-live' })));
    const closed = run(s, { type: 'closeTab', id: 't1' });
    expect(closed.instances).toHaveLength(0);
    expect(closed.view).toEqual({ type: 'agents-live', project: ACME });
    invariant(closed);
  });

  it('opens a fresh terminal in the project on screen and keeps the one it replaces', () => {
    const s = run(home(), go(resume('s-1', { project: ZETA })), running('t1'));
    const opened = run(s, { type: 'openNew' });
    expect(ids(opened)).toEqual(['t1', 't2']);
    expect(opened.currentId).toBe('t2');
    expect(opened.instances[1].view).toEqual({ type: 'terminal', project: ZETA });
    expect(opened.instances[0].report.termStatus).toBe('running');
    invariant(opened);
  });

  it('opens nothing when no terminal is on screen', () => {
    const s = run(home(), go(resume('s-1')), { type: 'park' });
    expect(run(s, { type: 'openNew' })).toBe(s);
  });
});

describe('exitViewFor / parkTargetFor', () => {
  const topic = { topic: { name: 'acme' }, content: 'x', hash: ACME.hash } as never;
  const exchange = { project: ZETA, sessionId: 's-z', msgId: 'm-1' };

  it('walks back to where the terminal was opened from', () => {
    expect(exitViewFor(fresh())).toEqual({ type: 'sessions', project: ACME });
    expect(exitViewFor(resume('s', { from: 'search', searchQuery: 'acme' }))).toEqual({
      type: 'search',
      query: 'acme',
    });
    expect(exitViewFor(resume('s', { from: 'memory-topic', memoryTopic: topic }))).toMatchObject({
      type: 'memory-topic',
      hash: ACME.hash,
    });
    expect(exitViewFor(resume('s', { from: 'exchange', exchange }))).toEqual({
      type: 'exchange',
      ...exchange,
    });
  });

  it('parks onto the sessions list wherever Back would hide the chips', () => {
    for (const from of ['search', 'memory-topic', 'exchange'] as const) {
      const v = resume('s', { from, searchQuery: 'q', memoryTopic: topic, exchange });
      expect(parkTargetFor(v)).toEqual({ type: 'sessions', project: ACME });
    }
  });
});

describe('chipTone', () => {
  const entry = (patch: Partial<ActiveSession>): ActiveSession => ({
    pid: 1,
    sessionId: 's-1',
    cwd: ACME.realPath,
    status: 'idle',
    source: 'registry',
    ...patch,
  });
  const report = (patch: Partial<InstanceReport>): InstanceReport => ({
    pid: 7,
    sessionId: 's-7',
    title: null,
    color: null,
    termStatus: 'running',
    gitBranch: null,
    ...patch,
  });

  it('reads the registry by pid before session id', () => {
    const active = [
      entry({ pid: 7, sessionId: 's-x', status: 'waiting' }),
      entry({ pid: 8, sessionId: 's-7', status: 'busy' }),
    ];
    expect(chipTone(report({}), active)).toBe('waiting');
    expect(chipTone(report({ pid: null }), active)).toBe('busy');
  });

  it('says lens for a chip with no terminal, unless the session works elsewhere', () => {
    const lensOnly = report({ pid: null, termStatus: null });
    expect(chipTone(lensOnly, [])).toBe('lens');
    expect(chipTone(lensOnly, [entry({ pid: 99, sessionId: 's-7', status: 'busy' })])).toBe('busy');
  });

  it('says ended, starting or idle when the registry cannot say more', () => {
    expect(chipTone(report({ termStatus: 'exited' }), [])).toBe('ended');
    expect(chipTone(report({ termStatus: 'error' }), [])).toBe('ended');
    expect(chipTone(report({ termStatus: 'starting' }), [])).toBe('starting');
    expect(chipTone(report({}), [entry({ pid: 7, status: 'unknown' })])).toBe('idle');
    expect(chipTone(report({}), undefined)).toBe('idle');
  });

  it('puts the session waiting for an answer before one at work, and that before a done turn', () => {
    expect(mostUrgentTone(['idle', 'busy', 'waiting'])).toBe('waiting');
    expect(mostUrgentTone(['ended', 'idle', 'busy'])).toBe('busy');
    expect(mostUrgentTone(['lens', 'starting', 'idle'])).toBe('idle');
    expect(mostUrgentTone(['ended'])).toBe('ended');
  });
});
