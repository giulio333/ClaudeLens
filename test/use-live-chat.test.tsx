// @vitest-environment jsdom
//
// `useLiveChat` is the single owner of an in-app SDK chat's state: it subscribes
// to the `sessions:chat*` channels, holds the in-flight turn, and commits it to
// the transcript when the turn ends. It is the highest-risk module in the
// renderer — a mistake here silently drops a reply the user watched arrive — and
// its own comments record that the bug has happened before ("the exact seam
// where a just-streamed reply could be dropped").
//
// These tests drive the hook the way the main process does: by emitting stream
// events on a fake bridge. No Electron, no SDK, no `~/.claude` on disk.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useLiveChat } from '../src/components/project/chat/useLiveChat';
import {
  assistantMessage,
  fail,
  installFakeElectronAPI,
  ok,
  permissionRequest,
  toolResultMessage,
  type FakeBridge,
} from './helpers/fake-electron-api';
import type { ChatMessage } from '../electron/shared/chat-types';

const REAL_PATH = '/Users/alice/projects/webapp';
const SESSION = 'session-under-test';
const OTHER = 'some-other-session';

let bridge: FakeBridge;

beforeEach(() => {
  bridge = installFakeElectronAPI();
});

afterEach(() => {
  // Unmount before pulling the bridge out: the hook's cleanup calls `endChat()`
  // on the way down, and RTL's own auto-cleanup runs after this hook, which would
  // leave it reaching for an `electronAPI` we had already removed.
  cleanup();
  bridge.restore();
});

/** Text of every text block in a message, joined — what the user reads. */
function textOf(message: ChatMessage): string {
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('');
}

/** Render the hook and take it through a send, so a turn is in flight. */
async function renderWithTurnInFlight(sessionId = SESSION) {
  const view = renderHook(() => useLiveChat(REAL_PATH));

  await act(async () => {
    await view.result.current.send('hello', { permissionMode: 'default' });
  });
  // The main process emits chatStarted before any stream event of the first turn.
  act(() => bridge.channels.chatStarted.emit(sessionId));

  return view;
}

describe('useLiveChat — stream envelopes', () => {
  it('drops text deltas tagged with a session it does not own', async () => {
    const { result } = await renderWithTurnInFlight();

    act(() => {
      bridge.channels.chatChunk.emit({ sessionId: SESSION, text: 'mine' });
      bridge.channels.chatChunk.emit({ sessionId: OTHER, text: 'STALE' });
    });

    expect(result.current.streamText).toBe('mine');
  });

  it('adopts the session id only once, so a superseded session cannot steal the view', async () => {
    const { result } = await renderWithTurnInFlight();
    expect(result.current.sessionId).toBe(SESSION);

    // A late chatStarted from another session must not re-point the hook: after
    // adoption, its events stay foreign.
    act(() => bridge.channels.chatStarted.emit(OTHER));
    expect(result.current.sessionId).toBe(SESSION);

    act(() => bridge.channels.chatChunk.emit({ sessionId: OTHER, text: 'STALE' }));
    expect(result.current.streamText).toBe('');
  });

  it('ignores a foreign chatDone instead of committing the live turn to it', async () => {
    const { result } = await renderWithTurnInFlight();
    act(() =>
      bridge.channels.chatMessage.emit({ sessionId: SESSION, message: assistantMessage('partial') })
    );

    // The final chatDone of a superseded session, arriving after this view mounted.
    act(() => bridge.channels.chatDone.emit({ sessionId: OTHER }));

    // Still in flight: nothing committed, the composer is still on "Stop".
    expect(result.current.streaming).toBe(true);
    act(() => bridge.channels.chatDone.emit({ sessionId: SESSION }));
    expect(result.current.streaming).toBe(false);
  });

  it('drops a permission request from a foreign session but shows an untagged one', async () => {
    const { result } = await renderWithTurnInFlight();

    act(() => bridge.channels.permissionRequest.emit(permissionRequest('foreign', OTHER)));
    expect(result.current.permRequest).toBeNull();

    // '' means the request raced a teardown — showing it is the safe side, since
    // an unanswered dialog deadlocks the turn either way.
    act(() => bridge.channels.permissionRequest.emit(permissionRequest('raced', '')));
    expect(result.current.permRequest?.requestId).toBe('raced');
  });
});

describe('useLiveChat — turn lifecycle', () => {
  it('shows the optimistic user bubble while the send is still in flight', async () => {
    // Hold startMessage open: the bubble must be on screen before it resolves,
    // because the SDK never echoes the prompt back.
    let release!: () => void;
    bridge.api.sessions.startMessage.mockImplementationOnce(
      () => new Promise(resolve => (release = () => resolve(ok(null))))
    );

    const { result } = renderHook(() => useLiveChat(REAL_PATH));
    let sending!: Promise<boolean>;
    act(() => {
      sending = result.current.send('what is this repo?', { permissionMode: 'default' });
    });

    expect(result.current.displayMessages).toHaveLength(1);
    expect(textOf(result.current.displayMessages[0])).toBe('what is this repo?');
    expect(result.current.hasConversation).toBe(true);

    await act(async () => {
      release();
      await sending;
    });
  });

  it('commits the prompt and the streamed messages when the turn ends', async () => {
    const { result } = await renderWithTurnInFlight();

    const reply = assistantMessage('It is an Electron app.', 'reply-1');
    act(() => {
      bridge.channels.chatChunk.emit({ sessionId: SESSION, text: 'It is' });
      bridge.channels.chatMessage.emit({ sessionId: SESSION, message: reply });
      bridge.channels.chatDone.emit({ sessionId: SESSION });
    });

    const committed = result.current.displayMessages;
    expect(committed.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(textOf(committed[1])).toBe('It is an Electron app.');
    // The in-flight scaffolding is cleared, not left echoing under the transcript.
    expect(result.current.streamText).toBe('');
    expect(result.current.liveTool).toBeNull();
    expect(result.current.streaming).toBe(false);
  });

  it('does not re-commit a message already in the transcript', async () => {
    const { result } = await renderWithTurnInFlight();

    const reply = assistantMessage('once', 'reply-1');
    act(() => {
      bridge.channels.chatMessage.emit({ sessionId: SESSION, message: reply });
      bridge.channels.chatDone.emit({ sessionId: SESSION });
    });
    expect(result.current.displayMessages.map(m => m.uuid)).toContain('reply-1');

    // Second turn re-delivers a message the transcript already holds — the case
    // the resume seed makes real, since the seed and the stream overlap.
    await act(async () => {
      await result.current.send('again', { permissionMode: 'default' });
    });
    act(() => {
      bridge.channels.chatMessage.emit({ sessionId: SESSION, message: { ...reply } });
      bridge.channels.chatDone.emit({ sessionId: SESSION });
    });

    expect(result.current.displayMessages.filter(m => m.uuid === 'reply-1')).toHaveLength(1);
  });

  it('commits nothing on a chatDone that follows no send', async () => {
    const { result } = renderHook(() => useLiveChat(REAL_PATH));
    act(() => bridge.channels.chatStarted.emit(SESSION));

    // The final chatDone the main process emits when a query dies on its own.
    act(() => bridge.channels.chatDone.emit({ sessionId: SESSION }));

    expect(result.current.displayMessages).toEqual([]);
    expect(result.current.hasConversation).toBe(false);
  });

  it('clears the partial text once the completed assistant message arrives', async () => {
    const { result } = await renderWithTurnInFlight();

    act(() => bridge.channels.chatChunk.emit({ sessionId: SESSION, text: 'It is an El' }));
    expect(result.current.streamText).toBe('It is an El');

    // The full message absorbs what streamed; leaving streamText set would render
    // the same words twice — once in the message, once in the trailing live turn.
    act(() =>
      bridge.channels.chatMessage.emit({
        sessionId: SESSION,
        message: assistantMessage('It is an Electron app.'),
      })
    );
    expect(result.current.streamText).toBe('');
  });

  it('drops the running-tool indicator when the tool result comes back', async () => {
    const { result } = await renderWithTurnInFlight();

    act(() =>
      bridge.channels.chatToolActivity.emit({
        sessionId: SESSION,
        activity: { toolName: 'Bash', elapsedSeconds: 3 },
      })
    );
    expect(result.current.liveTool?.toolName).toBe('Bash');

    act(() =>
      bridge.channels.chatMessage.emit({
        sessionId: SESSION,
        message: toolResultMessage('tool-1', 'ok'),
      })
    );
    expect(result.current.liveTool).toBeNull();
  });

  it('rolls the optimistic bubble back when the send never becomes a turn', async () => {
    bridge.api.sessions.startMessage.mockResolvedValueOnce(fail('SDK unavailable'));

    const { result } = renderHook(() => useLiveChat(REAL_PATH));
    let sent: boolean | undefined;
    await act(async () => {
      sent = await result.current.send('hello', { permissionMode: 'default' });
    });

    expect(sent).toBe(false);
    expect(result.current.displayMessages).toEqual([]);
    expect(result.current.streaming).toBe(false);
    expect(result.current.errorText).toBe('SDK unavailable');
  });

  it('carries the turn summary from the SDK result', async () => {
    const { result } = await renderWithTurnInFlight();

    act(() =>
      bridge.channels.chatDone.emit({
        sessionId: SESSION,
        summary: {
          totalCostUsd: 0.0412,
          inputTokens: 120,
          outputTokens: 340,
          cacheReadTokens: 10,
          cacheWriteTokens: 20,
          numTurns: 1,
          models: ['claude-sonnet-5'],
        },
      })
    );

    expect(result.current.summary?.totalCostUsd).toBeCloseTo(0.0412);
    expect(result.current.summary?.models).toEqual(['claude-sonnet-5']);
  });
});

describe('useLiveChat — permission queue', () => {
  it('queues concurrent requests instead of overwriting the visible one', async () => {
    const { result } = await renderWithTurnInFlight();

    // Parallel read-only tools fire several canUseTool calls at once. Overwriting
    // would leave the hidden request pending forever, deadlocking the turn.
    act(() => {
      bridge.channels.permissionRequest.emit(permissionRequest('req-1', SESSION));
      bridge.channels.permissionRequest.emit(permissionRequest('req-2', SESSION));
      bridge.channels.permissionRequest.emit(permissionRequest('req-3', SESSION));
    });

    expect(result.current.permRequest?.requestId).toBe('req-1');
    expect(result.current.permPendingCount).toBe(2);
  });

  it('drains the queue oldest-first, answering the SDK for each', async () => {
    const { result } = await renderWithTurnInFlight();
    act(() => {
      bridge.channels.permissionRequest.emit(permissionRequest('req-1', SESSION));
      bridge.channels.permissionRequest.emit(permissionRequest('req-2', SESSION));
    });

    act(() => result.current.respondPermission({ kind: 'allow', input: {} }));
    expect(result.current.permRequest?.requestId).toBe('req-2');
    expect(result.current.permPendingCount).toBe(0);

    act(() => result.current.respondPermission({ kind: 'deny', message: 'no' }));
    expect(result.current.permRequest).toBeNull();

    expect(bridge.api.sessions.respondPermission.mock.calls.map(c => c[0])).toEqual([
      'req-1',
      'req-2',
    ]);
    expect(bridge.api.sessions.respondPermission.mock.calls[1][1]).toEqual({
      kind: 'deny',
      message: 'no',
    });
  });

  it('clears pending requests when the turn ends', async () => {
    const { result } = await renderWithTurnInFlight();
    act(() => bridge.channels.permissionRequest.emit(permissionRequest('req-1', SESSION)));

    // The SDK denies anything still pending on teardown; a dialog left on screen
    // would be answering a turn that is already over.
    act(() => bridge.channels.chatDone.emit({ sessionId: SESSION }));
    expect(result.current.permRequest).toBeNull();
  });

  it('clears pending requests on stop', async () => {
    const { result } = await renderWithTurnInFlight();
    act(() => bridge.channels.permissionRequest.emit(permissionRequest('req-1', SESSION)));

    act(() => result.current.stop());

    expect(bridge.api.sessions.stopMessage).toHaveBeenCalledOnce();
    expect(result.current.permRequest).toBeNull();
    expect(result.current.streaming).toBe(false);
  });
});

describe('useLiveChat — resume mode', () => {
  const resume = { hash: '-Users-alice-projects-webapp', sessionId: 'existing-session' };

  it('seeds the transcript from disk and grows it from the stream', async () => {
    const seeded = assistantMessage('from an earlier turn', 'seed-1');
    bridge.api.sessions.getChat.mockResolvedValueOnce(ok([seeded]));

    const { result } = renderHook(() => useLiveChat(REAL_PATH, resume));
    expect(result.current.seedLoading).toBe(true);

    await act(async () => {});

    expect(result.current.seedLoading).toBe(false);
    expect(bridge.api.sessions.getChat).toHaveBeenCalledWith(resume.hash, 'existing-session.jsonl');
    expect(result.current.displayMessages.map(m => m.uuid)).toEqual(['seed-1']);

    await act(async () => {
      await result.current.send('and now?', { permissionMode: 'default' });
    });
    act(() => {
      bridge.channels.chatMessage.emit({
        sessionId: resume.sessionId,
        message: assistantMessage('a new reply', 'reply-1'),
      });
      bridge.channels.chatDone.emit({ sessionId: resume.sessionId });
    });

    expect(result.current.displayMessages.map(m => m.uuid)).toEqual([
      'seed-1',
      result.current.displayMessages[1].uuid, // the prompt bubble
      'reply-1',
    ]);
  });

  it('resumes the existing session rather than starting a new one', async () => {
    const { result } = renderHook(() => useLiveChat(REAL_PATH, resume));
    await act(async () => {});

    // The id is known up front, so the first send pushes into that transcript.
    expect(result.current.sessionId).toBe(resume.sessionId);

    await act(async () => {
      await result.current.send('continue', { permissionMode: 'default', model: 'opus' });
    });

    expect(bridge.api.sessions.startMessage).not.toHaveBeenCalled();
    expect(bridge.api.sessions.sendMessage).toHaveBeenCalledWith(
      REAL_PATH,
      resume.sessionId,
      'continue',
      'opus',
      'default'
    );
  });

  it('surfaces a failed mount seed without wedging the view', async () => {
    bridge.api.sessions.getChat.mockResolvedValueOnce(fail<ChatMessage[]>('transcript unreadable'));

    const { result } = renderHook(() => useLiveChat(REAL_PATH, resume));
    await act(async () => {});

    expect(result.current.seedLoading).toBe(false);
    expect(result.current.errorText).toBe('transcript unreadable');
  });
});

describe('useLiveChat — teardown', () => {
  it('disposes every stream subscription and ends the SDK session on unmount', async () => {
    const { unmount } = await renderWithTurnInFlight();

    const subscribed = Object.values(bridge.channels).map(c => c.listenerCount);
    expect(subscribed.filter(n => n > 0).length).toBeGreaterThan(0);

    unmount();

    for (const [name, channel] of Object.entries(bridge.channels)) {
      expect(channel.listenerCount, `${name} still has a listener after unmount`).toBe(0);
    }
    expect(bridge.api.sessions.endChat).toHaveBeenCalledOnce();
  });
});
