// @vitest-environment jsdom
//
// The session rows of the project landing and the Sessions view. The model
// line always stays: a live row whose registry status claims something adds
// what the session is doing BESIDE the model, never in its place, and an idle
// live row claims nothing. The rows read the registry and the tail digest once,
// for the whole list, and give both subscriptions back when they unmount.
import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ActiveSession, SessionActivity, SessionSummary } from '../src/types';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

let bridge: FakeBridge;
let client: QueryClient;
let SessionRows: typeof import('../src/components/project/overview/ProjectOverviewContent').SessionRows;

beforeEach(async () => {
  ({ SessionRows } = await import('../src/components/project/overview/ProjectOverviewContent'));
  bridge = installFakeElectronAPI();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  bridge.restore();
  vi.restoreAllMocks();
});

function session(id: string, title: string): SessionSummary {
  return {
    filename: `${id}.jsonl`,
    date: new Date().toISOString(),
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 129_000,
    estimatedCost: 0,
    cacheSavings: 0,
    messageCount: 102,
    model: 'claude-opus-4-5',
    models: {},
    customTitle: title,
  };
}

const entry = (sessionId: string, status: string): ActiveSession => ({
  pid: 7,
  sessionId,
  cwd: '/synthetic/acme',
  status,
  source: 'registry',
});

const digest = (sessionId: string): SessionActivity => ({
  sessionId,
  title: null,
  titleSource: null,
  transcriptPath: null,
  activity: 'busy',
  lastTool: { name: 'Edit', arg: 'session-reader.ts' },
  delegates: [],
  lastActivityAt: null,
  toolCount: 1,
  errorCount: 0,
  model: null,
  context: null,
  spend: null,
  spendEstimated: false,
  tokens: 0,
  cwd: null,
  recent: [],
  endedAt: null,
});

function mount(sessions: SessionSummary[]) {
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <SessionRows
          sessions={sessions}
          projectHash="-synthetic-acme"
          cleanupDays={30}
          onOpen={vi.fn()}
          onOpenChat={vi.fn()}
        />
      </QueryClientProvider>
    </StrictMode>
  );
}

it('keeps the model beside what a busy live session is doing', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([entry('busy-one', 'busy')]));
  bridge.api.live.getActivity.mockResolvedValue(ok([digest('busy-one')]));
  mount([session('busy-one', 'Refactor the parser')]);
  await waitFor(() => expect(screen.getByText('Edit · session-reader.ts')).toBeTruthy());
  expect(screen.getByText('Opus 4.5')).toBeTruthy();
  expect(screen.getByText('129k tok')).toBeTruthy();
  expect(screen.getByText('102 msg')).toBeTruthy();
});

it('claims nothing for a live session that is idle, even with a tool in its tail', async () => {
  bridge.api.live.getActiveSessions.mockResolvedValue(ok([entry('idle-one', 'idle')]));
  bridge.api.live.getActivity.mockResolvedValue(ok([digest('idle-one')]));
  mount([session('idle-one', 'Write the docs')]);
  await waitFor(() => expect(screen.getByText('live')).toBeTruthy());
  expect(screen.getByText('Opus 4.5')).toBeTruthy();
  expect(screen.queryByText(/session-reader\.ts/)).toBeNull();
});

it('gives back both live subscriptions when the list unmounts', async () => {
  const view = mount([session('a', 'Anything')]);
  await waitFor(() => expect(bridge.channels.sessionActivity.listenerCount).toBeGreaterThan(0));
  expect(bridge.channels.activeSessions.listenerCount).toBeGreaterThan(0);
  view.unmount();
  expect(bridge.channels.sessionActivity.listenerCount).toBe(0);
  expect(bridge.channels.activeSessions.listenerCount).toBe(0);
});
