// @vitest-environment jsdom
//
// `/btw` in the SDK chat. Typed in the composer, a side question goes to the
// chat's own live session (`sessions:sideQuestion`) and never to the
// conversation: no turn is sent, no bubble appears, the transcript does not
// move. What is asserted is that interception — also while a turn is running,
// which is the point of asking on the side — and the card above the composer:
// the answer drawn as prose, "no answer" as a notice, an error with a retry,
// follow-ups carrying only the answered exchanges, and a question walked away
// from (stopped, closed, unmounted) cancelled with its late answer ignored.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';
import { LiveChatView } from '../src/components/project/chat/LiveChatView';
import type { SideQuestionAnswer } from '../src/types';

const PROJECT = { hash: 'project-a', realPath: '/projects/acme' };
const SESSION = '0f3c9a21-4b7d-4e2a-9c11-5d6e7f8a9b0c';

let bridge: FakeBridge;
let client: QueryClient;

beforeEach(() => {
  bridge = installFakeElectronAPI();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  client.clear();
  bridge.restore();
  vi.unstubAllGlobals();
});

function mount() {
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <LiveChatView project={PROJECT} onBack={vi.fn()} />
      </QueryClientProvider>
    </StrictMode>
  );
}

const input = () => screen.getByRole('textbox') as HTMLTextAreaElement;

async function submit(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(input(), { key: 'Enter' });
  });
}

/** Send a first message so the chat has a live session, its turn still running. */
async function startTurn() {
  await submit('Remember the codeword PAPAYA-42.');
  act(() => bridge.channels.chatStarted.emit(SESSION));
}

function deferred() {
  let resolve!: (value: { data: SideQuestionAnswer | null; error: string | null }) => void;
  const promise = new Promise<{ data: SideQuestionAnswer | null; error: string | null }>(
    r => (resolve = r)
  );
  return { promise, resolve };
}

const card = () => screen.getByRole('region', { name: 'Side questions' });

describe('/btw in the SDK chat', () => {
  it('asks the live session while its turn runs, and sends nothing to the conversation', async () => {
    bridge.api.sessions.sideQuestion.mockResolvedValue(
      ok({ response: 'You mentioned **PAPAYA-42**.', synthetic: false })
    );
    mount();
    await startTurn();
    expect(input().disabled).toBe(false);
    await submit('/btw which codeword did I mention?');
    expect(bridge.api.sessions.sideQuestion).toHaveBeenCalledWith(
      SESSION,
      'which codeword did I mention?',
      [],
      expect.any(String)
    );
    expect(bridge.api.sessions.startMessage).toHaveBeenCalledTimes(1);
    expect(bridge.api.sessions.sendMessage).not.toHaveBeenCalled();
    expect(within(card()).getByText('PAPAYA-42').tagName).toBe('STRONG');
    expect(input().value).toBe('');
    // The conversation shows the one prompt that was sent, not the side question.
    expect(screen.queryAllByText('/btw which codeword did I mention?')).toHaveLength(0);
  });

  it('sends nothing else while the turn runs', async () => {
    mount();
    await startTurn();
    await submit('a normal message');
    expect(bridge.api.sessions.sendMessage).not.toHaveBeenCalled();
    expect(input().value).toBe('a normal message');
  });

  it('offers /btw in the slash menu, and only it while a turn runs', async () => {
    mount();
    await startTurn();
    fireEvent.change(input(), { target: { value: '/' } });
    const menu = screen.getByRole('listbox', { name: 'Slash commands' });
    expect(
      within(menu)
        .getAllByRole('option')
        .map(o => o.textContent)
    ).toEqual(['/btw']);
  });

  it('says to send a message first when the chat has no session yet', async () => {
    mount();
    await submit('/btw anything?');
    expect(bridge.api.sessions.sideQuestion).not.toHaveBeenCalled();
    expect(bridge.api.sessions.startMessage).not.toHaveBeenCalled();
    expect(within(card()).getByRole('alert').textContent).toContain('Send a message first');
  });

  it('ignores a bare /btw with no question', async () => {
    mount();
    await startTurn();
    await submit('/btw   ');
    expect(bridge.api.sessions.sideQuestion).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Side questions' })).toBeNull();
  });

  it('sends the answered exchanges as the history of a follow-up', async () => {
    bridge.api.sessions.sideQuestion
      .mockResolvedValueOnce(ok({ response: 'PAPAYA-42.', synthetic: false }))
      .mockResolvedValueOnce(ok({ response: null, synthetic: true }))
      .mockResolvedValueOnce(ok({ response: '24-AYAPAP', synthetic: false }));
    mount();
    await startTurn();
    await submit('/btw which codeword?');
    await submit('/btw anything else?');
    expect(within(card()).getByText(/No answer came back/)).toBeTruthy();
    await submit('/btw spell it backwards');
    expect(bridge.api.sessions.sideQuestion).toHaveBeenLastCalledWith(
      SESSION,
      'spell it backwards',
      [{ question: 'which codeword?', response: 'PAPAYA-42.' }],
      expect.any(String)
    );
    expect(within(card()).getByText('24-AYAPAP')).toBeTruthy();
  });

  it('prints an error and asks the same question again on retry', async () => {
    bridge.api.sessions.sideQuestion
      .mockResolvedValueOnce({ data: null, error: 'Side question timed out' })
      .mockResolvedValueOnce(ok({ response: 'Here.', synthetic: false }));
    mount();
    await startTurn();
    await submit('/btw where are we?');
    expect(within(card()).getByRole('alert').textContent).toContain('timed out');
    await act(async () => {
      fireEvent.click(within(card()).getByRole('button', { name: 'Try again' }));
    });
    expect(bridge.api.sessions.sideQuestion).toHaveBeenCalledTimes(2);
    expect(within(card()).getByText('Here.')).toBeTruthy();
    expect(within(card()).getAllByText('where are we?')).toHaveLength(1);
  });

  it('stops a question in flight: cancels it, and its late answer changes nothing', async () => {
    const answer = deferred();
    bridge.api.sessions.sideQuestion.mockReturnValue(answer.promise);
    mount();
    await startTurn();
    await submit('/btw slow one?');
    const requestId = bridge.api.sessions.sideQuestion.mock.calls[0][3];
    fireEvent.click(within(card()).getByRole('button', { name: 'Stop' }));
    expect(bridge.api.sessions.cancelSideQuestion).toHaveBeenCalledWith(requestId);
    expect(within(card()).getByText('Stopped.')).toBeTruthy();
    await act(async () => answer.resolve(ok({ response: 'Too late.', synthetic: false })));
    expect(screen.queryByText('Too late.')).toBeNull();
  });

  it('asks one side question at a time', async () => {
    bridge.api.sessions.sideQuestion.mockReturnValue(deferred().promise);
    mount();
    await startTurn();
    await submit('/btw first?');
    await submit('/btw second?');
    expect(bridge.api.sessions.sideQuestion).toHaveBeenCalledTimes(1);
  });

  it('closes on ✕ or Escape, forgetting the thread and cancelling what is out', async () => {
    bridge.api.sessions.sideQuestion.mockReturnValue(deferred().promise);
    mount();
    await startTurn();
    await submit('/btw slow one?');
    fireEvent.click(within(card()).getByRole('button', { name: 'Close side questions' }));
    expect(bridge.api.sessions.cancelSideQuestion).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: 'Side questions' })).toBeNull();

    bridge.api.sessions.sideQuestion.mockResolvedValue(ok({ response: 'Yes.', synthetic: false }));
    await submit('/btw again?');
    fireEvent.keyDown(within(card()).getByText('Yes.'), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Side questions' })).toBeNull();

    // Where the focus usually is: the composer.
    await submit('/btw once more?');
    expect(card()).toBeTruthy();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Side questions' })).toBeNull();
  });

  it('cancels a question still out when the chat goes away', async () => {
    bridge.api.sessions.sideQuestion.mockReturnValue(deferred().promise);
    const view = mount();
    await startTurn();
    await submit('/btw slow one?');
    const requestId = bridge.api.sessions.sideQuestion.mock.calls[0][3];
    view.unmount();
    expect(bridge.api.sessions.cancelSideQuestion).toHaveBeenCalledWith(requestId);
  });
});
