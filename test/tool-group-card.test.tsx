// @vitest-environment jsdom
//
// A tool call in the transcript is open by default, and the two tools that own
// a window — the shell (terminal) and the file tools (editor) — ARE their
// window: no header row above it, no click to see the run. The claims here are
// what a reader sees for each kind without touching anything, and that the
// strips MIN density keeps on screen still open on click.

import { describe, it, expect, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { MessageBubble } from '../src/components/project/chat/MessageBubble';
import { buildProcessedMessages } from '../src/components/project/chat/utils';
import type { ChatDetailsFilter } from '../src/components/project/chat/utils';
import type { ChatMessage } from '../src/types';

afterEach(cleanup);

/** The assistant turn that made one tool call, plus the user row carrying its
 *  result — the shape `buildProcessedMessages` folds into one tool group. */
function transcript(
  name: string,
  input: Record<string, unknown>,
  result?: { content: string; isError?: boolean }
): ChatMessage[] {
  return [
    {
      uuid: 'a1',
      role: 'assistant',
      timestamp: '2026-09-12T15:53:19.660Z',
      content: [{ type: 'tool_use', id: 'toolu_1', name, input }],
    },
    ...(result
      ? [
          {
            uuid: 'u1',
            role: 'user' as const,
            timestamp: '2026-09-12T15:53:20.100Z',
            content: [
              {
                type: 'tool_result' as const,
                toolUseId: 'toolu_1',
                content: result.content,
                isError: result.isError ?? false,
              },
            ],
          },
        ]
      : []),
  ];
}

/** Mounted the way the app mounts (`src/main.tsx`): inside `StrictMode`. */
function mount(messages: ChatMessage[], detailsFilter: ChatDetailsFilter = 'all') {
  const [processed] = buildProcessedMessages(messages);
  return render(
    <StrictMode>
      <MessageBubble
        processed={processed}
        detailsFilter={detailsFilter}
        onOpenToolDetail={() => {}}
      />
    </StrictMode>
  );
}

const rowsOf = (container: HTMLElement, kind: string) =>
  [...container.querySelectorAll(`.cl-file-row.is-${kind} .cl-file-code`)].map(
    el => el.textContent
  );
const gutter = (container: HTMLElement) =>
  [...container.querySelectorAll('.cl-file-ln')].map(el => el.textContent);

describe('a shell run', () => {
  it('is its terminal window, with no card header and nothing to click open', () => {
    const { container } = mount(
      transcript(
        'Bash',
        { command: 'npm test', description: 'Run the suite' },
        { content: '12 passed' }
      )
    );
    expect(container.querySelector('.cl-tool-card')).toBeNull();
    expect(container.querySelector('.cl-tool-card-main')).toBeNull();
    const term = container.querySelector('.cl-tool-window .cl-term');
    expect(term).not.toBeNull();
    // The description is the window title — there is no header left to say it.
    expect(term?.querySelector('.cl-term-title b')?.textContent).toBe('Run the suite');
    expect(term?.textContent).toContain('12 passed');
  });
});

describe('an Edit', () => {
  it('is an editor window drawing the change as a diff, and the result as the status', () => {
    const { container } = mount(
      transcript(
        'Edit',
        {
          file_path: '/p/src/app.ts',
          old_string: 'const a = 1;\nreturn a;',
          new_string: 'const a = 1;\nreturn b;',
        },
        { content: 'The file /p/src/app.ts has been updated successfully.' }
      )
    );
    expect(container.querySelector('.cl-tool-card')).toBeNull();
    const win = container.querySelector('.cl-term--file');
    expect(win).not.toBeNull();
    expect(win?.querySelector('.cl-term-kind')?.textContent).toBe('Edit');
    expect(win?.querySelector('.cl-term-title b')?.textContent).toBe('app.ts');
    expect(win?.querySelector('.cl-term-title .meta')?.textContent).toBe('/p/src');

    expect(rowsOf(container, 'ctx')).toEqual(['const a = 1;']);
    expect(rowsOf(container, 'del')).toEqual(['return a;']);
    expect(rowsOf(container, 'add')).toEqual(['return b;']);
    expect(gutter(container)).toEqual(['', '−', '+']);

    // "has been updated successfully" is the strip, not a RESULT block.
    expect(win?.querySelector('.cl-term-state')?.textContent).toBe('updated · −1 +1');
    expect(win?.textContent).not.toContain('has been updated successfully');
  });

  it('prints the error under the attempted change instead of hiding it', () => {
    const { container } = mount(
      transcript(
        'Edit',
        { file_path: '/p/x.ts', old_string: 'gone', new_string: 'there' },
        { content: 'String to replace not found in file.', isError: true }
      )
    );
    const win = container.querySelector('.cl-term--file');
    expect(win?.classList.contains('is-error')).toBe(true);
    expect(win?.querySelector('.cl-term-state')?.textContent).toBe('error');
    expect(win?.querySelector('.cl-term-out')?.textContent).toBe(
      'String to replace not found in file.'
    );
    expect(rowsOf(container, 'del')).toEqual(['gone']);
  });

  it('says so when it replaced every occurrence', () => {
    const { container } = mount(
      transcript(
        'Edit',
        { file_path: '/p/x.ts', old_string: 'a', new_string: 'b', replace_all: true },
        { content: 'ok' }
      )
    );
    expect(container.querySelector('.cl-term-title .meta')?.textContent).toBe('/p · replace all');
  });
});

describe('a Read', () => {
  it('draws the rows with the line numbers Claude Code printed', () => {
    const { container } = mount(
      transcript(
        'Read',
        { file_path: '/p/src/graph.ts', offset: 436, limit: 3 },
        { content: '   436→const x = 1;\n   437→\n   438→export {};\n' }
      )
    );
    expect(gutter(container)).toEqual(['436', '437', '438']);
    expect(rowsOf(container, 'ctx')).toEqual(['const x = 1;', ' ', 'export {};']);
    expect(container.querySelector('.cl-term-title .meta')?.textContent).toBe(
      '/p/src · lines 436–438'
    );
    expect(container.querySelector('.cl-term-state')?.textContent).toBe('3 lines');
    expect(container.querySelector('.cl-term-kind')?.textContent).toBe('Read');
  });

  it('prints an unnumbered result as it is rather than as an empty file', () => {
    const { container } = mount(
      transcript('Read', { file_path: '/p/img.png' }, { content: '(no content)' })
    );
    expect(container.querySelectorAll('.cl-file-row')).toHaveLength(0);
    expect(container.querySelector('.cl-term-out')?.textContent).toBe('(no content)');
    expect(container.querySelector('.cl-term-note')).toBeNull();
  });

  it('folds a long file — shorter than an edit, it is what the turn looked at, not what it did', () => {
    const content = Array.from({ length: 40 }, (_, i) => `${i + 1}→line ${i + 1}`).join('\n');
    const { container } = mount(transcript('Read', { file_path: '/p/a.txt' }, { content }));
    expect(container.querySelectorAll('.cl-file-row')).toHaveLength(12);
    const toggle = container.querySelector<HTMLButtonElement>('.cl-term-foot .cl-term-link');
    expect(toggle?.textContent).toBe('Show all 40 lines');
    act(() => toggle?.click());
    expect(container.querySelectorAll('.cl-file-row')).toHaveLength(40);
  });

  it('says it is still running when no result has landed', () => {
    const { container } = mount(transcript('Read', { file_path: '/p/a.txt' }));
    expect(container.querySelector('.cl-term-state')?.textContent).toBe('running');
    expect(container.querySelector('.cl-term-note')?.textContent).toBe(
      'still running — no result recorded yet'
    );
    expect(container.querySelector('.cl-term-state')?.classList.contains('is-pending')).toBe(true);
  });
});

describe('a Write', () => {
  it('folds at 24 lines, twice a read: new content is what the turn did', () => {
    const content = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n');
    const { container } = mount(
      transcript('Write', { file_path: '/p/a.txt', content }, { content: 'ok' })
    );
    expect(container.querySelectorAll('.cl-file-row')).toHaveLength(24);
    expect(container.querySelector('.cl-term-foot .cl-term-link')?.textContent).toBe(
      'Show all 40 lines'
    );
  });

  it('numbers the new content from 1 and reads "created" off the result', () => {
    const { container } = mount(
      transcript(
        'Write',
        { file_path: '/p/new.ts', content: 'export const x = 1;\nexport const y = 2;\n' },
        { content: 'File created successfully at: /p/new.ts' }
      )
    );
    expect(gutter(container)).toEqual(['1', '2']);
    expect(rowsOf(container, 'ctx')).toEqual(['export const x = 1;', 'export const y = 2;']);
    expect(container.querySelector('.cl-term-state')?.textContent).toBe('created · 2 lines');
  });

  it('is the file and not a diff of it, so no row wears the added-line wash', () => {
    const { container } = mount(
      transcript(
        'Write',
        { file_path: '/p/new.ts', content: 'export const x = 1;\n' },
        { content: 'File created successfully at: /p/new.ts' }
      )
    );
    expect(container.querySelectorAll('.cl-file-row.is-add')).toHaveLength(0);
  });

  it('names the file whole and carries the real path on the shortened one', () => {
    const path =
      '/Users/me/.claude/projects/-Users-me-Projects-Acme2.0/' +
      '11111111-2222-3333-4444-555555555555/scratchpad/build_plan.py';
    const { container } = mount(
      transcript('Write', { file_path: path, content: 'x = 1\n' }, { content: 'ok' })
    );
    const bar = container.querySelector('.cl-term-title');
    // The name never gives way to the path — the whole point of shortening it.
    expect(bar?.querySelector('b')?.textContent).toBe('build_plan.py');
    // Of a path whose three last segments are 90 characters of opaque id, the
    // bar keeps the one segment that says something; the whole path is on the
    // button, which copies it.
    const where = bar?.querySelector('button.meta');
    expect(where?.textContent).toBe('…/scratchpad');
    expect(where?.getAttribute('title')).toContain(path);
  });

  it('colours the file by its extension, a docstring kept a string across its rows', () => {
    const { container } = mount(
      transcript(
        'Write',
        {
          file_path: '/p/edit.py',
          content: 'old = """da un\nsegno suo. È l\'unico punto dell\'app, dai 40 del brand\n"""\n',
        },
        { content: 'File created successfully at: /p/edit.py' }
      )
    );
    const rows = container.querySelectorAll('.cl-file-code');
    expect(rows).toHaveLength(3);
    expect(rows[1].querySelector('.hljs-string')).not.toBeNull();
    expect(rows[1].querySelector('.hljs-keyword')).toBeNull();
    expect(rows[1].querySelector('.hljs-number')).toBeNull();
  });

  it('marks a memory file', () => {
    const { container } = mount(
      transcript(
        'Write',
        { file_path: '/Users/me/.claude/projects/-p/memory/note.md', content: 'x' },
        { content: 'File created successfully at: …' }
      )
    );
    expect([...container.querySelectorAll('.cl-term-kind')].map(el => el.textContent)).toEqual([
      'Write',
      'memory',
    ]);
  });
});

describe('a markdown file', () => {
  const plan = '# Test plan\n\nCopre le modifiche **SK-34**.\n';

  it('opens as the document it is when a turn wrote it, not as its source', () => {
    const { container } = mount(
      transcript(
        'Write',
        { file_path: '/p/docs/plan.md', content: plan },
        { content: 'File created successfully at: /p/docs/plan.md' }
      )
    );
    const body = container.querySelector('.cl-file-body');
    expect(body?.classList.contains('is-preview')).toBe(true);
    // Rendered: the heading is a heading and the bold is bold — not two rows of
    // `#` and `**`.
    expect(body?.querySelector('h1')?.textContent).toBe('Test plan');
    expect(body?.querySelector('strong')?.textContent).toBe('SK-34');
    expect(container.querySelectorAll('.cl-file-row')).toHaveLength(0);
    // The window is still the window: same verb, same status strip.
    expect(container.querySelector('.cl-term-kind')?.textContent).toBe('Write');
    expect(container.querySelector('.cl-term-state')?.textContent).toBe('created · 3 lines');
  });

  it('hands the source back on ask, and takes it again', () => {
    const { container } = mount(
      transcript('Write', { file_path: '/p/docs/plan.md', content: plan }, { content: 'ok' })
    );
    const mode = () => container.querySelector<HTMLButtonElement>('.cl-term-mode');
    expect(mode?.()?.textContent).toBe('Source');
    act(() => mode()?.click());
    expect(container.querySelector('.cl-file-body')?.classList.contains('is-preview')).toBe(false);
    expect(rowsOf(container, 'ctx')[0]).toBe('# Test plan');
    expect(mode()?.textContent).toBe('Preview');
    act(() => mode()?.click());
    expect(container.querySelector('.cl-file-body h1')?.textContent).toBe('Test plan');
  });

  it('is read as a slice, so a Read opens on its numbered rows', () => {
    const { container } = mount(
      transcript('Read', { file_path: '/p/docs/plan.md' }, { content: '   12→# Test plan' })
    );
    expect(container.querySelector('.cl-file-body')?.classList.contains('is-preview')).toBe(false);
    expect(gutter(container)).toEqual(['12']);
    // …with the document one click away.
    expect(container.querySelector('.cl-term-mode')?.textContent).toBe('Preview');
  });

  it('is offered for no other extension: a .py has one reading', () => {
    const { container } = mount(
      transcript('Write', { file_path: '/p/a.py', content: 'x = 1\n' }, { content: 'ok' })
    );
    expect(container.querySelector('.cl-term-mode')).toBeNull();
  });
});

describe('every other tool', () => {
  it('keeps its header but shows input and result without a click', () => {
    const { container } = mount(
      transcript(
        'Grep',
        { pattern: 'TODO', path: '/p/src' },
        { content: 'src/a.ts:12:// TODO\nsrc/b.ts:3:// TODO' }
      )
    );
    const card = container.querySelector('.cl-tool-card');
    expect(card).not.toBeNull();
    expect(card?.classList.contains('cl-tool-card--chip')).toBe(false);
    expect(card?.querySelector('.cl-tool-card-name')?.textContent).toBe('Grep');
    // No toggle: the header is a plain row, not a button, and the body is
    // already there.
    expect(card?.querySelector('button.cl-tool-card-main')).toBeNull();
    expect(card?.querySelector('.cl-tool-card-main.is-static')).not.toBeNull();
    expect(card?.querySelector('.cl-tool-card-expanded')).not.toBeNull();
    expect(card?.textContent).toContain('src/b.ts:3:// TODO');
  });

  it('shows a failed result in the open body, not as a collapsed strip', () => {
    const { container } = mount(
      transcript('Glob', { pattern: '**/*.zz' }, { content: 'boom', isError: true })
    );
    expect(container.querySelector('.cl-tool-card-result.is-error')).toBeNull();
    expect(container.querySelector('.cl-tool-card-section.is-error')?.textContent).toContain(
      'boom'
    );
  });
});

describe('the agent strip MIN density keeps on screen', () => {
  it('is still a chip that opens on click', () => {
    const { container } = mount(
      transcript(
        'Agent',
        { subagent_type: 'Explore', description: 'Find the reader', prompt: 'where is it' },
        { content: 'in electron/modules' }
      ),
      'minimal'
    );
    const card = container.querySelector('.cl-tool-stack--chips .cl-tool-card--chip');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.cl-tool-card-expanded')).toBeNull();
    const main = card?.querySelector<HTMLButtonElement>('.cl-tool-card-main');
    expect(main?.getAttribute('aria-expanded')).toBe('false');
    act(() => main?.click());
    expect(card?.querySelector('.cl-tool-card-expanded')?.textContent).toContain(
      'in electron/modules'
    );
  });
});
