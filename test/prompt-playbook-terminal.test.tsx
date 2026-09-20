// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TeamSummary } from '../src/types';
import { ThemeContext } from '../src/hooks/useTheme';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

// Keep the real rail, playbook, terminal and xterm parser in this integration.
vi.mock('../src/components/project/chat/ChatView', () => ({
  ChatView: () => <div>Read-only transcript</div>,
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

it('opens Terminal from Lens, waits for CLI readiness and pastes once without submitting', async () => {
  mount();
  expect(screen.getByText('Read-only transcript')).toBeTruthy();
  expect(terminal.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Playbook' }));
  await screen.findByText('Review');
  expect(terminal.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use' }));
  await waitFor(() => expect(terminal.create).toHaveBeenCalledTimes(2));
  expect(localStorage.getItem('tmc-view')).toBe('terminal');
  expect(terminal.write).not.toHaveBeenCalled();
  act(() => dataListeners.forEach(listener => listener('pty-2', '\x1b[?2004h')));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Prompt Playbook' })).toBeNull());
  expect(terminal.write).toHaveBeenCalledExactlyOnceWith(
    'pty-2',
    '\x1b[200~Check the changes.\rPreserve existing behavior.\x1b[201~'
  );
  expect(bridge.api.sessions.sendMessage).not.toHaveBeenCalled();
  expect(bridge.api.sessions.startMessage).not.toHaveBeenCalled();
});

it('cancels insertion if the session view closes before the terminal is ready', async () => {
  const { unmount } = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Playbook' }));
  await screen.findByText('Review');
  fireEvent.click(screen.getByRole('button', { name: 'Use' }));
  await waitFor(() => expect(terminal.create).toHaveBeenCalledTimes(2));
  unmount();
  await act(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  expect(terminal.write).not.toHaveBeenCalled();
  expect(dataListeners.size).toBe(0);
});

it.each(['before the frame', 'while waiting for readiness'])(
  'cancels a return to Lens %s',
  async phase => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Playbook' }));
    await screen.findByText('Review');
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    if (phase === 'while waiting for readiness') {
      await act(async () => {
        await new Promise(resolve => requestAnimationFrame(resolve));
      });
    }
    fireEvent.click(screen.getByRole('button', { name: /LENS/ }));
    act(() => dataListeners.forEach(listener => listener('pty-2', '\x1b[?2004h')));
    await act(async () => {
      await new Promise(resolve => requestAnimationFrame(resolve));
    });
    expect(localStorage.getItem('tmc-view')).toBe('lens');
    expect(terminal.write).not.toHaveBeenCalled();
  }
);

it('supersedes an earlier insertion when the playbook is closed and reopened', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Playbook' }));
  await screen.findByText('Review');
  fireEvent.click(screen.getByRole('button', { name: 'Use' }));
  await act(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  fireEvent.click(screen.getByRole('button', { name: 'Playbook' }));
  fireEvent.click(screen.getByRole('button', { name: 'Playbook' }));
  await screen.findByText('Review');
  fireEvent.click(screen.getByRole('button', { name: 'Use' }));
  await act(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
  });
  act(() => dataListeners.forEach(listener => listener('pty-2', '\x1b[?2004h')));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Prompt Playbook' })).toBeNull());
  expect(terminal.write).toHaveBeenCalledExactlyOnceWith(
    'pty-2',
    '\x1b[200~Check the changes.\rPreserve existing behavior.\x1b[201~'
  );
});

it('opens inside the rail on demand and restores the activity filter and focus', async () => {
  mount();
  await act(async () => {
    client.setQueryData<TeamSummary[]>(
      ['teams:project', 'project-a'],
      [
        {
          teamName: 'review',
          displayName: 'Review team',
          sessionId: 'other-session',
          filename: 'other-session.jsonl',
          sessionIds: ['other-session'],
          createdAt: 1,
          lastActivity: 1,
          hasConfig: false,
          memberCount: 0,
          memberNames: [],
          memberColors: [],
          transcriptCount: 0,
          memberTokens: [],
          totalTokens: 0,
          messageCount: 0,
          leadSessionIdFromConfig: null,
        },
      ]
    );
  });
  const teams = await screen.findByRole('button', { name: /TEAMS/ });
  fireEvent.click(teams);
  expect(teams.getAttribute('aria-pressed')).toBe('true');
  expect(bridge.api.playbook.getCandidates).not.toHaveBeenCalled();
  const trigger = screen.getByRole('button', { name: 'Playbook' });
  fireEvent.click(trigger);
  await screen.findByText('Review');
  const panel = screen.getByRole('region', { name: 'Prompt Playbook' });
  expect(panel.closest('aside')).toBe(trigger.closest('aside'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: /TEAMS/ })).toBeNull();
  // Working in the transcript must not dismiss the side panel or consume Escape.
  const transcript = screen.getByText('Read-only transcript');
  fireEvent.pointerDown(transcript);
  expect(fireEvent.keyDown(transcript, { key: 'Escape' })).toBe(true);
  expect(screen.getByRole('region', { name: 'Prompt Playbook' })).toBe(panel);
  fireEvent.click(screen.getByRole('button', { name: 'Back to activity' }));
  expect(screen.getByRole('button', { name: /TEAMS/ }).getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('region', { name: 'Prompt Playbook' }), { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Prompt Playbook' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(
    client
      .getQueryCache()
      .getAll()
      .filter(query => query.state.status === 'error')
  ).toEqual([]);
});
