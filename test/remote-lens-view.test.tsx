// @vitest-environment jsdom
//
// The Lens and Mission Control of a remote pane (#294). The host's half — the
// watcher script, the frames, the parse — runs for real in `remote-watch.test`;
// what only this side can prove is what the page does with the readings the
// main process pushes:
//
//   1. it says where the reading stands until there is a transcript, and asks
//      ssh's question for a second login in the Lens, never in the terminal —
//      over a transcript already on screen too, as after a retry;
//   2. once the host's transcript arrives, the real `ChatView` and
//      `MissionRail` draw it — and read NOTHING about the project on this
//      machine: the host's folder is often the same path as a local one, and
//      every local read would show this machine's data as the session's;
//   3. a path a message names is not opened here, and a reading for another
//      pane is not drawn.

import { StrictMode, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeContext } from '../src/hooks/useTheme';
import { RemoteView } from '../src/components/project/remote/RemoteView';
import type { RemoteHost } from '../electron/shared/remote-host';
import type { RemoteLensState } from '../electron/shared/remote-session';
import type { ChatMessage } from '../src/types';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

const HOST: RemoteHost = { id: 'h1', name: 'Build', target: 'dev@build', defaultDir: '~/acme' };
const SID = '0b6c1f2e-1111-2222-3333-444444444444';

let bridge: FakeBridge;
let queryClient: QueryClient;
let lastId: string | null;
let local: Record<string, ReturnType<typeof vi.fn>>;

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
  // …and reads its box off offsetWidth/offsetHeight.
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
  localStorage.clear();
  bridge = installFakeElectronAPI();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastId = null;
  let n = 0;
  Object.assign(bridge.api, {
    terminal: {
      create: vi.fn(),
      createRemote: vi.fn(async () => {
        lastId = `pty-${++n}`;
        return ok({ id: lastId, pid: n });
      }),
      write: vi.fn(async () => ok(null)),
      resize: vi.fn(async () => ok(null)),
      kill: vi.fn(async () => ok(null)),
      onData: () => () => {},
      onExit: () => () => {},
    },
  });
  // Every read of this machine's project data the Lens and the rail COULD make.
  // Each is a spy that answers, so a call is recorded instead of crashing.
  local = {
    getSubagents: vi.fn(async () => ok([])),
    tasks: vi.fn(async () => ok([])),
    teams: vi.fn(async () => ok([])),
    skills: vi.fn(async () => ok([])),
    plugins: vi.fn(async () => ok([])),
    globalAgents: vi.fn(async () => ok([])),
    projectAgents: vi.fn(async () => ok([])),
    memory: vi.fn(async () => ok(null)),
  };
  Object.assign(bridge.api.sessions, { getSubagents: local.getSubagents });
  Object.assign(bridge.api, {
    tasks: { getByProject: local.tasks },
    teams: { getByProject: local.teams },
    skills: { getAll: local.skills },
    plugins: { getAll: local.plugins },
    agents: { getGlobal: local.globalAgents, getByProject: local.projectAgents },
  });
  Object.assign(bridge.api.memory, { getProject: local.memory });
});

afterEach(() => {
  cleanup();
  bridge.restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeContext.Provider
          value={{ preference: 'light', resolved: 'light', setPreference: vi.fn() }}
        >
          {children}
        </ThemeContext.Provider>
      </QueryClientProvider>
    </StrictMode>
  );
  return render(<RemoteView onBack={() => {}} />, { wrapper });
}

async function connected() {
  bridge.api.remote.listHosts.mockResolvedValue(ok([HOST]));
  const view = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(lastId).not.toBeNull());
  // StrictMode's rehearsal pane is killed as stale; the live one is the last.
  await waitFor(() => expect(bridge.api.remote.getLensState).toHaveBeenCalledWith(lastId));
  return view;
}

function openLens() {
  fireEvent.click(screen.getByRole('button', { name: /LENS/ }));
}

let revision = 0;
function push(over: Partial<RemoteLensState>) {
  const state: RemoteLensState = {
    terminalId: lastId!,
    phase: 'starting',
    channel: 'shared',
    prompt: null,
    detail: null,
    cwd: null,
    sessionId: null,
    status: null,
    messages: [],
    summary: null,
    revision: ++revision,
    ...over,
  };
  act(() => bridge.channels.lensState.emit(state));
}

function message(uuid: string, role: 'user' | 'assistant', text: string): ChatMessage {
  return {
    uuid,
    role,
    timestamp: '2026-09-23T10:00:00.000Z',
    ...(role === 'assistant' && { model: 'claude-sonnet-5' }),
    content: [{ type: 'text', text }],
  };
}

describe('before there is a transcript', () => {
  it('says the Lens starts with Claude Code, then asks ssh for a second login in the Lens', async () => {
    await connected();
    openLens();
    expect(screen.getByText(/Lens starts once Claude Code is running on Build/)).toBeTruthy();

    push({ phase: 'prompt', channel: 'separate', prompt: "dev@build's password:" });
    expect(screen.getByLabelText("dev@build's password:")).toBeTruthy();
    // The banner says it is a second login rather than letting it surprise.
    expect(screen.getByRole('note').textContent).toContain('over a second ssh login');

    const field = screen.getByLabelText("dev@build's password:") as HTMLInputElement;
    expect(field.type).toBe('password');
    fireEvent.change(field, { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(bridge.api.remote.answerLens).toHaveBeenCalledWith(lastId, 'hunter2');
    expect(field.value).toBe('');
  });

  it('names an ambiguity instead of picking a session, and says a missing transcript is normal', async () => {
    await connected();
    openLens();
    push({ phase: 'ambiguous', detail: '2', cwd: '/home/dev/acme' });
    expect(
      screen.getByText(/2 sessions on Build were started from this terminal in \/home\/dev\/acme/)
    ).toBeTruthy();
    push({ phase: 'waiting', sessionId: SID });
    expect(screen.getByText('The session has no transcript yet.')).toBeTruthy();
  });

  it('offers to try again when the reading failed, without touching the terminal', async () => {
    await connected();
    openLens();
    push({ phase: 'failed', detail: 'The host stopped answering.' });
    expect(
      screen.getByText(/The host stopped answering\. The terminal is not affected\./)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(bridge.api.remote.retryLens).toHaveBeenCalledWith(lastId);
  });
});

describe('the session, read from the host', () => {
  const live = (messages: ChatMessage[]) =>
    push({
      phase: 'live',
      sessionId: SID,
      cwd: '/home/dev/acme',
      status: 'busy',
      messages,
      summary: {
        filename: `${SID}.jsonl`,
        date: '2026-09-23T10:00:00.000Z',
        inputTokens: 10,
        outputTokens: 5,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 15,
        estimatedCost: 0.01,
        cacheSavings: 0,
        messageCount: messages.length,
        models: {},
      },
    });

  it('is drawn by the Lens and the rail, and nothing about the project is read here', async () => {
    await connected();
    openLens();
    live([
      message('u1', 'user', 'Look at the build'),
      message(
        'a1',
        'assistant',
        'Source: [[Build notes]]. The failing screenshot: ![shot](/tmp/acme/shot.png)'
      ),
    ]);
    await waitFor(() => expect(screen.getByText('Look at the build')).toBeTruthy());
    // The rail is there, and says which host the session is on when it waits.
    expect(screen.getByText('MISSION CONTROL')).toBeTruthy();

    // A path the message names is on the host: named, not read.
    expect(screen.getByText(/shot\.png — on Build, not read from this machine/)).toBeTruthy();
    expect(bridge.api.images.read).not.toHaveBeenCalled();
    // Wikilinks resolve against this machine's files, so they are not asked about.
    expect(bridge.api.vault.resolveLinks).not.toHaveBeenCalled();
    // Nor is the transcript, the session list, the configuration or anything
    // the rail decorates with: all of it would describe this machine.
    expect(bridge.api.sessions.getChat).not.toHaveBeenCalled();
    expect(bridge.api.sessions.listByProject).not.toHaveBeenCalled();
    expect(bridge.api.config.getEffective).not.toHaveBeenCalled();
    expect(bridge.api.playbook.getTemplates).not.toHaveBeenCalled();
    for (const [name, spy] of Object.entries(local)) {
      expect(spy, `${name} read on this machine`).not.toHaveBeenCalled();
    }
  });

  it('offers neither export nor delete for a session that is not on this machine', async () => {
    await connected();
    openLens();
    live([message('u1', 'user', 'hello'), message('a1', 'assistant', 'hi')]);
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy());
    expect(screen.queryByTitle('Export & more')).toBeNull();
    expect(screen.queryByText('Delete session')).toBeNull();
    // The playbook is this machine's, keyed on a local project.
    expect(screen.queryByRole('button', { name: 'Playbook' })).toBeNull();
  });

  it("asks ssh's question over a transcript already on screen, as after a retry", async () => {
    await connected();
    openLens();
    const messages = [message('u1', 'user', 'hello')];
    live(messages);
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy());
    // The retried channel logs in again while the old transcript is still held.
    push({
      phase: 'prompt',
      channel: 'separate',
      prompt: "dev@build's password:",
      sessionId: SID,
      messages,
    });
    const field = screen.getByLabelText("dev@build's password:") as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(bridge.api.remote.answerLens).toHaveBeenCalledWith(lastId, 'hunter2');
    // Answered, the transcript is back while the channel reconnects.
    push({ phase: 'connecting', channel: 'separate', sessionId: SID, messages });
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy());
  });

  it('keeps the transcript on screen after the session ends, and says so', async () => {
    await connected();
    openLens();
    live([message('u1', 'user', 'hello')]);
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy());
    push({ phase: 'ended', sessionId: SID, messages: [message('u1', 'user', 'hello')] });
    expect(screen.getByText('The session on Build ended. This is what it wrote.')).toBeTruthy();
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('draws nothing pushed for another pane, and a late snapshot never replaces a newer push', async () => {
    await connected();
    openLens();
    act(() =>
      bridge.channels.lensState.emit({
        terminalId: 'someone-else',
        phase: 'failed',
        channel: 'shared',
        prompt: null,
        detail: 'not yours',
        cwd: null,
        sessionId: null,
        status: null,
        messages: [],
        summary: null,
        revision: 999,
      })
    );
    expect(screen.queryByText(/not yours/)).toBeNull();
    push({ phase: 'searching' });
    expect(screen.getByText(/Looking for this session in the registry on Build/)).toBeTruthy();
    // A CLI still on its first prompt has not registered: the page says where to answer.
    expect(screen.getByText(/answer it there/)).toBeTruthy();
  });

  it('drops its subscription when the page goes away', async () => {
    const view = await connected();
    expect(bridge.channels.lensState.listenerCount).toBeGreaterThan(0);
    view.unmount();
    expect(bridge.channels.lensState.listenerCount).toBe(0);
  });
});
