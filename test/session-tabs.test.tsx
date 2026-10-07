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
  bridge = installFakeElectronAPI();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  cleanup();
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

it('marks a session waiting for an answer with a question mark, and any other with a plain dot', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(
    ok([
      busy({ status: 'waiting', waitingFor: 'dialog open' }),
      busy({ pid: 3, sessionId: 'session-b', status: 'idle' }),
    ])
  );
  mount(
    [
      tab('t1', { pid: 2, sessionId: 'session-a', title: 'Asks a question' }),
      tab('t2', { pid: 3, sessionId: 'session-b', title: 'Done turn' }),
    ],
    't1'
  );
  await registryRead();
  const waiting = await screen.findByRole('button', {
    name: /^Asks a question · .*Waiting for you$/,
  });
  const dot = waiting.querySelector('.cl-parked-dot[data-tone="waiting"]');
  expect(dot?.querySelector('svg')).not.toBeNull();
  const idle = screen.getByRole('button', { name: /^Done turn · .*Your turn$/ });
  const plain = idle.querySelector('.cl-parked-dot[data-tone="idle"]');
  expect(plain).not.toBeNull();
  expect(plain?.childElementCount).toBe(0);
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
