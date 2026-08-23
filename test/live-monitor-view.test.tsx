// @vitest-environment jsdom
//
// The renderer half of #194. The main process can now only ever tail the session
// it was asked for, but the view had its own way of showing one session's work
// under another's name: it restarted the watch on a new session id without
// clearing anything, so events, Claude's status and the running tool from the
// previous session stayed on screen — and `watching` stayed true even when the
// restart had not attached to anything.
//
// Three things are pinned here, all invisible from the module tests:
//   1. a retarget clears the session-derived state before the new watch starts;
//   2. `LIVE` is shown only for a verified attachment — a `pending` watch says
//      WAITING, which is neither live nor offline, and a late answer belonging
//      to a superseded target cannot turn it on;
//   3. the subscriptions are disposed with the view.

import { createElement } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

import LiveMonitor from '../src/tabs/LiveMonitor';
import type { ActiveSession, LiveEvent } from '../src/types';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

const PROJECT = { hash: '-Users-alice-Projects-acme', realPath: '/Users/alice/Projects/acme' };
const SESSION_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const SESSION_B = 'bbbbbbbb-2222-2222-2222-222222222222';

function session(sessionId: string): ActiveSession {
  return { pid: 4242, sessionId, cwd: PROJECT.realPath, status: 'busy', source: 'registry' };
}

let toolCounter = 0;
function toolEvent(name: string): LiveEvent {
  return {
    id: `ev-${++toolCounter}`,
    timestamp: new Date().toISOString(),
    type: 'tool_use',
    toolName: name,
    toolInput: { file_path: `/x/${name}.ts` },
  } as LiveEvent;
}

let bridge: FakeBridge;
let queryClient: QueryClient;

beforeEach(() => {
  bridge = installFakeElectronAPI();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  bridge.restore();
});

function mount() {
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(LiveMonitor, { project: PROJECT, onBack: () => {} })
    )
  );
}

const started = (sessionId: string | null, state: 'tailing' | 'pending' | 'none') =>
  ok({ started: state === 'tailing', state, sessionId, filePath: null });

describe('LiveMonitor', () => {
  it('watches the transcript of the session the registry reports', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([session(SESSION_A)]));
    mount();

    await waitFor(() =>
      expect(bridge.api.live.startWatch).toHaveBeenCalledWith(PROJECT.hash, SESSION_A)
    );
    expect(await screen.findByText('LIVE')).toBeTruthy();
  });

  it('says WAITING, not LIVE, while the requested transcript does not exist', async () => {
    // The startup race: the session is in the registry, its `.jsonl` is not on
    // disk yet. This used to read LIVE over another session's transcript.
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([session(SESSION_A)]));
    bridge.api.live.startWatch.mockResolvedValue(started(SESSION_A, 'pending'));
    mount();

    expect(await screen.findByText('WAITING')).toBeTruthy();
    expect(screen.queryByText('LIVE')).toBeNull();

    // The main process reports the attachment when the file appears.
    bridge.channels.liveWatchStatus.emit({
      state: 'tailing',
      sessionId: SESSION_A,
      filePath: `/x/${SESSION_A}.jsonl`,
    });
    expect(await screen.findByText('LIVE')).toBeTruthy();
  });

  it('clears the previous session activity when it retargets', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([session(SESSION_A)]));
    mount();

    await waitFor(() =>
      expect(bridge.api.live.startWatch).toHaveBeenCalledWith(PROJECT.hash, SESSION_A)
    );
    bridge.channels.liveEvent.emit(toolEvent('Grep'));
    // The tool shows up in more than one place (the running-tool row, the
    // frequency list): what matters is that it is on screen at all.
    await waitFor(() => expect(screen.queryAllByText(/Grep/).length).toBeGreaterThan(0));

    // The registry now reports a different session in this project.
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([session(SESSION_B)]));
    bridge.channels.activeSessions.emit([session(SESSION_B)]);

    await waitFor(() =>
      expect(bridge.api.live.startWatch).toHaveBeenCalledWith(PROJECT.hash, SESSION_B)
    );
    // What the previous session was doing is not what this one is doing.
    await waitFor(() => expect(screen.queryAllByText(/Grep/)).toHaveLength(0));
  });

  it('ignores a watch answer that belongs to a superseded session', async () => {
    // `startWatch` is async, so the answer for session A can land after the view
    // has already retargeted to B. Applying it would light up LIVE for a watch
    // that is no longer the one running.
    let releaseA: (value: ReturnType<typeof started>) => void = () => {};
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([session(SESSION_A)]));
    bridge.api.live.startWatch.mockImplementationOnce(
      () => new Promise(resolve => (releaseA = resolve))
    );
    mount();

    await waitFor(() => expect(bridge.api.live.startWatch).toHaveBeenCalledTimes(1));

    // B takes over, and its own watch is still pending on disk.
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([session(SESSION_B)]));
    bridge.api.live.startWatch.mockResolvedValue(started(SESSION_B, 'pending'));
    bridge.channels.activeSessions.emit([session(SESSION_B)]);
    await waitFor(() =>
      expect(bridge.api.live.startWatch).toHaveBeenCalledWith(PROJECT.hash, SESSION_B)
    );
    expect(await screen.findByText('WAITING')).toBeTruthy();

    // A's answer arrives now, saying it is tailing. It must change nothing.
    releaseA(started(SESSION_A, 'tailing'));
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('LIVE')).toBeNull();
    expect(screen.getByText('WAITING')).toBeTruthy();
  });

  it('stops watching and unsubscribes when the view goes away', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([session(SESSION_A)]));
    const view = mount();
    await waitFor(() => expect(bridge.api.live.startWatch).toHaveBeenCalled());

    view.unmount();

    expect(bridge.api.live.stopWatch).toHaveBeenCalled();
    // No listener outlives the view: a leaked one would keep folding events of a
    // watch nobody is showing.
    expect(bridge.channels.liveEvent.listenerCount).toBe(0);
    expect(bridge.channels.liveWatchStatus.listenerCount).toBe(0);
  });
});
