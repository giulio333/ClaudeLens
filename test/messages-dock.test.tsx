// @vitest-environment jsdom
//
// The messages dock: Mission Control's own surface for the conversations a
// session is having. It is deliberately NOT a feed species — a feed row is one
// operation with an outcome, a message is a line in a conversation — so what is
// asserted here is that it reads as a conversation list and routes each thread
// where its other half actually is.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { MessagesDock } from '../src/components/project/terminal/MessagesDock';
import type { MessageThread } from '../src/components/project/terminal/mission-messages';

afterEach(cleanup);

const NOW = Date.parse('2026-08-11T11:00:00.000Z');
const at = (minutesAgo: number) => NOW - minutesAgo * 60_000;

function thread(
  over: Partial<MessageThread> & Pick<MessageThread, 'key' | 'party'>
): MessageThread {
  const last = over.last ?? {
    direction: 'in' as const,
    at: at(7),
    text: 'idle here too',
    turnN: 3,
  };
  return {
    kind: 'session',
    messages: over.messages ?? [last],
    received: 1,
    sent: 1,
    ...over,
    last,
  };
}

function mount(threads: MessageThread[], extra: Partial<Parameters<typeof MessagesDock>[0]> = {}) {
  return render(
    <StrictMode>
      <MessagesDock threads={threads} now={NOW} onLocateTurn={() => {}} {...extra} />
    </StrictMode>
  );
}

describe('the messages dock', () => {
  it('draws one card per counterpart, with what it is and the last thing said', () => {
    const { container } = mount([
      thread({ key: 'pid:900', party: 'acme-37', received: 2, sent: 1, msgId: 'm-2' }),
    ]);

    const card = container.querySelector('[data-testid="thread"]')!;
    expect(card.querySelector('.cl-msgdock-party')?.textContent).toBe('acme-37');
    expect(card.querySelector('.cl-msgdock-what')?.textContent).toBe('session');
    expect(card.querySelector('.cl-msgdock-preview')?.textContent).toBe('idle here too');
    expect(card.querySelector('.cl-msgdock-time')?.textContent).toBe('7m');
    // The counts are a hover fact, not a fourth column.
    expect(card.getAttribute('title')).toContain('2 received · 1 sent');
  });

  it('prefers the summary a sent message carried over its text', () => {
    const { container } = mount([
      thread({
        key: 'pid:900',
        party: 'acme-37',
        last: {
          direction: 'out',
          at: at(2),
          text: 'a long message nobody wants in a one-line preview',
          summary: 'Asking what it is doing',
          state: 'sent',
          turnN: 4,
        },
      }),
    ]);
    expect(container.querySelector('.cl-msgdock-preview')?.textContent).toBe(
      'Asking what it is doing'
    );
  });

  it('opens the exchange when the thread has an id, and locates the turn when it has none', () => {
    const onOpenExchange = vi.fn();
    const onLocateTurn = vi.fn();
    const { container } = mount(
      [
        thread({ key: 'pid:900', party: 'acme-37', msgId: 'm-2' }),
        thread({
          key: 'agent:worker-b',
          party: 'worker-b',
          kind: 'agent',
          last: { direction: 'in', at: at(20), text: 'done', turnN: 9 },
        }),
      ],
      { onOpenExchange, onLocateTurn }
    );

    const [session, agent] = [...container.querySelectorAll('[data-testid="thread"]')];
    fireEvent.click(session);
    expect(onOpenExchange).toHaveBeenCalledWith('m-2');

    fireEvent.click(agent);
    expect(onLocateTurn).toHaveBeenCalledWith(9);
    expect(onOpenExchange).toHaveBeenCalledTimes(1);
    expect(agent.querySelector('.cl-msgdock-what')?.textContent).toBe('agent in this session');
  });

  it('says so when the last message did not leave, instead of counting it', () => {
    const { container } = mount([
      thread({
        key: 'name:acme-9d',
        party: 'acme-9d',
        last: { direction: 'out', at: at(1), text: 'hello?', state: 'failed', turnN: 2 },
      }),
    ]);
    expect(container.querySelector('.cl-msgdock-state')?.textContent).toBe('FAILED');
    expect(container.querySelector('.cl-msgdock-count')).toBeNull();
  });

  it('folds away on ask and stays folded across the StrictMode remount', () => {
    const { container } = mount([thread({ key: 'pid:900', party: 'acme-37' })]);

    const head = container.querySelector('.cl-msgdock-head') as HTMLButtonElement;
    expect(container.querySelectorAll('[data-testid="thread"]')).toHaveLength(1);
    fireEvent.click(head);
    expect(container.querySelectorAll('[data-testid="thread"]')).toHaveLength(0);
    expect(head.getAttribute('aria-expanded')).toBe('false');
  });

  it('is not on screen at all for a session that talked to nobody', () => {
    const { container } = mount([]);
    expect(container.querySelector('.cl-msgdock')).toBeNull();
  });
});
