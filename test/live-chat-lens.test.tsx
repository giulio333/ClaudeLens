// @vitest-environment jsdom
//
// The SDK chat reads like the Lens (#304). The same conversation the Lens
// draws from disk is drawn here from the stream, by the same column: a
// tool-only Edit folds into the turn before it with its diff at the foot, a
// skill run opens over the conversation, the reply being streamed sits under
// the list rather than in it, and the pill states spend only once the session
// has a row to read it from. A detail never hides an approval, and never costs
// the user what they were typing.

import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeContext } from '../src/hooks/useTheme';
import { LiveChatView } from '../src/components/project/chat/LiveChatView';
import type { ActiveSession, ChatMessage, SessionSummary } from '../src/types';
import {
  installFakeElectronAPI,
  ok,
  permissionRequest,
  sessionSummary,
  type FakeBridge,
} from './helpers/fake-electron-api';

const PROJECT = { hash: '-projects-acme', realPath: '/projects/acme' };
const SESSION = '0f3c9a21-4b7d-4e2a-9c11-5d6e7f8a9b0c';
const AT = '2026-10-08T10:00:00.000Z';
const MODEL = 'claude-sonnet-5';

/** One turn as the stream delivers it: the text, the Edit on a message of its
 *  own, its result, then a skill run and its result. */
const TURN: ChatMessage[] = [
  {
    uuid: 'a1',
    role: 'assistant',
    timestamp: AT,
    model: MODEL,
    content: [{ type: 'text', text: 'I will fix the import.' }],
  },
  {
    uuid: 'a2',
    role: 'assistant',
    timestamp: AT,
    model: MODEL,
    content: [
      {
        type: 'tool_use',
        id: 'toolu_edit1',
        name: 'Edit',
        input: { file_path: '/projects/acme/src/a.ts', old_string: 'b', new_string: 'c' },
      },
    ],
  },
  {
    uuid: 'r1',
    role: 'user',
    timestamp: AT,
    content: [
      { type: 'tool_result', toolUseId: 'toolu_edit1', content: 'updated', isError: false },
    ],
  },
  {
    uuid: 'a3',
    role: 'assistant',
    timestamp: AT,
    model: MODEL,
    content: [{ type: 'tool_use', id: 'toolu_skill1', name: 'Skill', input: { skill: 'deploy' } }],
  },
  {
    uuid: 'r2',
    role: 'user',
    timestamp: AT,
    content: [
      {
        type: 'tool_result',
        toolUseId: 'toolu_skill1',
        content: 'Launching skill: deploy',
        isError: false,
      },
    ],
  },
];

let bridge: FakeBridge;
let queryClient: QueryClient;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // The windowed transcript sizes itself off its scroll box, which jsdom does not lay out.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 900,
    right: 1200,
    width: 1200,
    height: 900,
    toJSON: () => ({}),
  } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200);
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
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  bridge = installFakeElectronAPI();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  Object.assign(bridge.api, {
    skills: { getAll: vi.fn(async () => ok([])) },
    plugins: { getAll: vi.fn(async () => ok([])) },
    agents: { getGlobal: vi.fn(async () => ok([])), getByProject: vi.fn(async () => ok([])) },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  bridge.restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(resumeSession?: SessionSummary) {
  return render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeContext.Provider
          value={{ preference: 'light', resolved: 'light', setPreference: vi.fn() }}
        >
          <LiveChatView project={PROJECT} resumeSession={resumeSession} onBack={vi.fn()} />
        </ThemeContext.Provider>
      </QueryClientProvider>
    </StrictMode>
  );
}

const input = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const spend = () => screen.getByLabelText('Session spend detail').textContent;
const detail = () => screen.queryByRole('region', { name: 'Detail' });

async function send(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(input(), { key: 'Enter' });
  });
}

/** Send the first prompt of a new chat; the SDK then reports its session id. */
async function startTurn(text = 'Fix the import.') {
  await send(text);
  act(() => bridge.channels.chatStarted.emit(SESSION));
}

function stream(messages: ChatMessage[]) {
  act(() => {
    for (const message of messages)
      bridge.channels.chatMessage.emit({ sessionId: SESSION, message });
  });
}

function endTurn() {
  act(() => bridge.channels.chatDone.emit({ sessionId: SESSION }));
}

async function openSkillRun() {
  fireEvent.click(await screen.findByRole('button', { name: 'Skill tool — expand details' }));
  fireEvent.click(screen.getByRole('button', { name: /View output/ }));
}

describe('reading a streamed turn', () => {
  it("shows a tool-only Edit's diff at the foot of the turn before it", async () => {
    mount();
    await startTurn();
    stream(TURN);
    endTurn();
    expect(await screen.findByText('Updated')).toBeTruthy();
    expect(screen.getByText('a.ts')).toBeTruthy();
  });

  it('draws the reply being streamed under the list, never as a row of it', async () => {
    const { container } = mount();
    await startTurn();
    act(() => bridge.channels.chatChunk.emit({ sessionId: SESSION, text: 'Looking at it' }));
    const live = container.querySelector('.cl-turn--live');
    const list = container.querySelector('.cl-vlist');
    expect(live).not.toBeNull();
    expect(list).not.toBeNull();
    expect(live!.closest('.cl-vlist')).toBeNull();
    expect(list!.compareDocumentPosition(live!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps a resume seed that lands after the first send above that turn', async () => {
    type Seed = { data: ChatMessage[] | null; error: string | null };
    let resolveSeed!: (r: Seed) => void;
    bridge.api.sessions.getChat.mockReturnValue(
      new Promise<Seed>(r => {
        resolveSeed = r;
      })
    );
    mount(sessionSummary({ filename: `${SESSION}.jsonl` }));
    await send('Next step.');
    stream([
      {
        uuid: 'a9',
        role: 'assistant',
        timestamp: AT,
        model: MODEL,
        content: [{ type: 'text', text: 'On it.' }],
      },
    ]);
    endTurn();
    await act(async () => {
      resolveSeed(
        ok<ChatMessage[]>([
          {
            uuid: 's1',
            role: 'user',
            timestamp: AT,
            content: [{ type: 'text', text: 'Earlier question' }],
          },
          {
            uuid: 's2',
            role: 'assistant',
            timestamp: AT,
            model: MODEL,
            content: [{ type: 'text', text: 'Earlier answer' }],
          },
        ])
      );
    });
    const text = document.body.textContent ?? '';
    expect(text.indexOf('Earlier answer')).toBeGreaterThan(-1);
    expect(text.indexOf('Earlier answer')).toBeLessThan(text.indexOf('Next step.'));
    expect(text.indexOf('Next step.')).toBeLessThan(text.indexOf('On it.'));
  });
});

describe('the pill', () => {
  it('prints a dash for spend until the session has a row, then its figure', async () => {
    bridge.api.sessions.listByProject.mockResolvedValue(
      ok([sessionSummary({ filename: `${SESSION}.jsonl`, estimatedCost: 0.42 })])
    );
    mount();
    await waitFor(() => expect(bridge.api.sessions.listByProject).toHaveBeenCalled());
    expect(spend()).toBe('—');
    await startTurn();
    await waitFor(() => expect(spend()).toBe('$0.42'));
  });

  it('is lifted over a composer locked by a terminal session', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([{ pid: 4242, sessionId: SESSION, cwd: PROJECT.realPath } as ActiveSession])
    );
    const { container } = mount(sessionSummary({ filename: `${SESSION}.jsonl` }));
    await waitFor(() => expect(container.querySelector('[data-composer-lock]')).not.toBeNull());
  });
});

describe('a detail over the conversation', () => {
  it('opens a skill run, and Esc closes it', async () => {
    mount();
    await startTurn();
    stream(TURN);
    endTurn();
    await openSkillRun();
    expect(detail()).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(detail()).toBeNull();
  });

  it('closes when a tool asks for approval, so the approval is never behind it', async () => {
    mount();
    await startTurn();
    stream(TURN);
    endTurn();
    await openSkillRun();
    act(() => bridge.channels.permissionRequest.emit(permissionRequest('p1', SESSION)));
    expect(detail()).toBeNull();
  });

  it('keeps the draft typed in the composer', async () => {
    mount();
    await startTurn();
    stream(TURN);
    endTurn();
    fireEvent.change(input(), { target: { value: 'half a thought' } });
    await openSkillRun();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(input().value).toBe('half a thought');
  });
});

it('leaves no subscription behind', () => {
  const { unmount } = mount();
  unmount();
  for (const channel of [
    bridge.channels.chatStarted,
    bridge.channels.chatChunk,
    bridge.channels.chatMessage,
    bridge.channels.chatDone,
    bridge.channels.permissionRequest,
  ]) {
    expect(channel.listenerCount).toBe(0);
  }
});
