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
import type { AdvisorConsult, ChatMessage, SentMessage } from '../src/types';

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
function mount(message: ChatMessage, extra: Partial<Parameters<typeof MessageBubble>[0]> = {}) {
  const [processed] = buildProcessedMessages([message]);
  return render(
    <StrictMode>
      <MessageBubble
        processed={processed}
        detailsFilter="minimal"
        onOpenToolDetail={() => {}}
        {...extra}
      />
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
  /** Opening the row: the whole line is the disclosure, so the message body is
   *  behind the same click a reader would make. */
  const openRow = (container: HTMLElement) =>
    fireEvent.click(container.querySelector('.cl-msg-toggle') as HTMLButtonElement);

  it('names the sender, previews what was said, and tells who it is once opened', () => {
    const { container } = mount(
      userMessage('the fork inventory is done, nothing pushed', {
        inbound: { from: 'session', name: 'alice-7c', pid: 4242, msgId: 'm-1' },
      })
    );

    expect(container.querySelector('.cl-msg--in')).not.toBeNull();
    expect(container.querySelector('.cl-msg-dir')?.textContent).toBe('from');
    expect(container.querySelector('.cl-msg-who')?.textContent).toBe('alice-7c');
    expect(container.querySelector('.cl-msg-preview')?.textContent).toContain(
      'the fork inventory is done'
    );
    // The message itself is one click away, and so is who the sender is.
    expect(container.querySelector('.cl-msg-body')).toBeNull();
    openRow(container);
    expect(container.querySelector('.cl-msg-body')?.textContent).toContain(
      'the fork inventory is done'
    );
    expect(container.querySelector('.cl-msg-what')?.textContent).toBe('another session');
    // Not a user bubble: the row is what tells the reader it was not them.
    expect(container.querySelector('.cl-message-text--user')).toBeNull();
  });

  it('tells an agent inside this session apart from another session', () => {
    const { container } = mount(
      userMessage('teammate reporting in', {
        inbound: { from: 'agent', name: 'worker-b' },
      })
    );
    expect(container.querySelector('.cl-msg--agent')).not.toBeNull();
    expect(container.querySelector('.cl-msg-tag')?.textContent).toBe('agent');
    openRow(container);
    expect(container.querySelector('.cl-msg-what')?.textContent).toBe('agent in this session');
  });

  it("names an agent's hand-back after its dispatch, or by its task id when that is all there is", () => {
    const { container } = mount(
      userMessage('## Findings', {
        inbound: { from: 'agent', taskId: 'a1', handback: true, name: 'Survey the fixtures' },
      })
    );
    expect(container.querySelector('.cl-msg-who')?.textContent).toBe('Survey the fixtures');
    expect(container.querySelector('.cl-msg-toggle')?.getAttribute('title')).toBe(
      'The final report of an agent this session ran in the background.'
    );

    const unnamed = mount(
      userMessage('## Findings', { inbound: { from: 'agent', taskId: 'a9', handback: true } })
    );
    expect(unnamed.container.querySelector('.cl-msg-who')?.textContent).toBe('agent a9');
  });

  it('marks one that arrived while a turn was running', () => {
    const { container } = mount(
      userMessage('ping', { inbound: { from: 'session', name: 'alice-7c', queued: true } })
    );
    expect(container.querySelector('.cl-msg-tag.is-queued')?.textContent).toBe('mid-turn');
  });

  it('opens on ask and shows the whole message, surviving the StrictMode remount', () => {
    const { container } = mount(
      userMessage(LONG_BODY, { inbound: { from: 'session', name: 'alice-7c' } })
    );

    // Folded: one line of preview, and it is the first line of the message.
    expect(container.querySelector('.cl-msg-preview')?.textContent).toBe('line 1');
    expect(container.querySelector('.cl-msg-body')).toBeNull();

    openRow(container);
    const body = container.querySelector('.cl-msg-body')?.textContent ?? '';
    expect(body).toContain('line 1');
    expect(body).toContain('line 30');
  });

  // The way into the exchange is Mission Control's MESSAGES dock, which groups
  // the conversation by counterpart; a link on every message in the stream was
  // the chrome this row exists to shed, so the row carries no control at all.
  it('carries no control of its own — the exchange is reached from Mission Control', () => {
    const { container } = mount(
      userMessage('ping', { inbound: { from: 'session', name: 'alice-7c', msgId: 'm-1' } })
    );
    expect(container.textContent).not.toContain('Show exchange');
    // The only button is the row itself, which opens the message.
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });
});

describe('a message sent to another session', () => {
  /** The sender's half as the reader hands it over: the `SendMessage` call in
   *  an assistant turn and its result, the delivery stamped on the result by
   *  `transcript-extras` (or by the file reader) from `toolUseResult`. */
  function sentTurn(opts: {
    to?: string;
    message?: string;
    summary?: string;
    sent?: SentMessage;
    result?: 'none' | 'ok' | 'error';
  }): ChatMessage[] {
    const input: Record<string, unknown> = {
      to: opts.to ?? 'alice-7c',
      message: opts.message ?? 'what are you working on right now?',
      ...(opts.summary ? { summary: opts.summary } : {}),
      // Claude Code echoes the message here, cut with an ellipsis — never read.
      content: 'what are you working on ri…',
    };
    const assistant: ChatMessage = {
      uuid: 'a1',
      role: 'assistant',
      timestamp: '2026-09-20T09:17:58.000Z',
      model: 'claude-opus-5',
      content: [
        { type: 'text', text: 'Asking.' },
        { type: 'tool_use', id: 'toolu_send1', name: 'SendMessage', input },
      ],
    };
    if (opts.result === 'none') return [assistant];
    const result: ChatMessage = {
      uuid: 'r1',
      role: 'user',
      timestamp: '2026-09-20T09:17:59.000Z',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'toolu_send1',
          content:
            opts.result === 'error'
              ? 'Error: socket closed'
              : '{"success":true,"message":"“Asking” → alice-7c (another Claude session on this machine; queued there)","msg_id":"m-1"}',
          isError: opts.result === 'error',
          ...(opts.sent ? { sent: opts.sent } : {}),
        },
      ],
    };
    return [assistant, result];
  }

  function mountTurn(
    messages: ChatMessage[],
    detailsFilter: ChatDetailsFilter,
    extra: Partial<Parameters<typeof MessageBubble>[0]> = {}
  ) {
    // The result-only user message is absorbed into the assistant turn.
    const [processed] = buildProcessedMessages(messages);
    return render(
      <StrictMode>
        <MessageBubble
          processed={processed}
          detailsFilter={detailsFilter}
          onOpenToolDetail={() => {}}
          {...extra}
        />
      </StrictMode>
    );
  }

  const delivered: SentMessage = { msgId: 'm-1', to: 'session' };

  it('is drawn as a message — to whom, its summary, its text — not as a tool card', () => {
    const { container } = mountTurn(
      sentTurn({ summary: 'Asking what it is doing', sent: delivered }),
      'all'
    );

    const bubble = container.querySelector('.cl-outbound');
    expect(bubble).not.toBeNull();
    expect(bubble?.querySelector('.cl-msg--out')).not.toBeNull();
    expect(bubble?.querySelector('.cl-msg-dir')?.textContent).toBe('to');
    expect(bubble?.querySelector('.cl-msg-who')?.textContent).toBe('alice-7c');
    // The one line is the summary the call gave the message.
    expect(bubble?.querySelector('.cl-msg-preview')?.textContent).toBe('Asking what it is doing');
    expect(bubble?.querySelector('.cl-msg-state')?.textContent).toBe('SENT');

    fireEvent.click(bubble?.querySelector('.cl-msg-toggle') as HTMLButtonElement);
    expect(bubble?.querySelector('.cl-msg-body')?.textContent).toContain(
      'what are you working on right now?'
    );
    // The generic card, with the result JSON in it, is gone.
    expect(container.querySelector('.cl-tool-card')).toBeNull();
    expect(container.textContent).not.toContain('"success":true');
  });

  it('stays on screen in minimal density, as one line, and never reads the echo', () => {
    const { container } = mountTurn(
      sentTurn({ summary: 'Asking what it is doing', sent: delivered }),
      'minimal'
    );

    const bubble = container.querySelector('.cl-outbound.is-compact');
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toContain('alice-7c');
    expect(bubble?.textContent).toContain('Asking what it is doing');
    expect(bubble?.querySelector('.cl-msg-body')).toBeNull();
    expect(container.textContent).not.toContain('ri…');
  });

  it('names an agent inside this session, and offers no exchange control either', () => {
    const agent = mountTurn(
      sentTurn({ to: 'worker-b', sent: { msgId: 'm-2', to: 'agent' } }),
      'all'
    );
    expect(agent.container.textContent).not.toContain('Show exchange');
    expect(agent.container.querySelector('.cl-msg--agent')).not.toBeNull();
    fireEvent.click(agent.container.querySelector('.cl-msg-toggle') as HTMLButtonElement);
    expect(agent.container.querySelector('.cl-msg-what')?.textContent).toBe(
      'agent in this session'
    );
  });

  it('says what the transcript knows about a call that delivered nothing', () => {
    const pending = mountTurn(sentTurn({ result: 'none' }), 'all');
    expect(pending.container.querySelector('.cl-msg-state')?.textContent).toBe('SENDING');
    pending.unmount();

    const failed = mountTurn(sentTurn({ result: 'error' }), 'all');
    expect(failed.container.querySelector('.cl-msg-state')?.textContent).toBe('FAILED');
    // The tool's own answer is there, under the opened message, for whoever wants it.
    fireEvent.click(failed.container.querySelector('.cl-msg-toggle') as HTMLButtonElement);
    const more = failed.container.querySelector('.cl-msg-more') as HTMLButtonElement;
    expect(more?.textContent).toBe('Show what the tool answered');
    expect(failed.container.textContent).not.toContain('socket closed');
    fireEvent.click(more);
    expect(failed.container.textContent).toContain('socket closed');
    failed.unmount();

    // Answered, no id: nothing was delivered, and nothing is claimed.
    const undelivered = mountTurn(sentTurn({}), 'all');
    expect(undelivered.container.querySelector('.cl-msg-state')?.textContent).toBe('NO DELIVERY');
  });

  it('opens on ask, surviving the StrictMode remount', () => {
    const { container } = mountTurn(sentTurn({ message: LONG_BODY, sent: delivered }), 'all');

    // With no summary the row previews the message's own first line.
    expect(container.querySelector('.cl-msg-preview')?.textContent).toBe('line 1');
    expect(container.querySelector('.cl-msg-body')).toBeNull();
    fireEvent.click(container.querySelector('.cl-msg-toggle') as HTMLButtonElement);
    expect(container.querySelector('.cl-msg-body')?.textContent).toContain('line 30');
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

// ─── A thinking block the terminal prints as a message ───────────────────────

describe('a thinking block', () => {
  const NOTE = 'Ho scoperto che le righe dei `Read` sono numerate con una tabulazione.\n\n';
  const REASONING = 'Let me weigh the options. ' + 'x'.repeat(700);

  function thinkingRow(thinking: string, uuid = 'th1'): ChatMessage {
    return {
      uuid,
      role: 'assistant',
      timestamp: '2026-09-22T19:09:38.000Z',
      model: 'claude-opus-5-5',
      content: [{ type: 'thinking', thinking }],
    };
  }

  it('is drawn inline as a labelled note in both densities, never folded', () => {
    for (const detailsFilter of ['minimal', 'all'] as const) {
      const { container } = mount(thinkingRow(NOTE), { detailsFilter });

      const note = container.querySelector('.cl-thinking-note');
      expect(note?.querySelector('.cl-thinking-note-tag')?.textContent).toBe('Thinking');
      // Markdown, trimmed: the backticked name is code, the trailing blank lines are gone.
      const body = note?.querySelector('.cl-thinking-note-body');
      expect(body?.querySelector('code')?.textContent).toBe('Read');
      expect(body?.textContent).toBe(
        'Ho scoperto che le righe dei Read sono numerate con una tabulazione.'
      );
      // Painted by find, but not a highlight block (those index the text blocks).
      expect(body?.getAttribute('data-find-block')).toBe('th1:think-0');
      expect(body?.hasAttribute('data-hl-block')).toBe(false);
      expect(container.querySelector('.cl-thinking-toggle')).toBeNull();
      cleanup();
    }
  });

  it('keeps raw reasoning out of MIN and folded behind its toggle in FULL', () => {
    const min = mount(thinkingRow(REASONING), { detailsFilter: 'minimal' });
    expect(min.container.querySelector('.cl-turn')).toBeNull();
    cleanup();

    const full = mount(thinkingRow(REASONING), { detailsFilter: 'all' });
    expect(full.container.querySelector('.cl-thinking-note')).toBeNull();
    const toggle = full.container.querySelector('.cl-thinking-toggle') as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(full.container.querySelector('.cl-thinking-body')?.textContent).toBe(REASONING);
  });

  it('makes its row a turn in MIN, so the shell run after it folds into it', () => {
    // The shape that went missing: a note row, then a Bash-only row. Without the
    // note the pair read as nothing plus a stray "1 tool hidden" badge.
    const bash: ChatMessage = {
      uuid: 'b1',
      role: 'assistant',
      timestamp: '2026-09-22T19:09:38.100Z',
      content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }],
    };
    const processed = buildProcessedMessages([thinkingRow(NOTE), bash]);
    const descriptors = processed.map(p => describeTurn(p, 'minimal'));

    expect(descriptors[0]).toMatchObject({ visible: true, toolsOnly: false, variant: 'claude' });
    expect(buildRenderItems(processed, descriptors)).toEqual([
      { kind: 'turn', idx: 0, hiddenCount: 1, hiddenFiles: [] },
    ]);
  });
});
