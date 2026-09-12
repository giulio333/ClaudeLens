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
import { cleanup, render } from '@testing-library/react';
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

function mount(message: ChatMessage) {
  const [processed] = buildProcessedMessages([message]);
  return render(
    <MessageBubble processed={processed} detailsFilter="minimal" onOpenToolDetail={() => {}} />
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
