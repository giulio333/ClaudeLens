// @vitest-environment jsdom
//
// "Claude is waiting for you" in the Lens. Claude Code writes a question's
// `tool_use` row only together with its answer, so while a session waits its
// transcript holds nothing to draw; the registry is the one source that knows.
// The frame reads it and hands the Lens a line above its pill, with the way to
// the terminal holding the question — offered only when this pane runs one,
// since opening a terminal for a Lens-only session would resume it twice.
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ActiveSession } from '../src/types';
import { ThemeContext } from '../src/hooks/useTheme';
import type { SessionWaiting } from '../src/components/project/chat/WaitingLine';
import { WaitingLine } from '../src/components/project/chat/WaitingLine';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

// The Lens is a stand-in that shows what the frame handed it.
vi.mock('../src/components/project/chat/ChatView', () => ({
  ChatView: ({ waiting }: { waiting?: SessionWaiting | null }) => (
    <div>
      Read-only transcript
      {waiting && <span>waiting: {waiting.reason ?? 'no reason'}</span>}
      {waiting?.onOpenTerminal && (
        <button type="button" onClick={waiting.onOpenTerminal}>
          Lens: open terminal
        </button>
      )}
    </div>
  ),
}));

const PROJECT = { hash: '-synthetic-acme', realPath: '/synthetic/acme' };

let bridge: FakeBridge;
let client: QueryClient;
let TerminalMissionControl: typeof import('../src/components/project/terminal/TerminalMissionControl').TerminalMissionControl;
let kill: ReturnType<typeof vi.fn>;
let create: ReturnType<typeof vi.fn>;

const registry = (patch: Partial<ActiveSession>): ActiveSession => ({
  pid: 2,
  sessionId: 'session-a',
  cwd: PROJECT.realPath,
  status: 'waiting',
  waitingFor: 'dialog open',
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
  create = vi.fn(async () => ok({ id: `pty-${++counter}`, pid: counter }));
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

const lensPane = () => screen.getByText('Read-only transcript').parentElement!;

it('tells the Lens its session waits, and leads to this pane’s terminal', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([registry({})]));
  render(tree({}));
  await waitFor(() => expect(kill).toHaveBeenCalledWith('pty-1'));
  fireEvent.click(screen.getByRole('button', { name: 'Lens' }));
  expect(await screen.findByText('waiting: dialog open')).toBeTruthy();
  expect(lensPane().style.display).toBe('block');

  fireEvent.click(await screen.findByRole('button', { name: 'Lens: open terminal' }));
  expect(lensPane().style.display).toBe('none');
  // Showing the terminal is all it does: no second process.
  expect(create).toHaveBeenCalledTimes(2);
});

it('offers no terminal when the session waits in one this pane does not run', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([registry({ pid: 999 })]));
  render(tree({ resumeSessionId: 'session-a' }));
  expect(await screen.findByText('waiting: dialog open')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Lens: open terminal' })).toBeNull();
  expect(create).not.toHaveBeenCalled();
});

it('says nothing while the session works or waits on nobody', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(
    ok([registry({ status: 'busy', waitingFor: undefined })])
  );
  render(tree({ resumeSessionId: 'session-a' }));
  await waitFor(() => expect(client.getQueryData(['live:activeSessions'])).toBeDefined());
  expect(screen.queryByText(/^waiting:/)).toBeNull();
});

it('draws the line with its reason and the way to the terminal', () => {
  const onOpenTerminal = vi.fn();
  render(
    <StrictMode>
      <WaitingLine waiting={{ reason: 'permission prompt', onOpenTerminal }} />
    </StrictMode>
  );
  const line = screen.getByRole('status');
  expect(line.textContent).toContain('Claude is waiting for you');
  expect(line.textContent).toContain('permission prompt');
  fireEvent.click(screen.getByRole('button', { name: 'Open terminal →' }));
  expect(onOpenTerminal).toHaveBeenCalledTimes(1);
});

it('draws the question mark only for a question Claude asks, and no reason that repeats it', () => {
  render(
    <StrictMode>
      <WaitingLine waiting={{ reason: 'input needed', onOpenTerminal: vi.fn() }} />
    </StrictMode>
  );
  const line = screen.getByRole('status');
  expect(line.textContent).toContain('Claude asks you a question');
  expect(line.textContent).not.toContain('input needed');
  expect(line.querySelector('.cl-waiting-ic svg')).not.toBeNull();
  cleanup();
  render(
    <StrictMode>
      <WaitingLine waiting={{ reason: 'permission prompt', onOpenTerminal: vi.fn() }} />
    </StrictMode>
  );
  expect(screen.getByRole('status').querySelector('.cl-waiting-ic svg')).toBeNull();
});

it('says where the session waits when there is no terminal to open, and no reason it was not given', () => {
  render(
    <StrictMode>
      <WaitingLine waiting={{ reason: null }} />
    </StrictMode>
  );
  expect(screen.getByRole('status').textContent).toBe(
    'Claude is waiting for you in another terminal'
  );
  expect(screen.queryByRole('button')).toBeNull();
});
