// @vitest-environment jsdom
//
// Two claims about what a turn's header says about the turn's provenance, both
// of which used to be silently wrong (#245, #246):
//
//  - a message typed while Claude was working was invisible, so the transcript
//    showed Claude answering nobody; now it is a normal user bubble wearing a
//    "sent mid-turn" chip;
//  - a slash command that expanded into a skill was drawn as a plain command,
//    because the only signal for it (`isSkill`) is set from a transcript row
//    the SDK read drops.

import { describe, it, expect, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { AdvisorBadge, MessageBubble } from '../src/components/project/chat/MessageBubble';
import {
  buildProcessedMessages,
  buildRenderItems,
  describeTurn,
} from '../src/components/project/chat/utils';
import type { ChatDetailsFilter } from '../src/components/project/chat/utils';
import type { AdvisorConsult, ChatMessage } from '../src/types';

afterEach(cleanup);

function userMessage(text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    uuid: 'u1',
    role: 'user',
    timestamp: '2026-09-08T15:53:19.660Z',
    content: [{ type: 'text', text }],
    ...extra,
  };
}

// Mounted the way `src/main.tsx` mounts: StrictMode runs every effect, its
// cleanup and the effect again, which is the rehearsal a component with state
// of its own — the inbound message's fold — has to survive.
function mount(message: ChatMessage) {
  const [processed] = buildProcessedMessages([message]);
  return render(
    <StrictMode>
      <MessageBubble processed={processed} detailsFilter="minimal" onOpenToolDetail={() => {}} />
    </StrictMode>
  );
}

describe('a message absorbed into the running turn', () => {
  it('wears the mid-turn chip', () => {
    const { container } = mount(userMessage('metti anche il changelog', { queued: true }));

    const chip = container.querySelector('.cl-turn-queued-badge');
    expect(chip?.textContent).toBe('sent mid-turn');
    expect(container.querySelector('.cl-message-text--user')?.textContent).toBe(
      'metti anche il changelog'
    );
  });

  it('leaves an ordinary user turn unmarked', () => {
    const { container } = mount(userMessage('fai la cosa'));
    expect(container.querySelector('.cl-turn-queued-badge')).toBeNull();
  });
});

describe('a slash command that expanded into a skill', () => {
  const commandText = '<command-name>/build-dmg</command-name>';

  it('is drawn as a skill once the transcript hands over its path', () => {
    const { container } = mount(
      userMessage(commandText, { skillPath: '/Users/x/.claude/skills/build-dmg' })
    );

    expect(container.querySelector('.cl-skill-card')).not.toBeNull();
    expect(container.querySelector('.cl-skill-tag')?.textContent).toBe('Skill');
  });

  it('stays a plain command when nothing says it was a skill', () => {
    const { container } = mount(userMessage(commandText));

    expect(container.querySelector('.cl-skill-card')).toBeNull();
    expect(container.querySelector('.cl-command-card')).not.toBeNull();
  });
});

// An `advisor` consult: Claude asked a stronger reviewer model to look at the
// conversation. The reviewer answers Claude, not the user, and Claude Code
// stores that answer encrypted — so the transcript can only ever say that a
// consult happened, not what was said. It is also persisted as a row of its own,
// which in minimal mode sits between two halves of the same assistant message
// that both collapse: hence a stream marker rather than a chip on a neighbour.
describe('an advisor consult', () => {
  const consult: AdvisorConsult = {
    type: 'advisor',
    id: 'srvtoolu_1',
    model: 'claude-opus-5',
    inputTokens: 60059,
    outputTokens: 4085,
    durationSeconds: 62,
  };

  function advisorMessage(extra: Partial<ChatMessage> = {}): ChatMessage {
    return {
      uuid: 'a2',
      role: 'assistant',
      timestamp: '2026-09-08T21:19:17.834Z',
      model: 'claude-opus-5',
      content: [consult],
      ...extra,
    };
  }

  function streamItems(messages: ChatMessage[], detailsFilter: ChatDetailsFilter) {
    const processed = buildProcessedMessages(messages);
    return buildRenderItems(
      processed,
      processed.map(p => describeTurn(p, detailsFilter))
    );
  }

  it('is a stream marker of its own, in both density modes', () => {
    for (const detailsFilter of ['all', 'minimal'] as const) {
      const items = streamItems([advisorMessage()], detailsFilter);
      expect(items).toEqual([{ kind: 'advisor', key: 'advisor-0', consult }]);
    }
  });

  it('states the reviewer, the wall time and the spend — and nothing else', () => {
    const { container } = render(<AdvisorBadge consult={consult} />);

    const badge = container.querySelector('.cl-advisor-badge');
    expect(badge?.textContent).toBe('advisorOpus 5 · 1m2s · 64k tok');
    // No expandable card: there is no advice to open.
    expect(container.querySelector('button')).toBeNull();
  });

  it('degrades to the bare marker when the turn holds more than one consult', () => {
    // Two consults in one assistant message share a single usage object, so the
    // reader reports no spend for either (see session-reader.test.ts).
    const { container } = render(<AdvisorBadge consult={{ type: 'advisor', id: 'srvtoolu_1' }} />);

    expect(container.querySelector('.cl-advisor-badge')?.textContent).toBe('advisor');
    expect(container.querySelector('.cl-advisor-detail')).toBeNull();
  });

  it('rides the turn header when it shares a message with other content', () => {
    // The live stream hands over a whole assistant message at once, where a
    // stored transcript splits it into rows.
    const { container } = mount(
      advisorMessage({ content: [consult, { type: 'text', text: 'ok, procedo' }] })
    );

    expect(container.querySelector('.cl-advisor-badge')?.textContent).toContain('advisor');
  });
});

// ─── A message this session did not type (#274) ──────────────────────────────

const LONG_BODY = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');

describe('a message from another session', () => {
  it('names the sender and says it is another session', () => {
    const { container } = mount(
      userMessage('the fork inventory is done, nothing pushed', {
        inbound: { from: 'session', name: 'alice-7c', pid: 4242, msgId: 'm-1' },
      })
    );

    expect(container.querySelector('.cl-inbound-from')?.textContent).toBe('alice-7c');
    expect(container.querySelector('.cl-inbound-what')?.textContent).toBe('another session');
    expect(container.querySelector('.cl-inbound-body')?.textContent).toContain(
      'the fork inventory is done'
    );
    // Not a user bubble: the strip is what tells the reader it was not them.
    expect(container.querySelector('.cl-message-text--user')).toBeNull();
  });

  it('tells an agent inside this session apart from another session', () => {
    const { container } = mount(
      userMessage('teammate reporting in', {
        inbound: { from: 'agent', name: 'worker-b' },
      })
    );
    expect(container.querySelector('.cl-inbound-what')?.textContent).toBe('agent in this session');
    expect(container.querySelector('.cl-inbound--agent')).not.toBeNull();
  });

  it('marks one that arrived while a turn was running', () => {
    const { container } = mount(
      userMessage('ping', { inbound: { from: 'session', name: 'alice-7c', queued: true } })
    );
    expect(container.querySelector('.cl-inbound-queued')?.textContent).toBe('mid-turn');
  });

  it('opens folded and unfolds on ask, surviving the StrictMode remount', () => {
    const { container } = mount(
      userMessage(LONG_BODY, { inbound: { from: 'session', name: 'alice-7c' } })
    );

    const body = () => container.querySelector('.cl-inbound-body')?.textContent ?? '';
    expect(body()).toContain('line 12');
    expect(body()).not.toContain('line 13');

    const more = container.querySelector('.cl-inbound-more') as HTMLButtonElement;
    expect(more.textContent).toBe('Show all 30 lines');
    fireEvent.click(more);
    expect(body()).toContain('line 30');
  });

  it('draws a short one without a fold control at all', () => {
    const { container } = mount(
      userMessage('two words', { inbound: { from: 'session', name: 'alice-7c' } })
    );
    expect(container.querySelector('.cl-inbound-more')).toBeNull();
  });
});

describe('a harness notice', () => {
  it('is a one-line marker with its subject, never a turn', () => {
    const { container } = mount(
      userMessage('"alice-7c" is idle now — it finished a turn at 21:23.', {
        notice: {
          kind: 'session-idle',
          subject: 'alice-7c',
          text: '"alice-7c" is idle now — it finished a turn at 21:23.',
        },
      })
    );

    expect(container.querySelector('.cl-notice-badge')?.textContent).toContain('session idle');
    expect(container.querySelector('.cl-notice-subject')?.textContent).toBe('alice-7c');
    expect(container.querySelector('.cl-notice-text')?.textContent).toContain('is idle now');
    expect(container.querySelector('.cl-inbound')).toBeNull();
    expect(container.querySelector('.cl-message-text--user')).toBeNull();
  });

  it('says an agent finished, not that a session did', () => {
    const { container } = mount(
      userMessage('Done, the sweep found nothing.', {
        notice: { kind: 'agent-idle', subject: 'worker-b', text: 'Done, the sweep found nothing.' },
      })
    );
    expect(container.querySelector('.cl-notice-badge')?.textContent).toContain('agent done');
  });
});
