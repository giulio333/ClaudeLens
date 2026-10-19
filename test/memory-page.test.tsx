// @vitest-environment jsdom
//
// A memory row of Mission Control's rail opens the topic on the Files page —
// the same page a project file opens on — and not the tool call that wrote it.
// The claims: the page is read from the memory reader (the history folder is
// not a project root `files:readText` may read), its document reading leaves
// the frontmatter to Source, a `[[link]]` in it is not drawn as a missing
// project file, and a topic no longer there falls back to the operation.

import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, MemoryData } from '../src/types';
import { ThemeContext } from '../src/hooks/useTheme';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';
import { memoryTopicSource, memoryTopicText } from '../src/components/project/files/file-viewer';

vi.mock('../src/components/project/chat/ChatView', () => ({
  ChatView: () => <div>Read-only transcript</div>,
}));

const ROOT = '/projects/acme';
const TOPIC = '/home/u/.claude/projects/project-a/memory/first-topic.md';
const CONTENT = [
  '---',
  'name: first-topic',
  'description: a fact worth keeping',
  'metadata:',
  '  type: project',
  '---',
  '',
  '# Heading of the topic',
  '',
  'See [[second-topic]].',
  '',
].join('\n');

const CHAT: ChatMessage[] = [
  {
    uuid: 'a1',
    role: 'assistant',
    timestamp: '2026-10-05T10:00:00.000Z',
    content: [
      { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: TOPIC, content: CONTENT } },
    ],
  },
  {
    uuid: 'u1',
    role: 'user',
    timestamp: '2026-10-05T10:00:01.000Z',
    content: [
      {
        type: 'tool_result',
        toolUseId: 't1',
        content: `File created successfully at: ${TOPIC}`,
        isError: false,
      },
    ],
  },
];

const memoryData = (topics: Record<string, string>): MemoryData => ({
  index: [],
  topics,
  memoryMd: null,
  projectLevelIndex: [],
  projectLevelTopics: {},
  projectLevelMemoryMd: null,
});

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
  Object.assign(bridge.api.memory, {
    getProject: vi.fn(async () => ok(memoryData({ 'first-topic.md': CONTENT }))),
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

/** The rail's row for the topic: the one button in the rail that names it. */
const memoryRow = async () => {
  const rail = await waitFor(() => {
    const el = document.querySelector('aside');
    if (!el) throw new Error('no rail yet');
    return el;
  });
  return waitFor(() => {
    const row = [...rail.querySelectorAll('button')].find(b =>
      b.textContent?.includes('first-topic')
    );
    if (!row) throw new Error('no memory row yet');
    return row;
  });
};

describe('a memory row of the rail', () => {
  it('opens the topic on the Files page, frontmatter left to Source', async () => {
    mountMissionControl();
    fireEvent.click(await memoryRow());
    await screen.findByRole('heading', { name: 'Heading of the topic' });
    const page = document.querySelector('.cl-fview')!;
    expect(page.querySelector('.cl-fview-name')?.textContent).toBe('first-topic.md');
    expect(page.textContent).not.toContain('description: a fact worth keeping');
    // …and reads it as properties: the description as the lead, the type tinted.
    expect(page.querySelector('.cl-fview-fm-lead')?.textContent).toBe('a fact worth keeping');
    expect(page.querySelector('.cl-fview-fm-type')?.textContent).toBe('project');
    // A topic's [[link]] names another topic: not a project file, so no chip.
    expect(page.querySelector('.cl-wikilink')).toBeNull();
    expect(bridge.api.files.readText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    await waitFor(() =>
      expect(document.querySelector('.cl-fview')!.textContent).toContain(
        'description: a fact worth keeping'
      )
    );
  });

  it('falls back to the operation when the topic is no longer there', async () => {
    Object.assign(bridge.api.memory, { getProject: vi.fn(async () => ok(memoryData({}))) });
    mountMissionControl();
    fireEvent.click(await memoryRow());
    // The Write that made it, as its own page: not the topic's page.
    await screen.findByRole('heading', { name: 'Heading of the topic' });
    expect(document.querySelector('.cl-term-page')).toBeTruthy();
    expect(document.querySelector('.cl-fview-fm')).toBeNull();
  });
});

describe('the operations under a memory row', () => {
  /** The topic written, then edited, then read back. */
  const LATER: ChatMessage[] = [
    {
      uuid: 'a2',
      role: 'assistant',
      timestamp: '2026-10-05T10:00:02.000Z',
      content: [
        {
          type: 'tool_use',
          id: 't2',
          name: 'Edit',
          input: { file_path: TOPIC, old_string: 'See', new_string: 'Read' },
        },
        { type: 'tool_use', id: 't3', name: 'Read', input: { file_path: TOPIC } },
      ],
    },
    {
      uuid: 'u2',
      role: 'user',
      timestamp: '2026-10-05T10:00:03.000Z',
      content: [
        { type: 'tool_result', toolUseId: 't2', content: 'updated', isError: false },
        { type: 'tool_result', toolUseId: 't3', content: '1\t---', isError: false },
      ],
    },
  ];

  it('open an edit of the topic as its change, a read as the call', async () => {
    bridge.api.sessions.getChat.mockResolvedValue(ok([...CHAT, ...LATER]));
    mountMissionControl();
    fireEvent.click(await memoryRow());
    // The row opened the topic and its operations under it.
    const edit = await screen.findByRole('button', { name: /^Edit/ });
    fireEvent.click(edit);
    await waitFor(() => expect(document.querySelector('.cl-file-change--page')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Read/ }));
    await waitFor(() => expect(document.querySelector('.cl-file-change--page')).toBeNull());
    // A second click on the row folds its operations again.
    fireEvent.click(await memoryRow());
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull());
  });
});

describe('where a topic is read from', () => {
  it('a user-level topic from the project in its path, which may be another one', () => {
    expect(memoryTopicSource('/h/.claude/projects/other/memory/a.md', 'mine')).toEqual({
      hash: 'other',
      level: 'user',
    });
    expect(memoryTopicSource('/repo/.claude/memory/a.md', 'mine')).toEqual({
      hash: 'mine',
      level: 'project',
    });
    expect(memoryTopicSource('/repo/src/a.md', 'mine')).toBeNull();
  });

  it('a topic the index points at by path is found by its file name', () => {
    const data = memoryData({ 'nested/a.md': 'A' });
    expect(memoryTopicText(data, '/h/.claude/projects/p/memory/nested/a.md', 'user')).toBe('A');
    expect(memoryTopicText(data, '/h/.claude/projects/p/memory/b.md', 'user')).toBeNull();
  });
});
