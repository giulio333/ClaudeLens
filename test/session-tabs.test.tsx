// @vitest-environment jsdom
//
// Mission Control's first row: every open session as a tab. A click on another
// tab brings it on screen, the tab on screen does nothing when clicked, `+`
// opens a new session, and a tab's ✕ ends its session — asking first only while
// Claude works in that session's own terminal. The grid button lists every tab,
// the one on screen marked. What the reducer does with those calls is
// `terminal-instances.test.ts`; this is what the strip offers and when it asks.
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ActiveSession, SessionActivity } from '../src/types';
import { ThemeContext } from '../src/hooks/useTheme';
import type {
  InstanceReport,
  TerminalInstance,
} from '../src/components/project/terminal/terminal-instances';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

const ACME = { hash: '-synthetic-acme', realPath: '/synthetic/acme' };
const ZETA = { hash: '-synthetic-zeta', realPath: '/synthetic/zeta' };

let bridge: FakeBridge;
let client: QueryClient;
let SessionTabs: typeof import('../src/components/project/terminal/SessionTabs').SessionTabs;
let TabAttentionProvider: typeof import('../src/components/project/terminal/TabAttentionProvider').TabAttentionProvider;
let ParkedTerminals: typeof import('../src/components/project/terminal/ParkedTerminals').ParkedTerminals;

beforeEach(async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  ({ SessionTabs } = await import('../src/components/project/terminal/SessionTabs'));
  ({ TabAttentionProvider } =
    await import('../src/components/project/terminal/TabAttentionProvider'));
  ({ ParkedTerminals } = await import('../src/components/project/terminal/ParkedTerminals'));
  bridge = installFakeElectronAPI();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
  client.clear();
  bridge.restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function tab(id: string, report: Partial<InstanceReport>, project = ACME): TerminalInstance {
  return {
    id,
    view: { type: 'terminal', project },
    report: {
      pid: null,
      sessionId: null,
      title: null,
      color: null,
      termStatus: 'running',
      gitBranch: null,
      ...report,
    },
  };
}

const busy = (patch: Partial<ActiveSession>): ActiveSession => ({
  pid: 2,
  sessionId: 'session-a',
  cwd: ACME.realPath,
  status: 'busy',
  source: 'registry',
  ...patch,
});

function mount(
  instances: TerminalInstance[],
  currentId: string,
  handlers: Partial<{ onSelect: () => void; onClose: () => void; onNew: () => void }> = {}
) {
  const props = { onSelect: vi.fn(), onClose: vi.fn(), onNew: vi.fn(), ...handlers };
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <ThemeContext.Provider
          value={{ preference: 'light', resolved: 'light', setPreference: vi.fn() }}
        >
          <SessionTabs instances={instances} currentId={currentId} {...props} />
        </ThemeContext.Provider>
      </QueryClientProvider>
    </StrictMode>
  );
  return props;
}

async function registryRead() {
  await waitFor(() => expect(client.getQueryData(['live:activeSessions'])).toBeDefined());
}

it('draws a tab per session, the one on screen marked, the title in the session colour', () => {
  mount(
    [
      tab('t1', { title: 'Fix the build' }),
      tab('t2', { title: 'Write the docs', color: 'blue' }, ZETA),
      tab('t3', {}),
    ],
    't1'
  );
  const tabs = screen.getAllByRole('button', { name: /—/ });
  expect(tabs).toHaveLength(3);
  expect(tabs[0].getAttribute('aria-current')).toBe('page');
  expect(tabs[1].getAttribute('aria-current')).toBeNull();
  expect(screen.getByText('Write the docs').className).toContain('cl-session-identity blue');
  expect(screen.getByText('zeta')).toBeTruthy();
  // A session Claude has not named yet is still a tab.
  expect(screen.getByText('New session')).toBeTruthy();
});

it('brings another tab on screen, does nothing for the one already there, and opens a new one', () => {
  const props = mount(
    [tab('t1', { title: 'Fix the build' }), tab('t2', { title: 'Write the docs' })],
    't1'
  );
  fireEvent.click(screen.getByRole('button', { name: /^Fix the build ·/ }));
  expect(props.onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Write the docs ·/ }));
  expect(props.onSelect).toHaveBeenCalledWith('t2');
  fireEvent.click(screen.getByRole('button', { name: 'New session' }));
  expect(props.onNew).toHaveBeenCalledTimes(1);
});

it('asks before its ✕ stops a turn in flight in that session’s own terminal', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([busy({})]));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const props = mount(
    [tab('t1', { pid: 2, sessionId: 'session-a', title: 'Fix the build' })],
    't1'
  );
  await registryRead();
  const close = screen.getByRole('button', { name: 'Close acme · Fix the build' });
  fireEvent.click(close);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(props.onClose).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(close);
  expect(props.onClose).toHaveBeenCalledWith('t1');
});

it('closes without asking a session that is idle, or that works in a terminal elsewhere', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(
    ok([busy({ pid: 99 }), busy({ pid: 3, sessionId: 'session-b', status: 'idle' })])
  );
  const confirm = vi.spyOn(window, 'confirm');
  const props = mount(
    [
      tab('t1', { sessionId: 'session-a', title: 'Lens only', termStatus: null }),
      tab('t2', { pid: 3, sessionId: 'session-b', title: 'Done turn' }),
    ],
    't1'
  );
  await registryRead();
  fireEvent.click(screen.getByRole('button', { name: 'Close acme · Lens only' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close acme · Done turn' }));
  expect(confirm).not.toHaveBeenCalled();
  expect(props.onClose).toHaveBeenCalledWith('t1');
  expect(props.onClose).toHaveBeenCalledWith('t2');
});

it('wears a question mark only while Claude asks a question, and a plain dot for any other wait', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(
    ok([
      busy({ status: 'waiting', waitingFor: 'input needed' }),
      busy({ pid: 3, sessionId: 'session-b', status: 'idle' }),
      busy({ pid: 4, sessionId: 'session-c', status: 'waiting', waitingFor: 'permission prompt' }),
    ])
  );
  mount(
    [
      tab('t1', { pid: 2, sessionId: 'session-a', title: 'Asks a question' }),
      tab('t2', { pid: 3, sessionId: 'session-b', title: 'Done turn' }),
      tab('t3', { pid: 4, sessionId: 'session-c', title: 'Needs approval' }),
    ],
    't1'
  );
  await registryRead();
  const asking = await screen.findByRole('button', {
    name: /^Asks a question · .*Claude asks you a question$/,
  });
  const dot = asking.querySelector('.cl-parked-dot[data-tone="waiting"]');
  expect(dot?.querySelector('svg')).not.toBeNull();
  // A tool's approval is a wait, not a question.
  const approval = screen.getByRole('button', {
    name: /^Needs approval · .*Waiting for you: permission prompt$/,
  });
  const plainWait = approval.querySelector('.cl-parked-dot[data-tone="waiting"]');
  expect(plainWait).not.toBeNull();
  expect(plainWait?.childElementCount).toBe(0);
  const idle = screen.getByRole('button', { name: /^Done turn · .*Your turn$/ });
  const plain = idle.querySelector('.cl-parked-dot[data-tone="idle"]');
  expect(plain).not.toBeNull();
  expect(plain?.childElementCount).toBe(0);
});

it('names each project once, before its tabs, and never on the tabs themselves', () => {
  mount(
    [
      tab('t1', { title: 'Fix the build' }),
      tab('t2', { title: 'Add a test' }),
      tab('t3', { title: 'Write the docs' }, ZETA),
    ],
    't1'
  );
  const groups = screen.getAllByRole('group');
  expect(groups.map(g => g.getAttribute('aria-label'))).toEqual(['acme', 'zeta']);
  expect(groups[0].querySelectorAll('.cl-stab')).toHaveLength(2);
  expect(groups[1].querySelectorAll('.cl-stab')).toHaveLength(1);
  expect(screen.getAllByText('acme')).toHaveLength(1);
  // The project still reaches a screen reader on every tab.
  expect(screen.getByRole('button', { name: /^Write the docs · zeta —/ })).toBeTruthy();
  // Pointing at a tab tints its project's others only when there are others.
  const strip = screen.getByRole('navigation', { name: 'Open sessions' });
  expect(strip.dataset.grouped).toBe('true');
  cleanup();
  mount([tab('t1', { title: 'Fix the build' }), tab('t2', { title: 'Add a test' })], 't1');
  expect(screen.getByRole('navigation', { name: 'Open sessions' }).dataset.grouped).toBeUndefined();
});

it('keeps the tabs of a group in place when its first tab closes', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([]));
  const instances = [
    tab('t1', { title: 'First' }),
    tab('t2', { title: 'Second' }),
    tab('t3', { title: 'Elsewhere' }, ZETA),
  ];
  const view = mountAttended(instances, 't3');
  await registryRead();
  const dot = stabOf('Second').querySelector('.cl-parked-dot');
  view.setInstances(instances.slice(1));
  // The same element: a remount would replay its animations.
  expect(stabOf('Second').querySelector('.cl-parked-dot')).toBe(dot);
});

it('offers the grid button only once there are two tabs, before the tabs', () => {
  mount([tab('t1', { title: 'Fix the build' })], 't1');
  expect(screen.queryByRole('button', { name: 'All open sessions' })).toBeNull();
  cleanup();
  mount(
    [tab('t1', { title: 'Fix the build' }), tab('t2', { title: 'Write the docs' }, ZETA)],
    't1'
  );
  const grid = screen.getByRole('button', { name: 'All open sessions' });
  const strip = screen.getByRole('navigation', { name: 'Open sessions' });
  expect(grid.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('lists every tab behind the grid button, the one on screen marked and not reopened', () => {
  const props = mount(
    [tab('t1', { title: 'Fix the build' }), tab('t2', { title: 'Write the docs' }, ZETA)],
    't1'
  );
  fireEvent.click(screen.getByRole('button', { name: 'All open sessions' }));
  expect(screen.getByRole('dialog', { name: 'Open sessions' })).toBeTruthy();
  const rows = screen.getAllByRole('button', { name: /^Open / });
  expect(rows).toHaveLength(2);
  expect(rows[0].getAttribute('aria-current')).toBe('true');
  fireEvent.click(rows[0]);
  expect(props.onSelect).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'All open sessions' }));
  fireEvent.click(screen.getByRole('button', { name: /^Open zeta · Write the docs/ }));
  expect(props.onSelect).toHaveBeenCalledWith('t2');
});

it('shows the whole title, project and state under a tab after a rest, and hides it on leaving', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(
    ok([busy({ pid: 2, sessionId: 'session-a', startedAt: Date.now() - 12 * 60_000 })])
  );
  const long = 'Refactor the authentication module so tokens refresh before they expire';
  bridge.api.live.getActivity.mockResolvedValue(
    ok([
      {
        sessionId: 'session-a',
        lastTool: { name: 'Bash', arg: 'cd web && CI=1 npm run test --silent' },
        delegates: [],
      } as unknown as SessionActivity,
    ])
  );
  mount([tab('t1', { pid: 2, sessionId: 'session-a', title: long })], 't1');
  await registryRead();
  await waitFor(() => expect(client.getQueryData(['live:sessionActivity'])).toBeDefined());
  const stab = screen.getByRole('button', { name: new RegExp(`^${long}`) });
  expect(stab.getAttribute('title')).toBeNull();
  vi.useFakeTimers();
  try {
    fireEvent.mouseEnter(stab.parentElement!);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    const card = screen.getByRole('tooltip');
    expect(card.textContent).toContain(long);
    expect(card.textContent).toContain('acme');
    expect(card.textContent).not.toContain('/synthetic/acme');
    expect(card.textContent).toContain('Claude is working · open 12 min');
    expect(card.textContent).toContain('Bash');
    expect(card.textContent).toContain('npm');
    expect(card.textContent).not.toContain('run test --silent');
    fireEvent.mouseLeave(screen.getByRole('navigation', { name: 'Open sessions' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it('names the branch under the project, so two worktrees of one project read apart', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([]));
  mount(
    [
      tab('t1', { sessionId: 'session-a', title: 'Spike', gitBranch: 'worktree-spike' }),
      tab('t2', { sessionId: 'session-b', title: 'Detached', gitBranch: 'HEAD' }),
      tab('t3', { sessionId: 'session-c', title: 'No repo' }),
    ],
    't1'
  );
  await registryRead();
  vi.useFakeTimers();
  try {
    const cardOf = (title: string) => {
      fireEvent.mouseEnter(
        screen.getByRole('button', { name: new RegExp(`^${title}`) }).parentElement!
      );
      act(() => vi.advanceTimersByTime(500));
      const text = screen.getByRole('tooltip').textContent;
      fireEvent.mouseLeave(screen.getByRole('navigation', { name: 'Open sessions' }));
      return text;
    };
    expect(cardOf('Spike')).toContain('worktree-spike');
    expect(cardOf('Detached')).toContain('detached HEAD');
    expect(cardOf('No repo')).not.toMatch(/HEAD|worktree/);
  } finally {
    vi.useRealTimers();
  }
});

// ── What a tab remembers between two looks (`tab-attention.ts`) ─────────────

/** The strip under the provider ProjectOverview mounts above it, with the
 *  background badge beside it; `show` swaps the session on screen, `remount`
 *  stands for a switch of tab, which mounts a new strip. */
function mountAttended(initial: TerminalInstance[], currentId: string | null) {
  let instances = initial;
  let current = currentId;
  const tree = (current: string | null, stripKey = 0) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <ThemeContext.Provider
          value={{ preference: 'light', resolved: 'light', setPreference: vi.fn() }}
        >
          <TabAttentionProvider instances={instances} currentId={current}>
            {current && (
              <SessionTabs
                key={stripKey}
                instances={instances}
                currentId={current}
                onSelect={vi.fn()}
                onClose={vi.fn()}
                onNew={vi.fn()}
              />
            )}
            <ParkedTerminals
              instances={instances.filter(i => i.id !== current)}
              onRestore={vi.fn()}
              onClose={vi.fn()}
            />
          </TabAttentionProvider>
        </ThemeContext.Provider>
      </QueryClientProvider>
    </StrictMode>
  );
  const { rerender } = render(tree(currentId));
  return {
    show: (id: string | null) => {
      current = id;
      rerender(tree(id));
    },
    remount: (id: string) => rerender(tree(id, 1)),
    setInstances: (next: TerminalInstance[]) => {
      instances = next;
      rerender(tree(current));
    },
  };
}

const stabOf = (title: string) =>
  screen.getByRole('button', { name: new RegExp(`^${title} ·`) }).parentElement!;

it('marks a session whose turn ended off screen, on its tab and on the badge, until it is shown', async () => {
  const first = busy({ pid: 2, sessionId: 'session-a', status: 'idle' });
  bridge.api.live.getActiveSessions.mockResolvedValue(
    ok([first, busy({ pid: 3, sessionId: 'session-b' })])
  );
  const instances = [
    tab('t1', { pid: 2, sessionId: 'session-a', title: 'On screen' }),
    tab('t2', { pid: 3, sessionId: 'session-b', title: 'Out of sight' }),
  ];
  const view = mountAttended(instances, 't1');
  await registryRead();
  await waitFor(() => expect(stabOf('Out of sight').dataset.tone).toBe('busy'));
  expect(stabOf('Out of sight').dataset.unseen).toBeUndefined();

  act(() =>
    bridge.channels.activeSessions.emit([
      first,
      busy({ pid: 3, sessionId: 'session-b', status: 'idle' }),
    ])
  );
  await waitFor(() => expect(stabOf('Out of sight').dataset.unseen).toBe('true'));
  const marked = stabOf('Out of sight');
  expect(marked.querySelector('.cl-parked-dot')?.getAttribute('data-unseen')).toBe('true');
  expect(screen.getByRole('button', { name: /^Out of sight · .*not seen yet$/ })).toBeTruthy();
  // The badge is what is on screen when the strip is not.
  expect(screen.getByRole('button', { name: /1 not seen yet/ })).toBeTruthy();

  view.show('t2');
  expect(stabOf('Out of sight').dataset.unseen).toBeUndefined();
  view.show('t1');
  expect(stabOf('Out of sight').dataset.unseen).toBeUndefined();
});

it('remembers a turn that ended while no strip was mounted', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([busy({})]));
  const instances = [tab('t1', { pid: 2, sessionId: 'session-a', title: 'Parked' })];
  const view = mountAttended(instances, null);
  await registryRead();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /in background/ }).dataset.tone).toBe('busy')
  );
  act(() => bridge.channels.activeSessions.emit([busy({ status: 'idle' })]));
  await screen.findByRole('button', { name: /1 not seen yet/ });
  view.show('t1');
  view.show(null);
  // Shown once, and parked again: seen.
  const badge = screen.getByRole('button', { name: /in background/ });
  expect(badge.getAttribute('aria-label')).not.toContain('not seen yet');
});

it('marks nothing when a working session drops out of one registry reading', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([busy({})]));
  const instances = [
    tab('t1', { title: 'On screen' }),
    tab('t2', { pid: 2, sessionId: 'session-a', title: 'Working' }),
  ];
  mountAttended(instances, 't1');
  await registryRead();
  await waitFor(() => expect(stabOf('Working').dataset.tone).toBe('busy'));
  // The reader skips a registry file it catches mid-write.
  act(() => bridge.channels.activeSessions.emit([]));
  await waitFor(() => expect(stabOf('Working').dataset.tone).toBe('idle'));
  expect(stabOf('Working').dataset.unseen).toBeUndefined();
  expect(stabOf('Working').querySelector('.cl-parked-dot')?.hasAttribute('data-motion')).toBe(
    false
  );
  act(() => bridge.channels.activeSessions.emit([busy({})]));
  await waitFor(() => expect(stabOf('Working').dataset.tone).toBe('busy'));
  act(() => bridge.channels.activeSessions.emit([busy({ status: 'idle' })]));
  await waitFor(() => expect(stabOf('Working').dataset.tone).toBe('idle'));
  // Only the real end of the turn counts, and it is the first one.
  expect(stabOf('Working').dataset.unseen).toBe('true');
});

it('settles the orb into its dot when a turn ends, and never replays it on a switch of tab', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([busy({})]));
  const instances = [tab('t1', { pid: 2, sessionId: 'session-a', title: 'Working' })];
  const view = mountAttended(instances, 't1');
  await registryRead();
  await waitFor(() => expect(stabOf('Working').dataset.tone).toBe('busy'));
  act(() => bridge.channels.activeSessions.emit([busy({ status: 'idle' })]));
  await waitFor(() => expect(stabOf('Working').dataset.tone).toBe('idle'));
  const dot = stabOf('Working').querySelector('.cl-parked-dot');
  expect(dot?.getAttribute('data-motion')).toBe('settle');
  // On screen it was watched: settled, and not marked unseen.
  expect(stabOf('Working').dataset.unseen).toBeUndefined();
  view.remount('t1');
  expect(stabOf('Working').querySelector('.cl-parked-dot')?.hasAttribute('data-motion')).toBe(
    false
  );
});

it('bounces the question mark when a session starts waiting, and tints a tab left waiting for minutes', async () => {
  const now = Date.now();
  bridge.api.live.getActiveSessions.mockResolvedValue(
    ok([busy({ status: 'idle' }), busy({ pid: 3, sessionId: 'session-b', status: 'idle' })])
  );
  const instances = [
    tab('t1', { pid: 2, sessionId: 'session-a', title: 'Asks now' }),
    tab('t2', { pid: 3, sessionId: 'session-b', title: 'Asked long ago' }),
    tab('t3', { title: 'On screen' }),
  ];
  mountAttended(instances, 't3');
  await registryRead();
  await waitFor(() => expect(stabOf('Asks now').dataset.tone).toBe('idle'));
  act(() =>
    bridge.channels.activeSessions.emit([
      busy({ status: 'waiting', statusUpdatedAt: now }),
      busy({
        pid: 3,
        sessionId: 'session-b',
        status: 'waiting',
        statusUpdatedAt: now - 5 * 60_000,
      }),
    ])
  );
  await waitFor(() => expect(stabOf('Asks now').dataset.tone).toBe('waiting'));
  const asking = stabOf('Asks now');
  expect(asking.querySelector('.cl-parked-dot')?.getAttribute('data-motion')).toBe('ask');
  expect(asking.dataset.longWait).toBeUndefined();
  expect(stabOf('Asked long ago').dataset.longWait).toBe('true');
});

it('greys out a session that ended', () => {
  mountAttended(
    [tab('t1', { title: 'Still here' }), tab('t2', { title: 'Gone', termStatus: 'exited' })],
    't1'
  );
  expect(stabOf('Gone').dataset.tone).toBe('ended');
  expect(stabOf('Still here').dataset.tone).not.toBe('ended');
});

// ── When the tabs no longer fit ─────────────────────────────────────────────

/** A 300px window over a row of 100px tabs, as jsdom lays out nothing. */
function layOutRow(scrollTo = vi.fn()) {
  vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(function (this: Element) {
    return this.classList.contains('cl-stabs-scroll')
      ? this.querySelectorAll('.cl-stab').length * 100
      : 0;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const row = this.closest('.cl-stabs-scroll');
    const box = (left: number, width: number) => ({ left, width, top: 0, height: 34 }) as DOMRect;
    if (this.classList.contains('cl-stabs-scroll')) return box(0, 300);
    const tabs = row ? [...row.querySelectorAll('.cl-stab')] : [];
    const n = tabs.indexOf(this);
    return n === -1 ? box(0, 0) : box(n * 100 - (row?.scrollLeft ?? 0), 100);
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  return scrollTo;
}

it('scrolls the tabs that do not fit, keeps `+` out of the row, and marks the edge past which a session waits', async () => {
  const scrollTo = layOutRow();
  bridge.api.live.getActiveSessions.mockResolvedValue(
    ok([
      busy({ pid: 7, sessionId: 'session-g', status: 'waiting', waitingFor: 'permission prompt' }),
    ])
  );
  const instances = Array.from({ length: 7 }, (_, n) =>
    tab(`t${n}`, { title: `Session ${n}`, ...(n === 6 ? { pid: 7, sessionId: 'session-g' } : {}) })
  );
  mount(instances, 't0');
  await registryRead();
  const row = document.querySelector('.cl-stabs-scroll') as HTMLElement;
  await waitFor(() => expect(row.dataset.moreRight).toBe('true'));
  expect(row.dataset.moreLeft).toBeUndefined();
  expect(
    screen.getByRole('button', { name: 'New session' }).closest('.cl-stabs-scroll')
  ).toBeNull();
  const mark = await screen.findByRole('button', { name: '1 session needs you, to the right' });
  fireEvent.click(mark);
  // t6 ends at 700: the row scrolls to its end, 400.
  expect(scrollTo).toHaveBeenCalledWith({ left: 400, behavior: 'smooth' });
  expect(screen.queryByRole('button', { name: /to the left/ })).toBeNull();
});

it('brings the tab on screen into view when it changes, and marks no edge for sessions that need nothing', () => {
  const scrollTo = layOutRow();
  const instances = Array.from({ length: 7 }, (_, n) => tab(`t${n}`, { title: `Session ${n}` }));
  mount(instances, 't5');
  expect(scrollTo).toHaveBeenCalledWith({ left: 600 - 300 + 28, behavior: 'auto' });
  expect(screen.queryByRole('button', { name: /needs? you/ })).toBeNull();
});

// ── The line under the pointer, and the context fill ───────────────────────

it('says beside the title what the session does, and wears how full its window is', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(
    ok([busy({}), busy({ pid: 3, sessionId: 'session-b', status: 'idle' })])
  );
  bridge.api.live.getActivity.mockResolvedValue(
    ok([
      {
        sessionId: 'session-a',
        lastTool: { name: 'Edit', arg: '/synthetic/acme/src/App.tsx' },
        delegates: [],
        context: { used: 170_000, max: 200_000 },
      } as unknown as SessionActivity,
    ])
  );
  mount(
    [
      tab('t1', { pid: 2, sessionId: 'session-a', title: 'Working' }),
      tab('t2', { pid: 3, sessionId: 'session-b', title: 'Resting' }),
      tab('t3', { title: 'Gone', termStatus: 'exited' }),
    ],
    't1'
  );
  await registryRead();
  await waitFor(() => expect(client.getQueryData(['live:sessionActivity'])).toBeDefined());
  const working = stabOf('Working');
  await waitFor(() => expect(working.dataset.ctx).toBe('high'));
  expect(working.style.getPropertyValue('--cl-ctx')).toBe('0.85');
  expect(working.querySelector('.cl-stab-live')?.textContent).toBe('Edit · App.tsx85%');
  // No reading yet: no fill and no figure, rather than an empty window.
  const resting = stabOf('Resting');
  expect(resting.dataset.ctx).toBeUndefined();
  expect(resting.querySelector('.cl-stab-live')?.textContent).toBe('Your turn');
  expect(stabOf('Gone').querySelector('.cl-stab-live')?.textContent).toBe('Ended');
});

// ── The rhythm of the work ──────────────────────────────────────────────────

const digest = (patch: Partial<SessionActivity>): SessionActivity =>
  ({
    sessionId: 'session-a',
    lastTool: null,
    delegates: [],
    context: null,
    recent: [],
    toolCount: 5,
    errorCount: 0,
    ...patch,
  }) as SessionActivity;

async function mountWorking(first: SessionActivity) {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([busy({})]));
  bridge.api.live.getActivity.mockResolvedValue(ok([first]));
  const view = mountAttended(
    [tab('t1', { pid: 2, sessionId: 'session-a', title: 'Working' })],
    't1'
  );
  await registryRead();
  await waitFor(() => expect(client.getQueryData(['live:sessionActivity'])).toBeDefined());
  return view;
}

const push = (a: SessionActivity) => act(() => bridge.channels.sessionActivity.emit([a]));

it('plays nothing for the counts a tab finds, then a beat per call, a flash and the name per file written', async () => {
  const view = await mountWorking(
    digest({
      recent: [
        {
          at: 1,
          kind: 'tool',
          tool: 'Edit',
          arg: '/synthetic/acme/old.ts',
          id: 'tu-0',
          done: true,
        },
      ],
    })
  );
  const strip = () => stabOf('Working');
  expect(strip().querySelector('.cl-stab-beat, .cl-stab-flash, .cl-stab-wrote')).toBeNull();

  push(digest({ toolCount: 6 }));
  await waitFor(() => expect(strip().querySelector('.cl-stab-beat')).not.toBeNull());
  expect(strip().querySelector('.cl-stab-flash')).toBeNull();

  const edit = {
    at: 2,
    kind: 'tool' as const,
    tool: 'Edit',
    arg: '/synthetic/acme/src/App.tsx',
    id: 'tu-1',
  };
  // Asked, not yet approved: nothing written, nothing flashed. The beat is
  // a new element once the push is in, which is what is waited on.
  const before = strip().querySelector('.cl-stab-beat');
  push(digest({ toolCount: 7, recent: [edit] }));
  await waitFor(() => expect(strip().querySelector('.cl-stab-beat')).not.toBe(before));
  expect(strip().querySelector('.cl-stab-flash')).toBeNull();
  push(digest({ toolCount: 7, recent: [{ ...edit, done: true }] }));
  await waitFor(() => expect(strip().querySelector('.cl-stab-wrote')?.textContent).toBe('App.tsx'));
  expect(strip().querySelector('.cl-stab-flash')).not.toBeNull();
  expect(strip().querySelector('.cl-stab-slot')?.getAttribute('data-wrote')).toBe('a');

  // A switch of tab mounts a new strip: none of it plays again.
  view.remount('t1');
  expect(strip().querySelector('.cl-stab-beat, .cl-stab-flash, .cl-stab-wrote')).toBeNull();
});

it('shakes the tab once per new error, and reddens its floor', async () => {
  await mountWorking(digest({ errorCount: 2 }));
  expect(stabOf('Working').dataset.fault).toBeUndefined();
  push(digest({ errorCount: 3 }));
  await waitFor(() => expect(stabOf('Working').dataset.fault).toBe('a'));
  expect(stabOf('Working').querySelector('.cl-stab-fault')).not.toBeNull();
  push(digest({ errorCount: 4 }));
  // Another name, so the shake plays again on the same element.
  await waitFor(() => expect(stabOf('Working').dataset.fault).toBe('b'));
});

it('circles the orb with a satellite per sub-agent at work, three at most', async () => {
  const agent = (n: number) => ({ id: `a-${n}`, name: 'general-purpose', at: n });
  await mountWorking(digest({ delegates: [agent(1), agent(2)] }));
  await waitFor(() => expect(stabOf('Working').querySelectorAll('.cl-stab-sat')).toHaveLength(2));
  push(digest({ delegates: [1, 2, 3, 4, 5].map(agent) }));
  await waitFor(() => expect(stabOf('Working').querySelectorAll('.cl-stab-sat')).toHaveLength(3));
});
