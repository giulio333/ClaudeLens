// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeContext } from '../src/hooks/useTheme';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

// The real rail and notes panel inside Mission Control; only the transcript is stubbed.
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

const STORED = 'Fold the vitals first\n- [x] write the hook\n- [ ] use it in the pill\n';

function badge() {
  return screen.getByRole('button', { name: /^Notes/ });
}

it('shows the to-do progress on the closed trigger and follows a tick as it happens', async () => {
  bridge.api.notes.get.mockResolvedValue(ok(STORED));
  mount();
  await waitFor(() =>
    expect(badge().getAttribute('aria-label')).toBe('Notes — 1 of 2 to-dos done')
  );
  expect(badge().textContent).toContain('1/2');
  expect(bridge.api.notes.get).toHaveBeenCalledWith('session-a');

  fireEvent.click(badge());
  const panel = await screen.findByRole('region', { name: 'Session notes' });
  expect(badge().textContent).not.toContain('1/2');
  expect(within(panel).getByDisplayValue('Fold the vitals first')).toBeTruthy();
  fireEvent.click(within(panel).getByRole('checkbox', { name: 'use it in the pill' }));
  expect(within(panel).getByText('2/2 done')).toBeTruthy();

  fireEvent.click(badge());
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Session notes' })).toBeNull());
  expect(badge().getAttribute('aria-label')).toBe('Notes — All 2 to-dos done');
  expect(badge().textContent).toContain('✓');
  await waitFor(() =>
    expect(bridge.api.notes.save).toHaveBeenLastCalledWith(
      'session-a',
      'Fold the vitals first\n- [x] write the hook\n- [x] use it in the pill\n'
    )
  );
});

it('turns a typed [] into a to-do and saves the sheet after a pause', async () => {
  mount();
  await waitFor(() => expect(bridge.api.notes.get).toHaveBeenCalled());
  expect(badge().querySelector('.cl-notes-badge')).toBeNull();
  fireEvent.click(badge());
  const panel = await screen.findByRole('region', { name: 'Session notes' });
  const line = within(panel).getByPlaceholderText('Notes for this session…');
  fireEvent.change(line, { target: { value: '[] check the Windows host' } });
  const todo = within(panel).getByRole('checkbox', { name: 'check the Windows host' });
  expect(todo.getAttribute('aria-checked')).toBe('false');
  expect(bridge.api.notes.save).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(bridge.api.notes.save).toHaveBeenCalledWith(
      'session-a',
      '- [ ] check the Windows host\n'
    )
  );
});

it('puts a line into the terminal input without sending it', async () => {
  bridge.api.notes.get.mockResolvedValue(ok('- [ ] Rename ctxDanger\n'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /^Notes/ }));
  const panel = await screen.findByRole('region', { name: 'Session notes' });
  fireEvent.click(await within(panel).findByRole('button', { name: '→ prompt' }));
  await waitFor(() => expect(terminal.create).toHaveBeenCalledTimes(2));
  act(() => dataListeners.forEach(listener => listener('pty-2', '\x1b[?2004h')));
  await waitFor(() =>
    expect(terminal.write).toHaveBeenCalledExactlyOnceWith(
      'pty-2',
      '\x1b[200~Rename ctxDanger\x1b[201~'
    )
  );
  expect(bridge.api.sessions.sendMessage).not.toHaveBeenCalled();
});

it('closes the notes on Esc without closing an overlay open beside them', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /^Notes/ }));
  const panel = await screen.findByRole('region', { name: 'Session notes' });
  const closeOverlay = vi.fn();
  window.addEventListener('keydown', closeOverlay);
  fireEvent.keyDown(within(panel).getByPlaceholderText('Notes for this session…'), {
    key: 'Escape',
  });
  window.removeEventListener('keydown', closeOverlay);
  expect(screen.queryByRole('region', { name: 'Session notes' })).toBeNull();
  expect(closeOverlay).not.toHaveBeenCalled();
});

it('switches the line under the caret between text, to-do and list from the toolbar', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /^Notes/ }));
  const panel = await screen.findByRole('region', { name: 'Session notes' });
  const line = within(panel).getByPlaceholderText('Notes for this session…');
  fireEvent.change(line, { target: { value: 'ship it' } });
  const kinds = within(panel).getByRole('group', { name: 'Line type' });
  expect(within(kinds).getByRole('button', { name: 'Text' }).getAttribute('aria-pressed')).toBe(
    'true'
  );
  fireEvent.click(within(kinds).getByRole('button', { name: 'List' }));
  expect(within(kinds).getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe(
    'true'
  );
  fireEvent.click(within(kinds).getByRole('button', { name: 'To-do' }));
  expect(within(panel).getByRole('checkbox', { name: 'ship it' })).toBeTruthy();
  await waitFor(() =>
    expect(bridge.api.notes.save).toHaveBeenLastCalledWith('session-a', '- [ ] ship it\n')
  );
});

it('pastes a list copied from the Lens as list lines', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /^Notes/ }));
  const panel = await screen.findByRole('region', { name: 'Session notes' });
  const line = within(panel).getByPlaceholderText('Notes for this session…');
  const data: Record<string, string> = {
    'text/html': '<ol><li>Prerequisites and firewall.</li><li>TLS certificates.</li></ol>',
    'text/plain': 'Prerequisites and firewall.\nTLS certificates.',
  };
  fireEvent.paste(line, { clipboardData: { getData: (type: string) => data[type] ?? '' } });
  await waitFor(() =>
    expect(bridge.api.notes.save).toHaveBeenLastCalledWith(
      'session-a',
      '- Prerequisites and firewall.\n- TLS certificates.\n'
    )
  );
});

it('clears the whole sheet at once and brings it back with Undo', async () => {
  bridge.api.notes.get.mockResolvedValue(ok(STORED));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /^Notes/ }));
  const panel = await screen.findByRole('region', { name: 'Session notes' });
  fireEvent.click(within(panel).getByRole('button', { name: 'Clear all notes' }));
  expect(within(panel).queryByDisplayValue('Fold the vitals first')).toBeNull();
  await waitFor(() => expect(bridge.api.notes.save).toHaveBeenLastCalledWith('session-a', ''));
  fireEvent.click(within(panel).getByRole('button', { name: 'Undo' }));
  expect(within(panel).getByDisplayValue('Fold the vitals first')).toBeTruthy();
  await waitFor(() => expect(bridge.api.notes.save).toHaveBeenLastCalledWith('session-a', STORED));
});
