// @vitest-environment jsdom
//
// Text pasted into a prompt reaches the bubble as its own `pasted` text block
// (the reader drops Claude Code's `<pasted_content>` wrapper): it is drawn apart
// from what the user typed, and a long one folds without leaving the DOM.

import { describe, it, expect, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { MessageBubble } from '../src/components/project/chat/MessageBubble';
import { buildProcessedMessages } from '../src/components/project/chat/utils';
import type { ChatMessage } from '../src/types';

afterEach(cleanup);

function mount(pasted: string) {
  const message: ChatMessage = {
    uuid: 'u1',
    role: 'user',
    timestamp: '2026-09-08T15:53:19.660Z',
    content: [
      { type: 'text', text: 'what does this print?' },
      { type: 'text', text: pasted, pasted: true },
    ],
  };
  const [processed] = buildProcessedMessages([message]);
  return render(
    <StrictMode>
      <MessageBubble processed={processed} detailsFilter="minimal" onOpenToolDetail={() => {}} />
    </StrictMode>
  );
}

describe('text pasted into a prompt', () => {
  it('is drawn apart from the typed text, under its label', () => {
    const { container } = mount('print(1 + 1)');

    expect(container.querySelector('.cl-message-text--user')?.textContent).toBe(
      'what does this print?'
    );
    const block = container.querySelector('.cl-pasted');
    expect(block?.querySelector('.cl-pasted-label')?.textContent).toBe('Pasted');
    expect(block?.querySelector('.cl-pasted-text')?.textContent).toBe('print(1 + 1)');
    expect(block?.querySelector('button')).toBeNull();
  });

  it('folds a long paste and unfolds it on request, keeping all of it in the DOM', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `row ${i + 1}`).join('\n');
    const { container, getByRole } = mount(lines);

    const block = container.querySelector('.cl-pasted');
    expect(block?.classList.contains('is-clamped')).toBe(true);
    expect(block?.querySelector('.cl-pasted-text')?.textContent).toBe(lines);

    fireEvent.click(getByRole('button', { name: 'Show all 30 lines' }));
    expect(block?.classList.contains('is-clamped')).toBe(false);
    expect(getByRole('button', { name: 'Collapse' })).toBeTruthy();
  });
});
