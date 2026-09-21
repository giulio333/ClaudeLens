// @vitest-environment jsdom
//
// The files a turn changed, at its foot in MIN density.
//
// MIN hides tool bodies, and the only trace of an edit used to be an icon chip
// with the file name on hover: no verb, no size, and no way to see the change
// without switching the whole conversation to FULL. These are the claims about
// the strip that replaces it — one row per changed file, opening into the same
// window FULL draws — and about the one source the old chips never read: a
// file rewritten from Bash, which Claude Code records on the result row (#265)
// and which is how Claude edits in auto mode.

import { describe, it, expect, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MessageBubble, ToolsHiddenBadge } from '../src/components/project/chat/MessageBubble';
import { DiffsOpenContext } from '../src/components/project/chat/diffs-open';
import {
  buildProcessedMessages,
  buildRenderItems,
  describeTurn,
  touchedFiles,
} from '../src/components/project/chat/utils';
import type { ChatMessage, ChatContentBlock } from '../src/types';

afterEach(cleanup);

type Use = Extract<ChatContentBlock, { type: 'tool_use' }>;
type Result = Extract<ChatContentBlock, { type: 'tool_result' }>;

const use = (id: string, name: string, input: Record<string, unknown>): Use => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const ok = (toolUseId: string, content = '', extra: Partial<Result> = {}): Result => ({
  type: 'tool_result',
  toolUseId,
  content,
  isError: false,
  ...extra,
});

/** An assistant turn with a line of text and its tool calls, plus the user row
 *  carrying their results — what `buildProcessedMessages` folds into one turn. */
function transcript(uses: Use[], results: Result[], text = 'Done.'): ChatMessage[] {
  return [
    {
      uuid: 'a1',
      role: 'assistant',
      timestamp: '2026-09-21T10:00:00.000Z',
      content: [{ type: 'text', text }, ...uses],
    },
    { uuid: 'u1', role: 'user', timestamp: '2026-09-21T10:00:01.000Z', content: results },
  ];
}

function mountTurn(uses: Use[], results: Result[]) {
  const [processed] = buildProcessedMessages(transcript(uses, results));
  return render(
    <StrictMode>
      <MessageBubble processed={processed} detailsFilter="minimal" onOpenToolDetail={() => {}} />
    </StrictMode>
  );
}

/** The header as words: verb, file, dir, then every stat, space-separated. */
const headText = (el: Element) =>
  [
    ...el.querySelectorAll(
      '.cl-file-change-verb, .cl-file-change-path b, .cl-file-change-dir, .cl-file-change-times, .cl-file-change-stat > span'
    ),
  ]
    .map(c => c.textContent?.trim() ?? '')
    .join(' ');
const diffRows = (el: ParentNode) =>
  [...el.querySelectorAll('.cl-diff-row')].map(r => {
    const ln = r.querySelector('.cl-diff-ln')?.textContent ?? '';
    const sign = r.querySelector('.cl-diff-sign')?.textContent ?? '';
    return `${ln}${sign}${r.querySelector('.cl-diff-code')?.textContent ?? ''}`;
  });

const editSed = (id = 't1') =>
  use(id, 'Bash', { command: "sed -i '' s/a/b/ src/app.ts", description: 'Rename' });
const sedResult = (id = 't1') =>
  ok(id, '', {
    bashEditDiff: {
      files: [
        {
          filePath: '/p/src/app.ts',
          hunks: [
            {
              oldStart: 1,
              oldLines: 2,
              newStart: 1,
              newLines: 2,
              lines: [' const a = 1;', '-return a;', '+return b;'],
            },
          ],
        },
      ],
      changedFiles: ['/p/src/app.ts'],
      moreFiles: 0,
    },
  });

const hunk = (lines: string[], oldStart = 20, newStart = 20) => ({
  oldStart,
  oldLines: lines.filter(l => !l.startsWith('+')).length,
  newStart,
  newLines: lines.filter(l => !l.startsWith('-')).length,
  lines,
});

describe('the files a turn changed, in MIN density', () => {
  it('draws an Edit as its diff, open by default, numbered where the result says', () => {
    const { container } = mountTurn(
      [use('t1', 'Edit', { file_path: '/p/src/a.ts', old_string: 'x\ny', new_string: 'z' })],
      [
        ok('t1', 'The file /p/src/a.ts has been updated successfully.', {
          patch: [hunk([' const a = 1;', '-x', '-y', '+z', ' done'], 22, 22)],
        }),
      ]
    );
    const change = container.querySelector('.cl-file-change')!;
    expect(change.className).toContain('is-edited');
    expect(headText(change)).toBe('Updated a.ts /p/src +1 −2');
    // Open by default, on the page: no window, no click.
    expect(diffRows(change)).toEqual(['22const a = 1;', '23-x', '24-y', '23+z', '24done']);
    expect(container.querySelector('.cl-term')).toBeNull();
  });

  it('falls back to the diff of the two strings when no line numbers were recorded', () => {
    // A live turn: the SDK stream carries the call and its result text, never
    // the `structuredPatch` of the row on disk.
    const { container } = mountTurn(
      [use('t1', 'Edit', { file_path: '/p/src/a.ts', old_string: 'x', new_string: 'z' })],
      [ok('t1', 'updated')]
    );
    expect(diffRows(container)).toEqual(['-x', '+z']);
  });

  it('folds on the header and unfolds again', () => {
    const { container } = mountTurn(
      [use('t1', 'Edit', { file_path: '/p/src/a.ts', old_string: 'x', new_string: 'z' })],
      [ok('t1', 'updated')]
    );
    const toggle = container.querySelector('.cl-file-change-toggle')!;
    act(() => {
      fireEvent.click(toggle);
    });
    expect(container.querySelector('.cl-diff')).toBeNull();
    act(() => {
      fireEvent.click(toggle);
    });
    expect(container.querySelector('.cl-diff')).not.toBeNull();
  });

  it('opens the whole diff full screen, and Escape closes it', () => {
    const { container } = mountTurn(
      [use('t1', 'Edit', { file_path: '/p/src/a.ts', old_string: 'x', new_string: 'z' })],
      [ok('t1', 'updated')]
    );
    act(() => {
      fireEvent.click(container.querySelector('.cl-file-change-full')!);
    });
    const modal = document.body.querySelector('.cl-term-modal')!;
    expect(modal).not.toBeNull();
    expect(diffRows(modal.querySelector('.cl-file-change--full')!)).toEqual(['-x', '+z']);
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(document.body.querySelector('.cl-term-modal')).toBeNull();
  });

  it('shows a file rewritten from Bash, which no Edit call ever named', () => {
    const { container } = mountTurn([editSed()], [sedResult()]);
    const change = container.querySelector('.cl-file-change')!;
    expect(headText(change)).toBe('Updated app.ts /p/src +1 −1');
    expect(diffRows(change)).toEqual(['1const a = 1;', '2-return a;', '2+return b;']);
  });

  it('says a Write that made a new file created it, and keeps a read as a chip', () => {
    const { container } = mountTurn(
      [
        use('t1', 'Read', { file_path: '/p/README.md' }),
        use('t2', 'Write', { file_path: '/p/src/new.ts', content: 'a\nb\nc' }),
      ],
      [ok('t1', '1\tHello'), ok('t2', 'File created successfully at: /p/src/new.ts')]
    );
    const changes = [...container.querySelectorAll('.cl-file-change')];
    expect(changes.map(headText)).toEqual(['Created new.ts /p/src +3']);
    expect(changes[0].className).toContain('is-created');
    expect(diffRows(changes[0])).toEqual(['1+a', '2+b', '3+c']);
    // The read is not a change: an icon chip, as before, and no diff.
    expect(
      [...container.querySelectorAll('.cl-file-chip')].map(el => el.getAttribute('data-file'))
    ).toEqual(['README.md']);
  });

  it('folds a file read and then edited into one change with every edit', () => {
    const { container } = mountTurn(
      [
        use('t1', 'Read', { file_path: '/p/src/a.ts' }),
        use('t2', 'Edit', { file_path: '/p/src/a.ts', old_string: 'x', new_string: 'y' }),
        use('t3', 'Edit', { file_path: '/p/src/a.ts', old_string: 'y', new_string: 'z' }),
      ],
      [ok('t1', '1\tx'), ok('t2', 'updated'), ok('t3', 'updated')]
    );
    const changes = [...container.querySelectorAll('.cl-file-change')];
    expect(changes).toHaveLength(1);
    expect(headText(changes[0])).toBe('Updated a.ts /p/src ×3 +2 −2');
    expect(container.querySelector('.cl-file-chip')).toBeNull();
    // The two edits, in order; the read draws nothing.
    expect(diffRows(changes[0])).toEqual(['-x', '+y', '-y', '+z']);
  });

  it('says so for a Bash change Claude Code capped rather than drawing nothing', () => {
    const { container } = mountTurn(
      [editSed()],
      [
        ok('t1', '', {
          bashEditDiff: { files: [], changedFiles: ['/p/src/app.ts'], moreFiles: 1 },
        }),
      ]
    );
    expect(container.querySelector('.cl-file-change-note')?.textContent).toBe(
      'no diff was recorded for this change'
    );
  });

  it('folds every diff when the switch is off, and a click on one reopens it alone', () => {
    const [processed] = buildProcessedMessages(
      transcript(
        [
          use('t1', 'Edit', { file_path: '/p/a.ts', old_string: 'x', new_string: 'z' }),
          use('t2', 'Edit', { file_path: '/p/b.ts', old_string: 'x', new_string: 'z' }),
        ],
        [ok('t1', 'updated'), ok('t2', 'updated')]
      )
    );
    const view = (open: boolean) => (
      <StrictMode>
        <DiffsOpenContext.Provider value={open}>
          <MessageBubble
            processed={processed}
            detailsFilter="minimal"
            onOpenToolDetail={() => {}}
          />
        </DiffsOpenContext.Provider>
      </StrictMode>
    );
    const { container, rerender } = render(view(true));
    expect(container.querySelectorAll('.cl-diff')).toHaveLength(2);
    rerender(view(false));
    expect(container.querySelectorAll('.cl-diff')).toHaveLength(0);
    act(() => {
      fireEvent.click(container.querySelector('.cl-file-change-toggle')!);
    });
    expect(container.querySelectorAll('.cl-diff')).toHaveLength(1);
    // The switch flipped again wins over the local choice.
    rerender(view(true));
    expect(container.querySelectorAll('.cl-diff')).toHaveLength(2);
    rerender(view(false));
    expect(container.querySelectorAll('.cl-diff')).toHaveLength(0);
  });

  it('draws the same strip under the badge of a run of tool-only turns', () => {
    const files = touchedFiles([{ use: editSed(), result: sedResult() }]);
    const { container } = render(
      <StrictMode>
        <ToolsHiddenBadge count={1} files={files} />
      </StrictMode>
    );
    expect(headText(container.querySelector('.cl-file-change')!)).toBe(
      'Updated app.ts /p/src +1 −1'
    );
  });
  it('carries a Bash edit from a tool-only turn onto the turn it is folded into', () => {
    // The common shape: the text of the answer on one row, the tool calls that
    // did the work on the rows after it. MIN collapses those into the answer's
    // turn, and the files they changed must travel with them.
    const msgs: ChatMessage[] = [
      {
        uuid: 'a1',
        role: 'assistant',
        timestamp: '2026-09-21T10:00:00.000Z',
        content: [{ type: 'text', text: 'On it.' }],
      },
      {
        uuid: 'a2',
        role: 'assistant',
        timestamp: '2026-09-21T10:00:01.000Z',
        content: [editSed('t9')],
      },
      {
        uuid: 'u2',
        role: 'user',
        timestamp: '2026-09-21T10:00:02.000Z',
        content: [sedResult('t9')],
      },
    ];
    const processed = buildProcessedMessages(msgs);
    const items = buildRenderItems(
      processed,
      processed.map(p => describeTurn(p, 'minimal'))
    );
    const turn = items.find(i => i.kind === 'turn');
    expect(turn && turn.kind === 'turn' ? turn.hiddenFiles?.map(f => f.path) : null).toEqual([
      '/p/src/app.ts',
    ]);
  });
});
