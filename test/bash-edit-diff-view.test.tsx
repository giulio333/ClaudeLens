// @vitest-environment jsdom
//
// What a shell command changed on disk, drawn under the terminal window that ran
// it (#265).
//
// The gap this closes is specific to how Claude Code edits files: `Edit` leaves
// a tool call the transcript can render, while a `sed -i` or a heredoc leaves
// only a command and its stdout — so a turn that rewrote four files read as a
// turn that ran a shell command. Claude Code records the hunks on the result
// row; these are the claims about showing them.

import { describe, it, expect, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { MessageBubble } from '../src/components/project/chat/MessageBubble';
import { buildProcessedMessages } from '../src/components/project/chat/utils';
import type { BashEditDiff, ChatMessage } from '../src/types';

afterEach(cleanup);

const hunk = (lines: string[], at = 12) => ({
  oldStart: at,
  oldLines: 3,
  newStart: at,
  newLines: lines.filter(l => !l.startsWith('-')).length,
  lines,
});

/** The assistant turn that ran the command, plus the user row carrying its
 *  result — the shape `buildProcessedMessages` folds into one tool group. */
function transcript(diff?: BashEditDiff): ChatMessage[] {
  return [
    {
      uuid: 'a1',
      role: 'assistant',
      timestamp: '2026-09-08T15:53:19.660Z',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_bash1',
          name: 'Bash',
          input: { command: "sed -i '' s/a/b/ src/app.ts", description: 'Rename the symbol' },
        },
      ],
    },
    {
      uuid: 'u1',
      role: 'user',
      timestamp: '2026-09-08T15:53:20.100Z',
      content: [
        {
          type: 'tool_result',
          toolUseId: 'toolu_bash1',
          content: '',
          isError: false,
          ...(diff ? { bashEditDiff: diff } : {}),
        },
      ],
    },
  ];
}

/** Mounted the way the app mounts (`src/main.tsx`): inside `StrictMode`, whose
 *  mount/unmount/remount rehearsal is what catches a component that only works
 *  the first time it is drawn.
 *
 *  The tool card opens on click, as it does for a reader — the run, and with it
 *  the diff, lives in the expanded card. */
function mount(diff?: BashEditDiff) {
  const [processed] = buildProcessedMessages(transcript(diff));
  const rendered = render(
    <StrictMode>
      <MessageBubble processed={processed} detailsFilter="all" onOpenToolDetail={() => {}} />
    </StrictMode>
  );
  act(() => {
    rendered.container.querySelector<HTMLButtonElement>('.cl-tool-card-main')?.click();
  });
  return rendered;
}

const rowsOf = (container: HTMLElement, kind: string) =>
  [...container.querySelectorAll(`.cl-term-diff-row.is-${kind}`)].map(el => el.textContent);

describe('the files a Bash command edited', () => {
  it('draws the hunk under the run, added and removed lines apart', () => {
    const { container } = mount({
      files: [
        {
          filePath: '/p/src/app.ts',
          hunks: [hunk([' const a = 1;', '-  return a;', '+  return b;'])],
        },
      ],
      changedFiles: ['/p/src/app.ts'],
      moreFiles: 0,
    });

    expect(container.querySelector('.cl-term-diff-title')?.textContent).toBe('1 file changed');
    expect(rowsOf(container, 'path')).toEqual(['/p/src/app.ts']);
    expect(rowsOf(container, 'hunk')).toEqual(['@@ -12,3 +12,2 @@']);
    expect(rowsOf(container, 'add')).toEqual(['+  return b;']);
    expect(rowsOf(container, 'del')).toEqual(['-  return a;']);
  });

  it('marks a created or deleted file instead of printing it', () => {
    const { container } = mount({
      files: [
        { filePath: '/p/new.ts', hunks: [hunk(['+export const x = 1;'])], created: true },
        { filePath: '/p/old.ts', hunks: [], deleted: true },
      ],
      changedFiles: ['/p/new.ts', '/p/old.ts'],
      moreFiles: 0,
    });

    expect(rowsOf(container, 'path')).toEqual(['/p/new.ts · new file', '/p/old.ts · deleted']);
    expect(container.querySelector('.cl-term-diff-title')?.textContent).toBe('2 files changed');
  });

  it('says a diff was unavailable rather than drawing an empty one', () => {
    // An empty body would read as "the command changed nothing", which is a
    // different claim from "Claude Code could not produce the diff".
    const { container } = mount({ files: [], changedFiles: [], moreFiles: 0, unavailable: true });

    expect(container.querySelector('.cl-term-diff-note')?.textContent).toBe(
      'no diff was recorded for this run'
    );
    expect(container.querySelector('.cl-term-diff-body')).toBeNull();
  });

  it('counts the files it left out', () => {
    const { container } = mount({
      files: [{ filePath: '/p/a.ts', hunks: [hunk(['+one'])] }],
      changedFiles: ['/p/a.ts', '/p/b.ts', '/p/c.ts'],
      moreFiles: 2,
    });

    expect(container.querySelector('.cl-term-diff-title')?.textContent).toBe('3 files changed');
    expect(container.querySelector('.cl-term-diff-more')?.textContent).toBe('2 not shown');
  });

  it('folds a long diff and unfolds it on ask', () => {
    // A single `sed` can rewrite hundreds of lines; the corpus tail is 298 in
    // one hunk. Unfolded by default it pushes the conversation off screen.
    const lines = Array.from({ length: 40 }, (_, i) => `+line ${i}`);
    const { container } = mount({
      files: [{ filePath: '/p/a.ts', hunks: [hunk(lines)] }],
      changedFiles: ['/p/a.ts'],
      moreFiles: 0,
    });

    expect(container.querySelectorAll('.cl-term-diff-row')).toHaveLength(24);
    const toggle = container.querySelector<HTMLButtonElement>('.cl-term-diff .cl-term-link');
    expect(toggle?.textContent).toBe('Show all 42 diff lines');

    act(() => toggle?.click());
    expect(container.querySelectorAll('.cl-term-diff-row')).toHaveLength(42);
  });

  it('leaves a command that edited nothing exactly as it was', () => {
    const { container } = mount();
    expect(container.querySelector('.cl-term-diff')).toBeNull();
    expect(container.querySelector('.cl-term')).not.toBeNull();
  });
});
