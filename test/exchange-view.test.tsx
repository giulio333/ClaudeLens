// @vitest-environment jsdom
//
// The exchange a message from another session belongs to (#280): the page that
// puts the two halves of a `SendMessage` side by side. The join itself is unit
// tested (`session-exchange.test.ts`); what only this side can prove is what
// the page promises about an answer:
//
//   1. it asks for the exchange of the message it was opened on, and draws the
//      messages in the order the reader gave, each attributed to its sender,
//      with the message the reader came from marked;
//   2. a sender whose transcript is gone is SAID to be, not dressed up as a
//      session that can be opened;
//   3. opening a turn resolves the REAL `SessionSummary` from that project's own
//      list and refuses when the session is not there — the same rule search
//      hits follow, for the same reason (a fabricated summary would put invented
//      figures in the transcript header);
//   4. the hop chain is drawn as the path it is, repeats included.

import { StrictMode, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';

import { ExchangeView } from '../src/components/project/exchange/ExchangeView';
import {
  installFakeElectronAPI,
  ok,
  sessionSummary,
  type FakeBridge,
} from './helpers/fake-electron-api';
import type { ExchangeOutcome } from '../src/types';

const ACME = { hash: '-Users-alice-acme', realPath: '/Users/alice/acme' };
const WIDGETS = { hash: '-Users-alice-widgets', realPath: '/Users/alice/widgets' };
const A = 'aaaaaaaa-1111-2222-3333-444444444444';
const B = 'bbbbbbbb-1111-2222-3333-444444444444';
const FP_A = 'a1a1a1a1a1a1a1a1a1a1a1a1';

/** Three messages between A (acme) and B (widgets), B being the session the
 *  page was opened from — the same conversation the reader's tests use. */
function outcome(over: Partial<ExchangeOutcome> = {}): ExchangeOutcome {
  return {
    entryMsgId: 'm1',
    parties: [
      {
        id: A,
        sessionId: A,
        projectHash: ACME.hash,
        projectPath: ACME.realPath,
        sessionTitle: 'Release checklist',
        name: 'acme-lead',
        fingerprint: FP_A,
      },
      {
        id: B,
        sessionId: B,
        projectHash: WIDGETS.hash,
        projectPath: WIDGETS.realPath,
        name: 'widgets-7c',
      },
    ],
    messages: [
      {
        msgId: 'm1',
        from: A,
        to: B,
        timestamp: '2026-03-01T10:00:00Z',
        text: 'ping from acme',
        summary: 'Ping',
        sentTurnUuid: 'a-turn-1',
        receivedUuid: 'b-in-1',
        hops: [A],
      },
      {
        msgId: 'm2',
        from: B,
        to: A,
        timestamp: '2026-03-01T10:00:30Z',
        text: 'pong from widgets',
        sentTurnUuid: 'b-turn-2',
        receivedUuid: 'a-in-2',
        hops: [A, B],
        queued: true,
      },
      {
        msgId: 'm3',
        from: A,
        to: B,
        timestamp: '2026-03-01T10:01:00Z',
        text: 'thanks, closing',
        sentTurnUuid: 'a-turn-3',
        receivedUuid: 'b-in-3',
        hops: [A, B, A],
      },
    ],
    scanned: 3,
    elapsedMs: 8,
    ...over,
  };
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

function mount(props: Partial<Parameters<typeof ExchangeView>[0]> = {}) {
  const onOpenTurn = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </StrictMode>
  );
  const view = render(
    <ExchangeView
      project={WIDGETS}
      sessionId={B}
      msgId="m1"
      onBack={() => {}}
      {...props}
      onOpenTurn={onOpenTurn}
    />,
    { wrapper }
  );
  return { ...view, onOpenTurn };
}

const rows = () => screen.getAllByRole('article');

describe('ExchangeView', () => {
  it('asks for the exchange of the message it was opened on', async () => {
    bridge.api.exchange.get.mockResolvedValue(ok(outcome()));

    mount();

    await waitFor(() => expect(bridge.api.exchange.get).toHaveBeenCalled());
    expect(bridge.api.exchange.get.mock.calls[0][0]).toEqual({ sessionId: B, msgId: 'm1' });
  });

  it('draws the messages in order, each attributed to its sender, and marks the entry', async () => {
    bridge.api.exchange.get.mockResolvedValue(ok(outcome()));

    mount();

    await screen.findByText('thanks, closing');
    const all = rows();
    expect(all.map(r => r.getAttribute('data-msg-id'))).toEqual(['m1', 'm2', 'm3']);
    expect(all.map(r => within(r).getByTestId('sender').textContent)).toEqual([
      'acme-lead',
      'widgets-7c',
      'acme-lead',
    ]);
    // The message the reader came from is the one that is marked — and no other.
    expect(all.map(r => r.getAttribute('aria-current'))).toEqual(['true', null, null]);
    // The one-line summary the sender gave its call, when its transcript had it.
    expect(within(all[0]).getByText('Ping')).toBeTruthy();
    // Arrived while a turn was running: said, as the inbound bubble says it.
    expect(within(all[1]).getByText('mid-turn')).toBeTruthy();
  });

  it('names both parties by project and session', async () => {
    bridge.api.exchange.get.mockResolvedValue(ok(outcome()));

    mount();

    const parties = await screen.findAllByTestId('party');
    expect(parties.map(p => p.textContent)).toEqual([
      expect.stringContaining('acme-lead'),
      expect.stringContaining('widgets-7c'),
    ]);
    expect(parties[0].textContent).toContain('acme');
    expect(parties[0].textContent).toContain('Release checklist');
  });

  it('says a sender is unresolved when its transcript is gone, and offers no turn to open', async () => {
    const gone = `fp:${FP_A}`;
    bridge.api.exchange.get.mockResolvedValue(
      ok(
        outcome({
          parties: [
            { id: gone, name: 'acme-lead', fingerprint: FP_A },
            { id: B, sessionId: B, projectHash: WIDGETS.hash, projectPath: WIDGETS.realPath },
          ],
          messages: [
            {
              msgId: 'm1',
              from: gone,
              to: B,
              timestamp: '2026-03-01T10:00:00Z',
              text: 'ping from acme',
              receivedUuid: 'b-in-1',
              hops: [gone],
            },
          ],
        })
      )
    );

    mount();

    const row = (await screen.findAllByRole('article'))[0];
    expect(within(row).getByTestId('sender').textContent).toBe('acme-lead');
    expect(within(row).queryByRole('button', { name: /sending turn/i })).toBeNull();
    // Where it landed is still on disk, and still reachable.
    expect(within(row).getByRole('button', { name: /where it arrived/i })).toBeTruthy();
    const parties = screen.getAllByTestId('party');
    expect(parties[0].textContent).toContain('transcript not found');
  });

  it('opens the sending turn by resolving the real session from its own project', async () => {
    bridge.api.exchange.get.mockResolvedValue(ok(outcome()));
    bridge.api.sessions.listByProject.mockImplementation(async hash =>
      ok(hash === ACME.hash ? [sessionSummary({ filename: `${A}.jsonl` })] : [])
    );

    const { onOpenTurn } = mount();

    const row = (await screen.findAllByRole('article'))[0];
    fireEvent.click(within(row).getByRole('button', { name: /sending turn/i }));

    await waitFor(() => expect(onOpenTurn).toHaveBeenCalled());
    const [project, session, uuid] = onOpenTurn.mock.calls[0];
    expect(project).toEqual(ACME);
    expect(session.filename).toBe(`${A}.jsonl`);
    expect(uuid).toBe('a-turn-1');
  });

  it('opens the row a message landed on, in the receiving session', async () => {
    bridge.api.exchange.get.mockResolvedValue(ok(outcome()));
    bridge.api.sessions.listByProject.mockImplementation(async hash =>
      ok(hash === WIDGETS.hash ? [sessionSummary({ filename: `${B}.jsonl` })] : [])
    );

    const { onOpenTurn } = mount();

    const row = (await screen.findAllByRole('article'))[0];
    fireEvent.click(within(row).getByRole('button', { name: /where it arrived/i }));

    await waitFor(() => expect(onOpenTurn).toHaveBeenCalled());
    const [project, session, uuid] = onOpenTurn.mock.calls[0];
    expect(project).toEqual(WIDGETS);
    expect(session.filename).toBe(`${B}.jsonl`);
    expect(uuid).toBe('b-in-1');
  });

  it('refuses to open a session that is no longer in its project', async () => {
    bridge.api.exchange.get.mockResolvedValue(ok(outcome()));
    bridge.api.sessions.listByProject.mockResolvedValue(ok([]));

    const { onOpenTurn } = mount();

    const row = (await screen.findAllByRole('article'))[0];
    fireEvent.click(within(row).getByRole('button', { name: /sending turn/i }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('no longer in')
    );
    expect(onOpenTurn).not.toHaveBeenCalled();
  });

  it('draws the hop chain as the path it is, repeats included', async () => {
    bridge.api.exchange.get.mockResolvedValue(ok(outcome()));

    mount();

    const last = (await screen.findAllByRole('article'))[2];
    expect(within(last).getByTestId('hops').textContent).toBe(
      'via acme-lead → widgets-7c → acme-lead'
    );
    // A chain of one is the sender itself: nothing to say.
    expect(within(rows()[0]).queryByTestId('hops')).toBeNull();
  });

  it('draws the pair once and takes a side per message, instead of repeating it', async () => {
    bridge.api.exchange.get.mockResolvedValue(ok(outcome()));

    mount();

    await screen.findByText('thanks, closing');
    // The pair is stated at the top — two chips, the other side first — and
    // the reader's own side is named as such there and nowhere else.
    const parties = screen.getAllByTestId('party');
    expect(parties).toHaveLength(2);
    expect(parties[1].textContent).toContain('this session');
    // Each message then wears its side: the one this session sent, and no other.
    expect(rows().map(r => r.className.includes('is-own'))).toEqual([false, true, false]);
    // And the old per-message "→ receiver" is gone: in a two-party
    // conversation it said the same thing on every row.
    expect(rows()[0].textContent).not.toContain('→ widgets-7c');
  });

  it('gives a run of messages from one party a single face', async () => {
    bridge.api.exchange.get.mockResolvedValue(
      ok(
        outcome({
          messages: [
            {
              msgId: 'm1',
              from: A,
              to: B,
              timestamp: '2026-03-01T10:00:00Z',
              text: 'first',
              receivedUuid: 'b-in-1',
            },
            {
              msgId: 'm2',
              from: A,
              to: B,
              timestamp: '2026-03-01T10:00:05Z',
              text: 'and one more thing',
              receivedUuid: 'b-in-2',
            },
          ],
        })
      )
    );

    mount();

    await screen.findByText('and one more thing');
    const faces = rows().map(r => r.querySelector('.cl-xmsg-face')!.textContent);
    expect(faces).toEqual(['A', '']);
    expect(rows()[1].className).toContain('is-cont');
  });

  it('counts the sides and the span, and keeps the join figures in a title', async () => {
    bridge.api.exchange.get.mockResolvedValue(ok(outcome({ scanned: 329, elapsedMs: 640 })));

    mount();

    const meta = await screen.findByText(/3 messages/);
    expect(meta.textContent).toBe('3 messages · 2 in · 1 out · over 1m');
    // How many transcripts the answer rests on is a fact about the join, not
    // about the conversation: stated, but not as a headline.
    expect(meta.getAttribute('title')).toBe('Joined across 329 transcripts in 640 ms');
  });

  it('folds a long message and unfolds it on ask', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    bridge.api.exchange.get.mockResolvedValue(
      ok(
        outcome({
          messages: [
            {
              msgId: 'm1',
              from: A,
              to: B,
              timestamp: '2026-03-01T10:00:00Z',
              text: long,
              receivedUuid: 'b-in-1',
            },
          ],
        })
      )
    );

    mount();

    const row = (await screen.findAllByRole('article'))[0];
    expect(row.textContent).toContain('line 14');
    expect(row.textContent).not.toContain('line 15');
    fireEvent.click(within(row).getByRole('button', { name: /show all 30 lines/i }));
    expect(rows()[0].textContent).toContain('line 30');
  });

  it('says so when the message is not in that transcript', async () => {
    bridge.api.exchange.get.mockResolvedValue(ok(null));

    mount({ msgId: 'nope' });

    expect(await screen.findByText(/nothing to join on/i)).toBeTruthy();
  });
});
