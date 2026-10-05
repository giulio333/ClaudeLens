// @vitest-environment jsdom
//
// The project's files in Mission Control's rail. The claims: the folder icon
// opens the tree where the Playbook opens, and the two panels never share the
// rail; what this session read, edited or created is marked on its file and
// on every folder above it; a click opens the file in the frame's overlay,
// not in the rail; "This session" lists only the touched files; and a remote
// pane — whose folder is often the same path as a local one — offers nothing.

import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChatMessage, ProjectDirEntry } from '../src/types';
import { ThemeContext } from '../src/hooks/useTheme';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

vi.mock('../src/components/project/chat/ChatView', () => ({
  ChatView: () => <div>Read-only transcript</div>,
}));

const ROOT = '/projects/acme';

const file = (rel: string): ProjectDirEntry => {
  const name = rel.split('/').pop()!;
  return { name, rel, kind: 'file', ext: name.split('.').pop() ?? '', size: 10 };
};
const dir = (rel: string): ProjectDirEntry => ({
  name: rel.split('/').pop()!,
  rel,
  kind: 'dir',
  ext: '',
});
const TREE: Record<string, ProjectDirEntry[]> = {
  '': [dir('docs'), dir('lib'), dir('src'), file('README.md')],
  src: [file('src/main.ts')],
  docs: [file('docs/guide.md')],
};

/** One turn reads the README, the next edits src/main.ts. */
const CHAT: ChatMessage[] = [
  {
    uuid: 'a1',
    role: 'assistant',
    timestamp: '2026-10-05T10:00:00.000Z',
    content: [
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${ROOT}/README.md` } },
    ],
  },
  {
    uuid: 'u1',
    role: 'user',
    timestamp: '2026-10-05T10:00:01.000Z',
    content: [{ type: 'tool_result', toolUseId: 't1', content: '1→# Acme', isError: false }],
  },
  {
    uuid: 'a2',
    role: 'assistant',
    timestamp: '2026-10-05T10:00:02.000Z',
    content: [
      {
        type: 'tool_use',
        id: 't2',
        name: 'Edit',
        input: { file_path: `${ROOT}/src/main.ts`, old_string: 'a', new_string: 'b' },
      },
    ],
  },
  {
    uuid: 'u2',
    role: 'user',
    timestamp: '2026-10-05T10:00:03.000Z',
    content: [{ type: 'tool_result', toolUseId: 't2', content: 'updated', isError: false }],
  },
  {
    uuid: 'a3',
    role: 'assistant',
    timestamp: '2026-10-05T10:00:04.000Z',
    content: [
      {
        type: 'tool_use',
        id: 't3',
        name: 'Bash',
        input: { command: 'sed -n 1,20p docs/guide.md' },
      },
    ],
  },
  {
    uuid: 'u3',
    role: 'user',
    timestamp: '2026-10-05T10:00:05.000Z',
    content: [{ type: 'tool_result', toolUseId: 't3', content: '# Guide', isError: false }],
  },
];

let bridge: FakeBridge;
let client: QueryClient;
let TerminalMissionControl: typeof import('../src/components/project/terminal/TerminalMissionControl').TerminalMissionControl;
let MissionRail: typeof import('../src/components/project/terminal/MissionRail').MissionRail;

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
  ({ MissionRail } = await import('../src/components/project/terminal/MissionRail'));
  bridge = installFakeElectronAPI();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  bridge.api.sessions.getChat.mockResolvedValue(ok(CHAT));
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
  bridge.api.files.listDir.mockImplementation(async (_root: string, rel: string) =>
    ok({ entries: TREE[rel] ?? [], truncated: false })
  );
  bridge.api.files.readText.mockImplementation(async () =>
    ok({ status: 'ok' as const, text: 'const b = 1;\n', bytes: 13 })
  );
});

afterEach(() => {
  cleanup();
  client.clear();
  bridge.restore();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function wrap(node: React.ReactNode) {
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <ThemeContext.Provider
          value={{ preference: 'light', resolved: 'light', setPreference: vi.fn() }}
        >
          {node}
        </ThemeContext.Provider>
      </QueryClientProvider>
    </StrictMode>
  );
}

function mountMissionControl() {
  return wrap(
    <TerminalMissionControl
      project={{ hash: 'project-a', realPath: ROOT }}
      resumeSessionId="session-a"
      onBack={vi.fn()}
    />
  );
}

const panel = () => screen.findByRole('region', { name: 'Project files' });
const treeRow = (scope: HTMLElement, name: string) =>
  within(scope).findByRole('button', { name: new RegExp(`^${name}`) });

it('marks what the session touched on the file and on every folder above it', async () => {
  mountMissionControl();
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  const region = await panel();
  const mark = (row: HTMLElement) => row.querySelector('.cl-ftree-mark')?.textContent ?? null;
  const readme = await treeRow(region, 'README.md');
  await waitFor(() => expect(mark(readme)).toBe('read'));
  const src = await treeRow(region, 'src');
  expect(mark(src)).toBe('edited');
  expect(src.querySelector('.cl-ftree-mark.is-folder')).toBeTruthy();
  expect(mark(await treeRow(region, 'lib'))).toBeNull();
  // A shell read — `sed -n` — is a read like a `Read` call.
  const docs = await treeRow(region, 'docs');
  expect(mark(docs)).toBe('read');
  fireEvent.click(docs);
  expect(mark(await treeRow(region, 'guide.md'))).toBe('read');
  fireEvent.click(src);
  expect(mark(await treeRow(region, 'main.ts'))).toBe('edited');
});

it('opens a file in the overlay, over the session, not in the rail', async () => {
  mountMissionControl();
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  const region = await panel();
  fireEvent.click(await treeRow(region, 'README.md'));
  // The page says what this session did to the file, and the tree marks it open.
  await screen.findByText('1 line · 13 B · read in this session');
  expect(bridge.api.files.readText).toHaveBeenCalledWith(ROOT, 'README.md');
  expect(document.querySelector('.cl-files-rail .cl-fview')).toBeNull();
  expect((await treeRow(region, 'README.md')).getAttribute('aria-current')).toBe('true');
  // The page names the file and closes itself; the top bar repeats neither.
  expect(document.querySelector('.cl-stabs-crumb')).toBeNull();
  // The back arrow still walks out of the detail; there is no second ✕ beside it.
  expect(screen.getAllByRole('button', { name: 'Back to session' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(document.querySelector('.cl-fview')).toBeNull());
});

it('opens a changed file from its diff in the Files viewer', async () => {
  mountMissionControl();
  // The CHANGES row of the edit opens its diff, as before…
  const change = await screen.findByRole('button', { name: /main\.ts/ });
  fireEvent.click(change);
  const open = await screen.findByRole('button', { name: 'Open file' });
  expect(document.querySelector('.cl-file-change--page')).toBeTruthy();
  // …and the diff now leads to the file itself, as it is on disk.
  fireEvent.click(open);
  await waitFor(() => expect(document.querySelector('.cl-fview')).toBeTruthy());
  expect(bridge.api.files.readText).toHaveBeenCalledWith(ROOT, 'src/main.ts');
  expect(document.querySelector('.cl-file-change--page')).toBeNull();
});

it('lists only the touched files under "This session"', async () => {
  mountMissionControl();
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  const region = await panel();
  await treeRow(region, 'README.md');
  const mode = await within(region).findByRole('button', { name: /^This session/ });
  await waitFor(() => expect(mode.textContent).toBe('This session 3'));
  fireEvent.click(mode);
  const rows = [...region.querySelectorAll('.cl-files-touched-row')].map(r => r.textContent);
  expect(rows).toEqual(['guide.mddocsread', 'README.mdread', 'main.tssrcedited']);
});

it('never shows the files and the Playbook in the rail at once', async () => {
  mountMissionControl();
  expect(screen.getByText('MISSION CONTROL')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  await panel();
  // The open panel names the rail; it has no second title, and no ✕ of its own.
  expect(screen.getByText('FILES')).toBeTruthy();
  expect(screen.queryByText('MISSION CONTROL')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Close files' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Playbook' }));
  await screen.findByRole('region', { name: 'Prompt Playbook' });
  expect(screen.queryByRole('region', { name: 'Project files' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  await panel();
  expect(screen.queryByRole('region', { name: 'Prompt Playbook' })).toBeNull();
});

it('offers no files panel to a remote pane', async () => {
  wrap(
    <MissionRail
      hash="remote:host-1"
      sessionId="session-r"
      realPath={ROOT}
      width={380}
      onWidthChange={vi.fn()}
      onOpenTool={vi.fn()}
      onOpenChange={vi.fn()}
      onOpenAgent={vi.fn()}
      onOpenSkillDef={vi.fn()}
      onOpenAgentDef={vi.fn()}
      onOpenTeam={vi.fn()}
      onLocateTurn={vi.fn()}
      onUsePrompt={vi.fn(async () => {})}
      onOpenFile={vi.fn()}
      remote={{ hostName: 'devbox', messages: CHAT, status: 'idle', summary: null }}
    />
  );
  await screen.findByText('MISSION CONTROL');
  expect(screen.queryByRole('button', { name: 'Files' })).toBeNull();
  expect(bridge.api.files.listDir).not.toHaveBeenCalled();
});
