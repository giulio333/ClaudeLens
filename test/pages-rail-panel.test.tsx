// @vitest-environment jsdom
//
// The pages a session published, in Mission Control's rail. The claims: a
// session that published nothing has no Pages icon; one that did has the icon
// with its count, and no PAGES filter or row in the feed; the icon opens a
// panel that names the rail PAGES and lists each page once, newest first; a
// row opens the page in the browser; and Escape closes it, back to the icon.

import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ArtifactPublish, ChatMessage } from '../src/types';
import { ThemeContext } from '../src/hooks/useTheme';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

vi.mock('../src/components/project/chat/ChatView', () => ({
  ChatView: () => <div>Read-only transcript</div>,
}));

const ROOT = '/projects/acme';

/** One `Artifact` publish and its result, `minute` minutes into the session. */
function publish(id: string, minute: number, page: ArtifactPublish): ChatMessage[] {
  const at = (s: number) => `2026-10-05T10:${String(minute).padStart(2, '0')}:0${s}.000Z`;
  return [
    {
      uuid: `a-${id}`,
      role: 'assistant',
      timestamp: at(0),
      content: [{ type: 'tool_use', id, name: 'Artifact', input: { action: 'publish' } }],
    },
    {
      uuid: `u-${id}`,
      role: 'user',
      timestamp: at(1),
      content: [
        {
          type: 'tool_result',
          toolUseId: id,
          content: 'Published …',
          isError: false,
          artifact: page,
        },
      ],
    },
  ];
}

const CHECKLIST = {
  id: 'p1',
  url: 'https://claude.ai/artifact/AbCdEf',
  title: 'Release checklist',
};
const DIAGRAM = { id: 'p2', url: 'https://claude.ai/artifact/GhIjKl', title: 'Flow diagram' };

/** The checklist is created, the diagram after it, then the checklist again —
 *  so the checklist is the newest though it came first. */
const PUBLISHED: ChatMessage[] = [
  ...publish('t1', 1, { ...CHECKLIST, updated: false, seq: 1, audience: 'owner' }),
  ...publish('t2', 2, { ...DIAGRAM, updated: false, seq: 1, audience: 'users' }),
  ...publish('t3', 3, { ...CHECKLIST, updated: true, seq: 2, audience: 'owner' }),
];

const READ_ONLY: ChatMessage[] = [
  {
    uuid: 'a1',
    role: 'assistant',
    timestamp: '2026-10-05T10:00:00.000Z',
    content: [
      { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: `${ROOT}/README.md` } },
    ],
  },
  {
    uuid: 'u1',
    role: 'user',
    timestamp: '2026-10-05T10:00:01.000Z',
    content: [{ type: 'tool_result', toolUseId: 'r1', content: '1→# Acme', isError: false }],
  },
];

let bridge: FakeBridge;
let client: QueryClient;
let TerminalMissionControl: typeof import('../src/components/project/terminal/TerminalMissionControl').TerminalMissionControl;

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
  bridge.api.sessions.getChat.mockResolvedValue(ok(PUBLISHED));
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
    terminal: {
      create: vi.fn(async () => ok({ id: 'pty-1', pid: 1 })),
      write: vi.fn(async () => ok(null)),
      kill: vi.fn(async () => ok(null)),
      resize: vi.fn(async () => ok(null)),
      onData: () => () => {},
      onExit: () => () => {},
    },
  });
  Object.assign(bridge.api.memory, { getProject: vi.fn(async () => ok(null)) });
});

afterEach(() => {
  cleanup();
  client.clear();
  bridge.restore();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountMissionControl() {
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <ThemeContext.Provider
          value={{ preference: 'light', resolved: 'light', setPreference: vi.fn() }}
        >
          <TerminalMissionControl
            project={{ hash: 'project-a', realPath: ROOT }}
            resumeSessionId="session-a"
            onBack={vi.fn()}
          />
        </ThemeContext.Provider>
      </QueryClientProvider>
    </StrictMode>
  );
}

const pagesButton = () => screen.findByRole('button', { name: /^Pages/ });

it('offers no Pages icon to a session that published nothing', async () => {
  bridge.api.sessions.getChat.mockResolvedValue(ok(READ_ONLY));
  mountMissionControl();
  await screen.findByRole('button', { name: /^ALL/ });
  expect(screen.queryByRole('button', { name: /^Pages/ })).toBeNull();
});

it('counts the pages on the icon and keeps them out of the feed', async () => {
  mountMissionControl();
  const button = await pagesButton();
  // Three publishes, two pages.
  expect(button.getAttribute('aria-label')).toBe('Pages — 2 published');
  expect(screen.queryByRole('button', { name: /^PAGES/ })).toBeNull();
  expect(screen.queryByText('Release checklist')).toBeNull();
});

it('lists each page once, newest first, under a rail titled PAGES', async () => {
  mountMissionControl();
  fireEvent.click(await pagesButton());
  const region = await screen.findByRole('region', { name: 'Published pages' });
  expect(screen.getByText('PAGES')).toBeTruthy();
  const rows = within(region).getAllByRole('link');
  expect(rows.map(r => r.querySelector('.name')?.textContent)).toEqual([
    'Release checklist',
    'Flow diagram',
  ]);
  expect(rows[0].textContent).toContain('2 publishes · private');
  expect(rows[0].textContent).toContain('v2');
  expect(rows[1].textContent).toContain('created · shared');
});

it('opens a page in the browser, not in the app', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  mountMissionControl();
  fireEvent.click(await pagesButton());
  const region = await screen.findByRole('region', { name: 'Published pages' });
  fireEvent.click(within(region).getByRole('link', { name: /Flow diagram/ }));
  expect(open).toHaveBeenCalledWith(DIAGRAM.url, '_blank', 'noopener');
});

it('closes on Escape and hands the focus back to the icon', async () => {
  mountMissionControl();
  fireEvent.click(await pagesButton());
  const region = await screen.findByRole('region', { name: 'Published pages' });
  fireEvent.keyDown(region, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Published pages' })).toBeNull());
  expect(document.activeElement).toBe(await pagesButton());
  expect(screen.getByRole('button', { name: /^ALL/ })).toBeTruthy();
});
