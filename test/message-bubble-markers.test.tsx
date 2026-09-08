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
import { MessageBubble } from '../src/components/project/chat/MessageBubble';
import { buildProcessedMessages } from '../src/components/project/chat/utils';
import type { ChatMessage } from '../src/types';

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
