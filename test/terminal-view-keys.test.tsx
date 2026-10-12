// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ActiveSession, ChatMessage } from '../src/types';
import { ThemeContext } from '../src/hooks/useTheme';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

// The real Mission Control, terminal and xterm; only the transcript is stubbed.
vi.mock('../src/components/project/chat/ChatView', () => ({
  ChatView: () => (
    <div>
      Read-only transcript <input aria-label="Find" />
    </div>
  ),
}));

let bridge: FakeBridge;
let client: QueryClient;
let TerminalMissionControl: typeof import('../src/components/project/terminal/TerminalMissionControl').TerminalMissionControl;
let dataListeners: Set<(id: string, data: string) => void>;
let terminal: {
  create: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
};

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
  bridge.api.playbook.getTemplates.mockResolvedValue(
    ok([
      {
        id: 'one',
        name: 'Review',
        text: 'Check the changes.\nPreserve existing behavior.',
        createdAt: '',
        updatedAt: '',
      },
    ])
  );
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
  let counter = 0;
  dataListeners = new Set();
  terminal = {
    create: vi.fn(async () => ok({ id: `pty-${++counter}`, pid: counter })),
    write: vi.fn(async () => ok(null)),
    kill: vi.fn(async () => ok(null)),
  };
  Object.assign(bridge.api, {
    terminal: {
      ...terminal,
      resize: vi.fn(async () => ok(null)),
      onData: (listener: (id: string, data: string) => void) => {
        dataListeners.add(listener);
        return () => dataListeners.delete(listener);
      },
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

function mount() {
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <ThemeContext.Provider
          value={{ preference: 'light', resolved: 'light', setPreference: vi.fn() }}
        >
          <TerminalMissionControl
            project={{ hash: 'project-a', realPath: '/projects/acme' }}
            resumeSessionId="session-a"
            onBack={vi.fn()}
          />
        </ThemeContext.Provider>
      </QueryClientProvider>
    </StrictMode>
  );
}

const toggle = () => fireEvent.keyDown(document.body, { key: 'J', ctrlKey: true, shiftKey: true });
const view = () => localStorage.getItem('tmc-view');

async function openRunningTerminal() {
  fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
  await waitFor(() => expect(terminal.create).toHaveBeenCalled());
  await act(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
}

it('flips between Lens and Terminal with the shortcut, even with the terminal focused', async () => {
  mount();
  toggle();
  expect(view()).toBe('terminal');
  await waitFor(() => expect(terminal.create).toHaveBeenCalled());
  const xterm = document.querySelector('.xterm-helper-textarea');
  expect(xterm).toBeTruthy();
  fireEvent.keyDown(xterm!, { key: 'J', ctrlKey: true, shiftKey: true });
  expect(view()).toBe('lens');
  expect(terminal.write).not.toHaveBeenCalled();
});

it('sends a key typed into the Lens to the running CLI and shows the terminal', async () => {
  mount();
  await openRunningTerminal();
  fireEvent.click(screen.getByRole('button', { name: 'Lens' }));
  const pty = terminal.create.mock.results[terminal.create.mock.results.length - 1]
    .value as Promise<{ data: { id: string } }>;
  const { id } = (await pty).data;
  fireEvent.keyDown(document.body, { key: 'a' });
  expect(view()).toBe('terminal');
  expect(terminal.write).toHaveBeenCalledExactlyOnceWith(id, 'a');
});

it('leaves keys typed into a Lens field, and the space bar, alone', async () => {
  mount();
  await openRunningTerminal();
  fireEvent.click(screen.getByRole('button', { name: 'Lens' }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Find' }), { key: 'a' });
  fireEvent.keyDown(document.body, { key: ' ' });
  expect(view()).toBe('lens');
  expect(terminal.write).not.toHaveBeenCalled();
});

it('does not start a CLI when a key is typed into a Lens with no terminal open', () => {
  mount();
  fireEvent.keyDown(document.body, { key: 'a' });
  expect(view()).toBeNull();
  expect(terminal.create).not.toHaveBeenCalled();
});

const prompt = (uuid: string, text: string): ChatMessage => ({
  uuid,
  role: 'user',
  timestamp: '2026-01-01T00:00:00.000Z',
  content: [{ type: 'text', text }],
});
const CHAT_KEY = ['sessions:chat', 'project-a', 'session-a.jsonl'];
// React Query tells its observers on a timer, not inside the call.
const setTranscript = (messages: ChatMessage[]) =>
  act(async () => {
    client.setQueryData(CHAT_KEY, messages);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

// The transcript the session opens with, read before the test moves it on.
async function mountWithTranscript(messages: ChatMessage[]) {
  bridge.api.sessions.getChat.mockResolvedValue(ok(messages));
  mount();
  await waitFor(() => expect(client.getQueryData(CHAT_KEY)).toEqual(messages));
}

it('returns to the Lens once a prompt sent with Enter lands in the transcript', async () => {
  await mountWithTranscript([prompt('p1', 'first')]);
  await openRunningTerminal();
  fireEvent.keyDown(document.querySelector('.xterm-helper-textarea')!, { key: 'Enter' });
  expect(view()).toBe('terminal');
  await setTranscript([prompt('p1', 'first'), prompt('p2', 'second')]);
  expect(view()).toBe('lens');
});

it('stays on the terminal when the transcript grows without an Enter there', async () => {
  await mountWithTranscript([prompt('p1', 'first')]);
  await openRunningTerminal();
  await setTranscript([prompt('p1', 'first'), prompt('p2', 'second')]);
  expect(view()).toBe('terminal');
});

it('stays on the terminal when Enter sent no prompt (a permission answered)', async () => {
  await mountWithTranscript([prompt('p1', 'first')]);
  await openRunningTerminal();
  fireEvent.keyDown(document.querySelector('.xterm-helper-textarea')!, { key: 'Enter' });
  await setTranscript([prompt('p1', 'first'), { ...prompt('a1', 'ok'), role: 'assistant' }]);
  expect(view()).toBe('terminal');
});

it('shows the terminal but drops a key typed into the Lens while the session waits', async () => {
  const waiting: ActiveSession = {
    pid: 9999,
    sessionId: 'session-a',
    cwd: '/elsewhere',
    status: 'waiting',
    waitingFor: 'permission prompt',
    source: 'registry',
  };
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([waiting]));
  mount();
  await waitFor(() => expect(client.getQueryData(['live:activeSessions'])).toEqual([waiting]));
  await openRunningTerminal();
  fireEvent.click(screen.getByRole('button', { name: 'Lens' }));
  fireEvent.keyDown(document.body, { key: 'y' });
  expect(view()).toBe('terminal');
  expect(terminal.write).not.toHaveBeenCalled();
});

const lensPane = () => screen.getByText(/Read-only transcript/).parentElement!;

it('fades in the view the user picks, and drops the fade when it ends', async () => {
  mount();
  await openRunningTerminal();
  toggle();
  expect(lensPane().classList.contains('cl-pane-enter')).toBe(true);
  // jsdom has no AnimationEvent, so React listens under the WebKit name.
  fireEvent(lensPane(), new Event('webkitAnimationEnd', { bubbles: true }));
  expect(lensPane().classList.contains('cl-pane-enter')).toBe(false);
});

it('switches without a fade when the user asks for less motion', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce'),
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  mount();
  await openRunningTerminal();
  toggle();
  expect(view()).toBe('lens');
  expect(lensPane().classList.contains('cl-pane-enter')).toBe(false);
});
