// @vitest-environment jsdom
//
// Mission Control's side of parking. Given a way to park, the top bar's back
// arrow leaves for the app and keeps the session running, in any state and
// without asking — ending a session is its tab's ✕. Without one, Back ends it
// and asks first when that throws away a turn in flight in its own pane. Either
// way the arrow first walks out of a detail. While parked it keeps its hands
// off keys meant for the session on screen, and it reports what its tab shows.
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ActiveSession } from '../src/types';
import { ThemeContext } from '../src/hooks/useTheme';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

// The Lens is a stand-in that can open a tool detail, the overlay Esc closes.
vi.mock('../src/components/project/chat/ChatView', () => ({
  ChatView: ({ onOpenTool }: { onOpenTool: (group: unknown) => void }) => (
    <div>
      Read-only transcript
      <button
        type="button"
        onClick={() =>
          onOpenTool({
            use: { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'true' } },
            result: undefined,
          })
        }
      >
        Open a tool
      </button>
    </div>
  ),
}));

const PROJECT = { hash: '-synthetic-acme', realPath: '/synthetic/acme' };

let bridge: FakeBridge;
let client: QueryClient;
let TerminalMissionControl: typeof import('../src/components/project/terminal/TerminalMissionControl').TerminalMissionControl;
let kill: ReturnType<typeof vi.fn>;

const registry = (patch: Partial<ActiveSession>): ActiveSession => ({
  pid: 2,
  sessionId: 'session-a',
  cwd: PROJECT.realPath,
  status: 'busy',
  source: 'registry',
  ...patch,
});

beforeEach(async () => {
  localStorage.clear();
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
  ({ TerminalMissionControl } =
    await import('../src/components/project/terminal/TerminalMissionControl'));
  bridge = installFakeElectronAPI();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  Object.assign(bridge.api.sessions, { getSubagents: vi.fn(async () => ok([])) });
  Object.assign(bridge.api, {
    tasks: { getByProject: vi.fn(async () => ok([])) },
    teams: { getByProject: vi.fn(async () => ok([])) },
    skills: { getAll: vi.fn(async () => ok([])) },
    plugins: { getAll: vi.fn(async () => ok([])) },
    agents: {
      getGlobal: vi.fn(async () => ok([])),
      getByProject: vi.fn(async () => ok([])),
    },
  });
  Object.assign(bridge.api.memory, { getProject: vi.fn(async () => ok(null)) });
  // StrictMode mounts the pane twice: pty-1 (pid 1) is the discarded rehearsal,
  // pty-2 (pid 2) the process that survives.
  let counter = 0;
  kill = vi.fn(async () => ok(null));
  Object.assign(bridge.api, {
    terminal: {
      create: vi.fn(async () => ok({ id: `pty-${++counter}`, pid: counter })),
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
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Props = Partial<Parameters<typeof TerminalMissionControl>[0]>;

function tree(props: Props) {
  return (
    <StrictMode>
      <QueryClientProvider client={client}>
        <ThemeContext.Provider
          value={{ preference: 'light', resolved: 'light', setPreference: vi.fn() }}
        >
          <TerminalMissionControl project={PROJECT} onBack={vi.fn()} {...props} />
        </ThemeContext.Provider>
      </QueryClientProvider>
    </StrictMode>
  );
}

/** A fresh terminal (no resume id) opens on TERMINAL and spawns right away. */
async function runningFresh(props: Props) {
  const mounted = render(tree(props));
  await waitFor(() => expect(kill).toHaveBeenCalledWith('pty-1'));
  return mounted;
}

const lensPane = () => screen.getByText('Read-only transcript').parentElement!;

/** Resolves once the registry read has landed: a busy session is only known
 *  as busy from it. */
async function registryRead() {
  await waitFor(() => expect(client.getQueryData(['live:activeSessions'])).toBeDefined());
}

it('leaves a session with no terminal running for the app, and keeps it', async () => {
  const onPark = vi.fn();
  const onBack = vi.fn();
  render(tree({ resumeSessionId: 'session-a', onPark, onBack }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
  expect(onPark).toHaveBeenCalledTimes(1);
  expect(onBack).not.toHaveBeenCalled();
  expect(kill).not.toHaveBeenCalled();
});

it('leaves a busy terminal for the app without asking: nothing is stopped', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([registry({})]));
  const confirm = vi.spyOn(window, 'confirm');
  const onPark = vi.fn();
  const onBack = vi.fn();
  await runningFresh({ onPark, onBack });
  await registryRead();
  fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
  expect(onPark).toHaveBeenCalledTimes(1);
  expect(onBack).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
});

it('without a way to park, Back ends an idle terminal without asking', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([registry({ status: 'idle' })]));
  const confirm = vi.spyOn(window, 'confirm');
  const onBack = vi.fn();
  await runningFresh({ onBack });
  await registryRead();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
});

it('without a way to park, asks before Back stops a turn in flight in its own pane', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([registry({})]));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const onBack = vi.fn();
  await runningFresh({ onBack });
  await registryRead();

  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(onBack).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(onBack).toHaveBeenCalledTimes(1);
});

it('does not ask when the busy session runs in a terminal elsewhere', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([registry({ pid: 999 })]));
  const confirm = vi.spyOn(window, 'confirm');
  const onBack = vi.fn();
  render(tree({ resumeSessionId: 'session-a', onBack }));
  await registryRead();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(confirm).not.toHaveBeenCalled();
  expect(onBack).toHaveBeenCalledTimes(1);
});

it('walks back out of a detail before it leaves the session', async () => {
  const onPark = vi.fn();
  render(tree({ resumeSessionId: 'session-a', onPark }));
  fireEvent.click(screen.getByRole('button', { name: 'Open a tool' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Back to session' })[0]);
  expect(onPark).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Back to session' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to app' }));
  expect(onPark).toHaveBeenCalledTimes(1);
});

it('leaves Esc to the session on screen while parked', async () => {
  const { rerender } = render(tree({ resumeSessionId: 'session-a' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open a tool' }));
  expect(screen.getAllByRole('button', { name: /Back to session/ }).length).toBeGreaterThan(0);

  rerender(tree({ resumeSessionId: 'session-a', active: false }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getAllByRole('button', { name: /Back to session/ }).length).toBeGreaterThan(0);

  rerender(tree({ resumeSessionId: 'session-a', active: true }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: /Back to session/ })).toBeNull();
});

it('turns to the Lens when reached again with a message to show', async () => {
  localStorage.setItem('tmc-view', 'terminal');
  const { rerender } = render(tree({ resumeSessionId: 'session-a' }));
  expect(lensPane().style.display).toBe('none');
  rerender(tree({ resumeSessionId: 'session-a', focusMessageUuid: 'msg-1' }));
  expect(lensPane().style.display).toBe('block');
  // The user's own choice is left as it was: nothing is persisted from a render.
  expect(localStorage.getItem('tmc-view')).toBe('terminal');
});

it('reports its process, its session and its state to its tab', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([registry({ status: 'idle' })]));
  const onReport = vi.fn();
  await runningFresh({ onReport });
  await waitFor(() =>
    expect(onReport).toHaveBeenLastCalledWith({
      pid: 2,
      sessionId: 'session-a',
      title: null,
      color: null,
      termStatus: 'running',
    })
  );
});

it('reports no PTY while it only shows the Lens', async () => {
  const onReport = vi.fn();
  render(tree({ resumeSessionId: 'session-a', onReport }));
  await act(async () => {});
  expect(onReport).toHaveBeenLastCalledWith(
    expect.objectContaining({ sessionId: 'session-a', termStatus: null })
  );
});
