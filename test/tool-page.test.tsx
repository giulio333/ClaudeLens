// @vitest-environment jsdom
//
// A tool call opened over a session, in a frame that owns the crumb and the
// close (Mission Control, the remote Lens), is a page like a file's: the shared
// head, the body unclamped, the status in the foot — not a terminal window with
// its own title bar inside the page. The same call inline in the transcript
// stays the window it is there.

import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ToolDetailPanel } from '../src/components/project/chat/ToolDetailPanel';
import { MessageBubble } from '../src/components/project/chat/MessageBubble';
import { buildProcessedMessages } from '../src/components/project/chat/utils';
import type { ToolGroup } from '../src/components/project/chat/utils';
import type { ChatMessage } from '../src/types';

afterEach(cleanup);

const OUTPUT = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join('\n');

const group = (name: string, input: Record<string, unknown>, content: string): ToolGroup => ({
  use: { type: 'tool_use', id: 't1', name, input },
  result: { type: 'tool_result', toolUseId: 't1', content, isError: false },
});
const bash = group(
  'Bash',
  { command: 'cat a.md && cat b.md', description: 'Reads the notes' },
  OUTPUT
);

const mount = (g: ToolGroup, chromeless: boolean) =>
  render(
    <StrictMode>
      <ToolDetailPanel group={g} onBack={() => {}} chromeless={chromeless} />
    </StrictMode>
  );

describe('a tool call as a page over the session', () => {
  it('draws a shell run under the shared head, unclamped, its status in the foot', () => {
    const { container } = mount(bash, true);
    expect(container.querySelector('.cl-fview-head .cl-fview-name')?.textContent).toBe(
      'Reads the notes'
    );
    expect(container.querySelector('.cl-term-lights')).toBeNull();
    expect(container.textContent).not.toMatch(/Show all/);
    expect(container.textContent).toContain('line 80');
    expect(container.querySelector('.cl-fview-foot')?.textContent).toBe('80 lines');
  });

  it('draws a read under the file head, with the markdown reading switch', () => {
    const { container } = mount(
      group('Read', { file_path: '/p/docs/notes.md' }, '1\t# Notes\n2\tbody'),
      true
    );
    expect(container.querySelector('.cl-fview-name')?.textContent).toBe('notes.md');
    expect(container.querySelector('.cl-fview-seg')).toBeTruthy();
    expect(container.querySelector('.cl-term-lights')).toBeNull();
  });

  it('opens an edit as its change, the page a CHANGES row opens', () => {
    const { container } = mount(
      group('Edit', { file_path: '/p/a.ts', old_string: 'x', new_string: 'y' }, 'updated'),
      true
    );
    expect(container.querySelector('.cl-file-change--page .cl-fview-name')?.textContent).toBe(
      'a.ts'
    );
  });

  it('keeps the window with its own bar where the panel draws its own chrome', () => {
    const { container } = mount(bash, false);
    expect(container.querySelector('.cl-term-bar')).toBeTruthy();
    expect(container.querySelector('.cl-term-page')).toBeNull();
  });
});

describe('the same call in the transcript', () => {
  it('stays a window among the turns', () => {
    const messages: ChatMessage[] = [
      {
        uuid: 'a1',
        role: 'assistant',
        timestamp: '2026-10-05T10:00:00.000Z',
        content: [{ type: 'text', text: 'Reading.' }, bash.use],
      },
      { uuid: 'u1', role: 'user', timestamp: '2026-10-05T10:00:01.000Z', content: [bash.result!] },
    ];
    const [processed] = buildProcessedMessages(messages);
    const { container } = render(
      <StrictMode>
        <MessageBubble processed={processed} detailsFilter="all" onOpenToolDetail={() => {}} />
      </StrictMode>
    );
    expect(container.querySelector('.cl-term-bar')).toBeTruthy();
    expect(container.querySelector('.cl-term-page')).toBeNull();
  });
});
