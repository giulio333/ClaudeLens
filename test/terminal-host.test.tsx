// @vitest-environment jsdom
//
// The point of parking, end to end on the real pane: a parked session's
// `claude` outlives every navigation that does not end it, comes back without a
// second spawn, and is killed only by its ✕ — or by Back on one that was never
// parked, as before. Mission Control is a stub around the real TerminalPane: the
// claim is about which processes live, not about the frame drawn around them.
import { StrictMode, useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ActiveSession } from '../src/types';
import { ThemeContext } from '../src/hooks/useTheme';
import type { InstanceReport } from '../src/components/project/terminal/terminal-instances';
import type { TerminalStatus } from '../src/components/project/terminal/terminal-theme';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

vi.mock('../src/components/project/terminal/TerminalMissionControl', async () => {
  const { TerminalPane } = await import('../src/components/project/terminal/TerminalPane');
  function StubMissionControl(props: {
    project: { hash: string; realPath: string };
    resumeSessionId?: string;
    active?: boolean;
    onReport?: (r: InstanceReport) => void;
  }) {
    const [pid, setPid] = useState<number | null>(null);
    const [status, setStatus] = useState<TerminalStatus>('starting');
    const { onReport } = props;
    useEffect(() => {
      onReport?.({
        pid,
        sessionId: props.resumeSessionId ?? null,
        title: null,
        color: null,
        termStatus: status,
        gitBranch: null,
      });
    }, [onReport, pid, status, props.resumeSessionId]);
    return (
      <div data-testid="mission-control" data-hash={props.project.hash}>
        <TerminalPane
          cwd={props.project.realPath}
          resumeSessionId={props.resumeSessionId}
          onPid={setPid}
          onStatus={setStatus}
          active={props.active}
        />
      </div>
    );
  }
  return { TerminalMissionControl: StubMissionControl };
});

const ACME = { hash: '-synthetic-acme', realPath: '/synthetic/acme' };
const ZETA = { hash: '-synthetic-zeta', realPath: '/synthetic/zeta' };

let bridge: FakeBridge;
let client: QueryClient;
let create: ReturnType<typeof vi.fn>;
let kill: ReturnType<typeof vi.fn>;
let TerminalHost: typeof import('../src/components/project/terminal/TerminalHost').TerminalHost;
let ParkedTerminals: typeof import('../src/components/project/terminal/ParkedTerminals').ParkedTerminals;
let useTerminalNav: typeof import('../src/components/project/terminal/use-terminal-nav').useTerminalNav;
let nav: ReturnType<typeof useTerminalNav>;

beforeEach(async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  ({ TerminalHost } = await import('../src/components/project/terminal/TerminalHost'));
  ({ ParkedTerminals } = await import('../src/components/project/terminal/ParkedTerminals'));
  ({ useTerminalNav } = await import('../src/components/project/terminal/use-terminal-nav'));
  bridge = installFakeElectronAPI();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  // Every mount spawns twice under StrictMode: the odd pty is the rehearsal
  // (killed at once), the even one the process that survives.
  let counter = 0;
  create = vi.fn(async () => ok({ id: `pty-${++counter}`, pid: counter }));
  kill = vi.fn(async () => ok(null));
  Object.assign(bridge.api, {
    terminal: {
      create,
      write: vi.fn(async () => ok(null)),
      kill,
      resize: vi.fn(async () => ok(null)),
      onData: () => () => {},
      onExit: () => () => {},
    },
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  bridge.restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness({ projects }: { projects?: Array<{ hash: string; realPath: string }> }) {
  nav = useTerminalNav({ type: 'global-home' });
  return (
    <TerminalHost
      instances={nav.state.instances}
      currentId={nav.state.currentId}
      projects={projects}
      tabs={null}
      onBack={inst => nav.close(inst.id)}
      onPark={() => nav.park()}
      onReport={nav.report}
      onOpenSession={vi.fn()}
      onOpenExchange={vi.fn()}
    />
  );
}

function wrap(node: React.ReactNode) {
  return (
    <StrictMode>
      <QueryClientProvider client={client}>
        <ThemeContext.Provider
          value={{ preference: 'dark', resolved: 'dark', setPreference: vi.fn() }}
        >
          {node}
        </ThemeContext.Provider>
      </QueryClientProvider>
    </StrictMode>
  );
}

/** Opens a terminal and waits until its surviving process runs. */
async function open(project: typeof ACME, resumeSessionId?: string) {
  const before = create.mock.calls.length;
  act(() => nav.navigate({ type: 'terminal', project, resumeSessionId }));
  await waitFor(() => expect(create.mock.calls.length).toBe(before + 2));
  const survivor = `pty-${before + 2}`;
  await waitFor(() =>
    expect(nav.state.instances.find(i => i.id === nav.state.currentId)?.report.termStatus).toBe(
      'running'
    )
  );
  return survivor;
}

it('keeps a parked session alive through any navigation that does not end it', async () => {
  render(wrap(<Harness />));
  const acme = await open(ACME);
  act(() => nav.park());
  act(() => nav.navigate({ type: 'monitor' }));
  act(() => nav.navigate({ type: 'sessions', project: ZETA }));
  expect(kill).not.toHaveBeenCalledWith(acme);
  expect(screen.getByTestId('mission-control').closest('.cl-app')).toHaveProperty(
    'style.display',
    'none'
  );
});

it('brings a parked session back without spawning it again, and parks the one it replaces', async () => {
  render(wrap(<Harness />));
  const acme = await open(ACME);
  act(() => nav.park());
  const zeta = await open(ZETA);
  const parkedId = nav.state.instances.find(i => i.view.project === ACME)!.id;
  act(() => nav.restore(parkedId));
  expect(create).toHaveBeenCalledTimes(4);
  expect(kill).not.toHaveBeenCalledWith(acme);
  expect(kill).not.toHaveBeenCalledWith(zeta);
  expect(screen.getAllByTestId('mission-control')).toHaveLength(2);
});

it('restores a parked session opened again from anywhere, instead of resuming it twice', async () => {
  render(wrap(<Harness />));
  const first = await open(ACME, 'session-a');
  act(() => nav.park());
  act(() => nav.navigate({ type: 'terminal', project: ACME, resumeSessionId: 'session-a' }));
  expect(create).toHaveBeenCalledTimes(2);
  expect(kill).not.toHaveBeenCalledWith(first);
});

it('ends a parked session on its ✕, and an unparked one on Back, as before', async () => {
  render(wrap(<Harness />));
  const parked = await open(ACME);
  act(() => nav.park());
  const shown = await open(ZETA);
  act(() => nav.close(nav.state.currentId!));
  expect(kill).toHaveBeenCalledWith(shown);
  expect(kill).not.toHaveBeenCalledWith(parked);
  act(() => nav.close(nav.state.instances[0].id));
  expect(kill).toHaveBeenCalledWith(parked);
});

it('keeps the process when the project’s provisional hash turns real', async () => {
  const provisional = { hash: '-synthetic-provisional', realPath: '/synthetic/fresh' };
  const { rerender } = render(wrap(<Harness />));
  const pty = await open(provisional);
  rerender(
    wrap(<Harness projects={[{ hash: '-synthetic-real', realPath: '/synthetic/fresh' }]} />)
  );
  expect(screen.getByTestId('mission-control').dataset.hash).toBe('-synthetic-real');
  expect(create).toHaveBeenCalledTimes(2);
  expect(kill).not.toHaveBeenCalledWith(pty);
});

const busyHere: ActiveSession = {
  pid: 2,
  sessionId: 'session-a',
  cwd: ACME.realPath,
  status: 'busy',
  source: 'registry',
};
function parked(id: string, report: Partial<InstanceReport>, project = ACME) {
  return {
    id,
    view: { type: 'terminal' as const, project },
    report: {
      pid: null,
      sessionId: null,
      title: null,
      color: null,
      termStatus: 'running' as const,
      gitBranch: null,
      ...report,
    },
  };
}

it('gathers the background sessions behind one badge, wearing the most urgent state', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(
    ok([busyHere, { ...busyHere, pid: 3, sessionId: 'session-b', status: 'waiting' }])
  );
  const onRestore = vi.fn();
  render(
    wrap(
      <ParkedTerminals
        instances={[
          parked('t1', { pid: 2, title: 'Fix the build' }),
          parked('t2', { pid: 3, title: 'Write the docs', color: 'blue' }, ZETA),
          parked('t3', { pid: 4, title: 'Tidy up' }),
        ]}
        onRestore={onRestore}
        onClose={vi.fn()}
      />
    )
  );
  const badge = await screen.findByRole('button', {
    name: '3 sessions in background · 1 waiting for you',
  });
  expect(badge.getAttribute('data-tone')).toBe('waiting');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(badge);
  expect(screen.getByRole('dialog', { name: 'Sessions in background' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(3);
  // The session's colour is worn by its title, as on the sessions list.
  expect(screen.getByText('Write the docs').className).toContain('cl-session-identity blue');
  expect(screen.getByText('Fix the build').className).not.toContain('cl-session-identity');
  fireEvent.click(screen.getByRole('button', { name: /Open zeta · Write the docs/ }));
  expect(onRestore).toHaveBeenCalledWith('t2');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('asks before its ✕ stops a session that is working', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([busyHere]));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const onClose = vi.fn();
  render(
    wrap(
      <ParkedTerminals
        instances={[parked('t1', { pid: 2, sessionId: 'session-a', title: 'Fix the build' })]}
        onRestore={vi.fn()}
        onClose={onClose}
      />
    )
  );
  const badge = await screen.findByRole('button', { name: /in background/ });
  await waitFor(() => expect(badge.getAttribute('data-tone')).toBe('busy'));
  fireEvent.click(badge);
  const end = screen.getByRole('button', { name: /End acme · Fix the build/ });
  fireEvent.click(end);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(end);
  expect(onClose).toHaveBeenCalledWith('t1');
});

it('closes a Lens-only session without asking, even while it works elsewhere', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([{ ...busyHere, pid: 99 }]));
  const confirm = vi.spyOn(window, 'confirm');
  const onClose = vi.fn();
  render(
    wrap(
      <ParkedTerminals
        instances={[
          parked('t1', { sessionId: 'session-a', title: 'Fix the build', termStatus: null }),
        ]}
        onRestore={vi.fn()}
        onClose={onClose}
      />
    )
  );
  const badge = await screen.findByRole('button', { name: /in background/ });
  await waitFor(() => expect(badge.getAttribute('data-tone')).toBe('busy'));
  fireEvent.click(badge);
  fireEvent.click(screen.getByRole('button', { name: /End acme · Fix the build/ }));
  expect(confirm).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledWith('t1');
});
