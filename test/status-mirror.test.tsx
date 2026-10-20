// @vitest-environment jsdom
//
// What the menu bar and the Dock are told: every open session as its tab draws
// it, once the preferences are read, nothing at all while the switch is off,
// and null when the shell goes away. A menu bar row brings its tab back; one
// that is no longer open is ignored. What main does with it is
// `status-surface.test.ts`.
import { StrictMode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ActiveSession } from '../src/types';
import type { StatusSummary } from '../electron/shared/status-surface';
import type {
  InstanceReport,
  TerminalInstance,
} from '../src/components/project/terminal/terminal-instances';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

const ACME = { hash: '-synthetic-acme', realPath: '/synthetic/acme' };

let bridge: FakeBridge;
let client: QueryClient;
let StatusMirror: typeof import('../src/components/project/terminal/StatusMirror').StatusMirror;
let TabAttentionProvider: typeof import('../src/components/project/terminal/TabAttentionProvider').TabAttentionProvider;

function tab(id: string, report: Partial<InstanceReport>): TerminalInstance {
  return {
    id,
    view: { type: 'terminal', project: ACME },
    report: {
      pid: null,
      sessionId: null,
      title: null,
      color: null,
      termStatus: 'running',
      gitBranch: null,
      ...report,
    },
  };
}

const entry = (pid: number, patch: Partial<ActiveSession>): ActiveSession => ({
  pid,
  sessionId: `session-${pid}`,
  cwd: ACME.realPath,
  status: 'idle',
  source: 'registry',
  ...patch,
});

const INSTANCES = [
  tab('t1', { pid: 2, title: 'Fix the build' }),
  tab('t2', { pid: 3, title: 'Write the docs' }),
];

beforeEach(async () => {
  ({ StatusMirror } = await import('../src/components/project/terminal/StatusMirror'));
  ({ TabAttentionProvider } =
    await import('../src/components/project/terminal/TabAttentionProvider'));
  bridge = installFakeElectronAPI();
  bridge.api.live.getActiveSessions.mockResolvedValue(
    ok([entry(2, { status: 'busy' }), entry(3, { status: 'waiting', waitingFor: 'input needed' })])
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  bridge.restore();
  vi.restoreAllMocks();
});

function mount(onRestore = vi.fn()) {
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <TabAttentionProvider instances={INSTANCES} currentId="t1">
          <StatusMirror instances={INSTANCES} onRestore={onRestore} />
        </TabAttentionProvider>
      </QueryClientProvider>
    </StrictMode>
  );
  return { ...view, onRestore };
}

const sent = () => bridge.api.notifications.setStatus.mock.calls.map(([s]) => s);
const lastSent = () => sent()[sent().length - 1];

const EXPECTED: StatusSummary = {
  rows: [
    {
      id: 't1',
      title: 'Fix the build',
      project: 'acme',
      tone: 'busy',
      question: false,
      unseen: false,
    },
    {
      id: 't2',
      title: 'Write the docs',
      project: 'acme',
      tone: 'waiting',
      question: true,
      unseen: false,
    },
  ],
};

it('tells main every open session as its tab draws it, once the preferences are read', async () => {
  mount();
  await waitFor(() => expect(lastSent()).toEqual(EXPECTED));
  // Before the switch is known, nothing is shown.
  expect(sent()[0]).toBeNull();
});

it('sends nothing to show while the switch is off', async () => {
  bridge.api.prefs.getAll.mockResolvedValue(ok({ 'cl-status-surface': false }));
  mount();
  await waitFor(() => expect(client.getQueryData(['prefs:notify'])).toBeDefined());
  await waitFor(() => expect(client.getQueryData(['live:activeSessions'])).toBeDefined());
  expect(sent().length).toBeGreaterThan(0);
  expect(sent().every(s => s === null)).toBe(true);
});

it('says it again only when something changed', async () => {
  mount();
  await waitFor(() => expect(lastSent()).toEqual(EXPECTED));
  const calls = sent().length;
  // A new reading with the same states: new objects, same summary.
  act(() =>
    bridge.channels.activeSessions.emit([
      entry(2, { status: 'busy' }),
      entry(3, { status: 'waiting', waitingFor: 'input needed' }),
    ])
  );
  expect(sent()).toHaveLength(calls);
  act(() =>
    bridge.channels.activeSessions.emit([
      entry(2, { status: 'idle' }),
      entry(3, { status: 'waiting', waitingFor: 'input needed' }),
    ])
  );
  await waitFor(() => expect(lastSent()?.rows[0].tone).toBe('idle'));
});

it('brings back the tab a menu bar row names, and ignores one no longer open', async () => {
  const { onRestore } = mount();
  await waitFor(() => expect(lastSent()).toEqual(EXPECTED));
  act(() => bridge.channels.restoreSession.emit('t2'));
  expect(onRestore).toHaveBeenCalledWith('t2');
  act(() => bridge.channels.restoreSession.emit('t9'));
  expect(onRestore).toHaveBeenCalledTimes(1);
});

it('clears the menu bar and the Dock, and stops listening, when it goes away', async () => {
  const { unmount } = mount();
  await waitFor(() => expect(lastSent()).toEqual(EXPECTED));
  unmount();
  expect(lastSent()).toBeNull();
  expect(bridge.channels.restoreSession.listenerCount).toBe(0);
});
