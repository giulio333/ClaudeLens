// @vitest-environment jsdom
//
// The Notebook page, mounted the way `main.tsx` does (inside StrictMode). The
// derivations are pinned in `notebook.test.ts`; what only this side proves is
// the join of its sources — the registry, the tail digest, the transcript and
// the task files — and that a session is read, not a project guessed.

import { StrictMode, createElement, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { NotebookView } from '../src/components/project/notebook/NotebookView';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';
import type { ChatMessage } from '../electron/shared/chat-types';
import type { ActiveSession, SessionActivity, TaskGroup } from '../src/types';

const PROJECT = { hash: '-p-acme', realPath: '/p/acme' };

function session(over: Partial<ActiveSession> = {}): ActiveSession {
  return {
    pid: 4242,
    sessionId: 's1',
    cwd: PROJECT.realPath,
    status: 'busy',
    startedAt: Date.now() - 60_000,
    source: 'registry',
    ...over,
  };
}

function activity(over: Partial<SessionActivity> = {}): SessionActivity {
  return {
    sessionId: 's1',
    title: 'Fix the stale badge',
    titleSource: 'ai',
    cwd: PROJECT.realPath,
    transcriptPath: null,
    activity: 'busy',
    lastTool: { name: 'Edit', arg: '…/src/a.ts' },
    delegates: [],
    lastActivityAt: Date.now(),
    toolCount: 4,
    errorCount: 1,
    model: 'claude-opus-5',
    context: { used: 80_000, max: 200_000 },
    spend: 1.5,
    spendEstimated: false,
    tokens: 120_000,
    recent: [],
    endedAt: null,
    ...over,
  };
}

/** One assistant turn with a tool_use, and the user turn carrying its result. */
function turns(
  calls: { id: string; name: string; input: Record<string, unknown>; isError?: boolean }[]
): ChatMessage[] {
  return calls.flatMap((c, i) => [
    {
      uuid: `a${i}`,
      role: 'assistant',
      timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      model: 'claude-opus-5',
      content: [{ type: 'tool_use', id: c.id, name: c.name, input: c.input }],
    },
    {
      uuid: `u${i}`,
      role: 'user',
      timestamp: new Date(1_700_000_000_500 + i * 1000).toISOString(),
      content: [{ type: 'tool_result', toolUseId: c.id, content: '', isError: !!c.isError }],
    },
  ]) as unknown as ChatMessage[];
}

let bridge: FakeBridge;
let queryClient: QueryClient;

beforeEach(() => {
  bridge = installFakeElectronAPI();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  bridge.api.memory.listProjects.mockResolvedValue(ok([PROJECT]));
});

afterEach(() => {
  cleanup();
  bridge.restore();
});

function mount() {
  return render(
    createElement(
      StrictMode,
      null,
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(NotebookView, { onBack: () => {} })
      )
    ) as ReactNode
  );
}

describe('NotebookView', () => {
  it('reads the session: its sentence, its plan, its diff and its checks', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([session()]));
    bridge.api.live.getActivity.mockResolvedValue(ok([activity()]));
    bridge.api.sessions.getChat.mockResolvedValue(
      ok(
        turns([
          { id: 'c1', name: 'Bash', input: { command: 'npm run typecheck' }, isError: true },
          {
            id: 'c2',
            name: 'Edit',
            input: { file_path: '/p/acme/src/a.ts', old_string: 'a', new_string: 'b\nc' },
          },
        ])
      )
    );
    const groups: TaskGroup[] = [
      {
        sessionId: 's1',
        filename: 's1',
        tasks: [
          {
            id: '1',
            subject: 'Read the code',
            description: '',
            status: 'completed',
            blocks: [],
            blockedBy: [],
          },
          {
            id: '2',
            subject: 'Fix the badge',
            description: '',
            status: 'in_progress',
            activeForm: 'Fixing the badge',
            blocks: [],
            blockedBy: [],
          },
        ],
      },
    ];
    bridge.api.tasks.getByProject.mockResolvedValue(ok(groups));
    mount();

    // The sentence names the file the call in flight acts on…
    expect(await screen.findByText('a.ts', { selector: 'h1 code' })).toBeTruthy();
    // …the task's own words say where the plan is…
    expect(await screen.findByText('Fixing the badge')).toBeTruthy();
    // …the diff row and the failed check come from the transcript.
    expect(screen.getByTitle('npm run typecheck')).toBeTruthy();
    expect(screen.getByText('fails')).toBeTruthy();
    expect(screen.getAllByText('a.ts').length).toBeGreaterThan(1);
  });

  it('shows a session waiting on you with the registry’s words and no invented question', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([
        session({
          status: 'waiting',
          waitingFor: 'permission prompt',
          statusUpdatedAt: Date.now() - 42_000,
        }),
      ])
    );
    bridge.api.live.getActivity.mockResolvedValue(ok([activity({ lastTool: null })]));
    mount();

    expect(await screen.findByText('Waiting for you')).toBeTruthy();
    expect(screen.getByText('permission prompt')).toBeTruthy();
    expect(screen.getByText('you have been the bottleneck')).toBeTruthy();
  });

  // Absent is not zero: a registry entry with no stamp cannot date the wait.
  it('prints no wait clock when the registry carries no stamp for the transition', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([session({ status: 'waiting', waitingFor: 'permission prompt' })])
    );
    bridge.api.live.getActivity.mockResolvedValue(ok([activity({ lastTool: null })]));
    mount();

    await screen.findByText('Waiting for you');
    expect(screen.queryByText('you have been the bottleneck')).toBeNull();
  });

  it('keeps a session the registry dropped, as ended', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([]));
    bridge.api.live.getActivity.mockResolvedValue(ok([activity({ endedAt: Date.now() })]));
    mount();

    expect(await screen.findByText('Session ended')).toBeTruthy();
  });

  it('lets you switch between two sessions without reading the other one’s transcript', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([session({ sessionId: 's1' }), session({ sessionId: 's2', pid: 7 })])
    );
    bridge.api.live.getActivity.mockResolvedValue(
      ok([
        activity({ sessionId: 's1', title: 'First one' }),
        activity({ sessionId: 's2', title: 'Second one' }),
      ])
    );
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Second one/ }));

    await screen.findByText('Second one', { selector: 'p' });
    expect(bridge.api.sessions.getChat).toHaveBeenCalledWith(PROJECT.hash, 's2.jsonl');
  });

  it('says so, instead of guessing, when the session belongs to no known project', async () => {
    bridge.api.memory.listProjects.mockResolvedValue(ok([]));
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([session()]));
    bridge.api.live.getActivity.mockResolvedValue(ok([activity()]));
    mount();

    expect(await screen.findByText(/not one of your projects/)).toBeTruthy();
    expect(vi.mocked(bridge.api.sessions.getChat)).not.toHaveBeenCalled();
  });

  it('leaves no listener behind once unmounted', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([session()]));
    bridge.api.live.getActivity.mockResolvedValue(ok([activity()]));
    const view = mount();
    await screen.findByText('Waiting for you', {}, { timeout: 50 }).catch(() => null);
    view.unmount();
    expect(bridge.channels.activeSessions.listenerCount).toBe(0);
    expect(bridge.channels.sessionActivity.listenerCount).toBe(0);
  });
});
