// The presentation model of the file tools: what the editor window draws for a
// Read (rows with the line numbers Claude Code printed), a Write (the content
// from line 1) and an Edit (a diff of old_string → new_string). Pure, so the
// rules can be stated directly.

import { describe, it, expect } from 'vitest';
import {
  changeRows,
  changeStat,
  contentRows,
  diffStat,
  hunkRows,
  markPairs,
  spanDiff,
  fileName,
  highlightRows,
  isMarkdownPath,
  lineDiff,
  lineRange,
  numberedRows,
  shortDir,
  splitLines,
  writeOutcome,
} from '../src/components/project/chat/file-view';
import { highlightLines } from '../src/components/project/chat/code-lang';

describe('splitLines', () => {
  it('does not open an empty line after a trailing newline', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual([]);
  });

  it('keeps an empty line in the middle', () => {
    expect(splitLines('a\n\nb')).toEqual(['a', '', 'b']);
  });
});

describe('lineDiff', () => {
  it('shows a replaced block as removals followed by additions', () => {
    const rows = lineDiff('const a = 1;\nreturn a;', 'const a = 1;\nreturn b;');
    expect(rows).toEqual([
      { kind: 'ctx', text: 'const a = 1;' },
      { kind: 'del', text: 'return a;' },
      { kind: 'add', text: 'return b;' },
    ]);
  });

  it('keeps unchanged lines as context around an insertion', () => {
    const rows = lineDiff('a\nc', 'a\nb\nc');
    expect(rows.map(r => `${r.kind}:${r.text}`)).toEqual(['ctx:a', 'add:b', 'ctx:c']);
  });

  it('is all additions when the old text is empty, all removals when the new is', () => {
    expect(lineDiff('', 'x\ny').map(r => r.kind)).toEqual(['add', 'add']);
    expect(lineDiff('x\ny', '').map(r => r.kind)).toEqual(['del', 'del']);
  });

  it('is all context when nothing changed', () => {
    expect(lineDiff('same\nlines', 'same\nlines').map(r => r.kind)).toEqual(['ctx', 'ctx']);
  });

  it('carries no line numbers — old_string says what changed, not where', () => {
    expect(lineDiff('a', 'b').every(r => r.line === undefined)).toBe(true);
  });
});

describe('numberedRows', () => {
  it('reads the line numbers Claude Code printed, from wherever the read started', () => {
    const rows = numberedRows('   436→const x = 1;\n   437→\n   438→export {};\n');
    expect(rows).toEqual([
      { kind: 'ctx', text: 'const x = 1;', line: 436 },
      { kind: 'ctx', text: '', line: 437 },
      { kind: 'ctx', text: 'export {};', line: 438 },
    ]);
    expect(lineRange(rows!)).toBe('436–438');
  });

  it('keeps an unnumbered line among numbered ones as a row without a number', () => {
    const rows = numberedRows('     1→a\n(truncated)');
    expect(rows).toEqual([
      { kind: 'ctx', text: 'a', line: 1 },
      { kind: 'ctx', text: '(truncated)' },
    ]);
  });

  it('is null when nothing is numbered — an image, a marker, an error', () => {
    expect(numberedRows('(no content)')).toBeNull();
    expect(numberedRows('File does not exist.')).toBeNull();
    expect(numberedRows('')).toBeNull();
  });

  it('does not mistake a `→` inside the text for a line prefix', () => {
    const rows = numberedRows('     1→a → b');
    expect(rows).toEqual([{ kind: 'ctx', text: 'a → b', line: 1 }]);
  });
});

describe('lineRange', () => {
  it('is a single number for one line and null without numbers', () => {
    expect(lineRange([{ kind: 'ctx', text: 'x', line: 7 }])).toBe('7');
    expect(lineRange([{ kind: 'add', text: 'x' }])).toBeNull();
  });
});

describe('contentRows / diffStat', () => {
  it('numbers a written file from 1, its rows plain and not a diff', () => {
    expect(contentRows('a\nb\n')).toEqual([
      { kind: 'ctx', text: 'a', line: 1 },
      { kind: 'ctx', text: 'b', line: 2 },
    ]);
  });

  it('counts added and removed rows', () => {
    expect(diffStat(lineDiff('a\nb', 'a\nc\nd'))).toEqual({ added: 2, removed: 1 });
  });
});

describe('shortDir / fileName', () => {
  it('keeps the last three segments of a long path', () => {
    expect(shortDir('/Users/me/Projects/app/src/components/chat/x.ts')).toBe(
      '…/src/components/chat'
    );
  });

  it('prints a short path whole', () => {
    expect(shortDir('/etc/hosts')).toBe('/etc');
    expect(shortDir('x.ts')).toBe('/');
  });

  it('drops segments from the head, not the tail, when three are too long', () => {
    // A scratchpad under the archive: the last three segments are the project
    // hash, the session id and `scratchpad` — 90-odd characters, of which only
    // the last one says anything.
    const scratch =
      '/Users/me/.claude/projects/-Users-me-Projects-Acme2.0/' +
      '11111111-2222-3333-4444-555555555555/scratchpad/build.py';
    expect(shortDir(scratch)).toBe('…/scratchpad');
  });

  it('drops a segment only when what is left would not fit', () => {
    // `keep` says three segments, `max` says 40 characters — and `max` is the
    // one that decides here: the last two join to exactly 40, so both survive;
    // one character more and the head of the pair goes.
    const fits = `/a/bbbb/${'x'.repeat(20)}/${'y'.repeat(19)}/f.ts`;
    expect(shortDir(fits)).toBe(`…/${'x'.repeat(20)}/${'y'.repeat(19)}`);
    const over = `/a/bbbb/${'x'.repeat(21)}/${'y'.repeat(19)}/f.ts`;
    expect(shortDir(over)).toBe(`…/${'y'.repeat(19)}`);
  });

  it('keeps the last segment however long it is', () => {
    expect(shortDir(`/a/${'x'.repeat(60)}/f.ts`)).toBe(`…/${'x'.repeat(60)}`);
  });

  it('knows markdown by its extension', () => {
    expect(isMarkdownPath('/p/plan.md')).toBe(true);
    expect(isMarkdownPath('/p/README.MD')).toBe(true);
    expect(isMarkdownPath('/p/notes.mdx')).toBe(true);
    expect(isMarkdownPath('/p/mdfile.ts')).toBe(false);
    expect(isMarkdownPath('/p/md')).toBe(false);
  });

  it('names the file', () => {
    expect(fileName('/a/b/c.md')).toBe('c.md');
    expect(fileName('C:\\a\\b.txt')).toBe('b.txt');
  });
});

describe('writeOutcome', () => {
  it('reads "created" off the result Claude Code writes for a new file', () => {
    expect(writeOutcome('File created successfully at: /p/new.ts')).toBe('created');
    expect(writeOutcome('The file /p/x.ts has been updated successfully.')).toBe('written');
    expect(writeOutcome(undefined)).toBe('written');
  });
});

describe('highlightLines', () => {
  it('cuts one fragment per line, each balanced, a string open across the cut kept open', () => {
    const lines = highlightLines('x = """a\nb\n"""\ny = 1', 'python');
    expect(lines).toHaveLength(4);
    for (const l of lines ?? []) {
      expect(l.split('<span').length).toBe(l.split('</span>').length);
    }
    expect(lines?.[1]).toBe('<span class="hljs-string">b</span>');
    expect(lines?.[3]).not.toContain('hljs-string');
  });

  it('keeps an empty line as an empty fragment and escapes the text', () => {
    expect(highlightLines('a\n\nb', 'python')).toEqual(['a', '', 'b']);
    expect(highlightLines('"<"', 'python')?.[0]).toContain('&lt;');
  });
});

describe('highlightRows', () => {
  // The screenshot that found this: a docstring highlighted row by row, whose
  // second row was tokenised as code — `dell'app` opened a string, `40` was a
  // number and `del` the keyword.
  const docstring =
    'old = """da un\n' +
    "segno suo. È l'unico punto dell'app dove vive una tinta fuori dai 40 del brand,\n" +
    '"""\n' +
    'assert s.count(old) == 1';

  it('keeps a docstring a string on every row it spans', () => {
    const html = highlightRows(contentRows(docstring), 'python');
    expect(html[1]).toContain('hljs-string');
    expect(html[1]).not.toContain('hljs-keyword');
    expect(html[1]).not.toContain('hljs-number');
    expect(html[3]).toContain('hljs-keyword');
  });

  it('highlights each side of an edit as its own text', () => {
    const rows = lineDiff('x = """a\nb del\n"""', 'x = """a\nc del\n"""');
    expect(rows.map(r => r.kind)).toEqual(['ctx', 'del', 'add', 'ctx']);
    const html = highlightRows(rows, 'python');
    for (const h of html) expect(h).toContain('hljs-string');
    for (const h of html) expect(h).not.toContain('hljs-keyword');
  });

  it('is null per row without a language', () => {
    expect(highlightRows(contentRows('a\nb'), null)).toEqual([null, null]);
    expect(highlightRows([], 'python')).toEqual([]);
  });
});

describe('hunkRows', () => {
  // The hunks Claude Code records on a result row (`structuredPatch`,
  // `bashEditDiff`) are the one source with line numbers: an Edit's input says
  // what changed, never where.
  const hunk = (lines: string[], oldStart: number, newStart: number) => ({
    oldStart,
    oldLines: lines.filter(l => !l.startsWith('+')).length,
    newStart,
    newLines: lines.filter(l => !l.startsWith('-')).length,
    lines,
  });

  it('numbers context and added rows after the change, removed rows before', () => {
    expect(hunkRows([hunk([' a', '-b', '-c', '+d', ' e'], 10, 10)])).toEqual([
      { kind: 'ctx', text: 'a', line: 10 },
      { kind: 'del', text: 'b', line: 11 },
      { kind: 'del', text: 'c', line: 12 },
      { kind: 'add', text: 'd', line: 11 },
      { kind: 'ctx', text: 'e', line: 12 },
    ]);
  });

  it('marks the break between two hunks on the first row of the second', () => {
    const rows = hunkRows([hunk([' a', '+b'], 1, 1), hunk([' x', '-y'], 40, 41)]);
    expect(rows.map(r => r.gap ?? false)).toEqual([false, false, true, false]);
    // 41 − (1 + 2) = 38 lines the diff does not show.
    expect(rows[2]).toMatchObject({ text: 'x', line: 41, skipped: 38 });
    expect(rows[3]).toMatchObject({ text: 'y', line: 41 });
  });
});

describe('changeRows / changeStat', () => {
  const tool = (name: string, input: Record<string, unknown>, patch?: unknown) =>
    ({
      kind: 'tool',
      group: {
        use: { type: 'tool_use', id: 't', name, input },
        result: { type: 'tool_result', toolUseId: 't', content: '', isError: false, patch },
      },
    }) as never;

  it('prefers the recorded hunks of an Edit to the diff of its strings', () => {
    const patch = [{ oldStart: 5, oldLines: 1, newStart: 5, newLines: 1, lines: ['-x', '+y'] }];
    expect(changeRows(tool('Edit', { old_string: 'x', new_string: 'y' }, patch))).toEqual([
      { kind: 'del', text: 'x', line: 5 },
      { kind: 'add', text: 'y', line: 5 },
    ]);
    expect(changeRows(tool('Edit', { old_string: 'x', new_string: 'y' }))).toEqual([
      { kind: 'del', text: 'x' },
      { kind: 'add', text: 'y' },
    ]);
  });

  it('draws a Write as its content added, and a MultiEdit as each edit in turn', () => {
    expect(changeRows(tool('Write', { content: 'a\nb' }))).toEqual([
      { kind: 'add', text: 'a', line: 1 },
      { kind: 'add', text: 'b', line: 2 },
    ]);
    const multi = tool('MultiEdit', {
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c', new_string: 'd' },
      ],
    });
    expect(changeRows(multi)?.map(r => `${r.kind}:${r.text}`)).toEqual([
      'del:a',
      'add:b',
      'del:c',
      'add:d',
    ]);
    expect(changeStat([multi])).toEqual({ added: 2, removed: 2 });
  });

  it('has nothing to draw for a read or a capped Bash change', () => {
    expect(changeRows(tool('Read', { file_path: '/a' }))).toBeNull();
    expect(changeRows({ kind: 'bash', group: {} as never, file: null })).toBeNull();
    expect(changeStat([{ kind: 'bash', group: {} as never, file: null }])).toEqual({
      added: 0,
      removed: 0,
    });
  });
});

describe('markPairs / spanDiff', () => {
  // A one-token change is read as one token: the removed row and the added
  // row that replaced it carry the span they do not share.
  it('marks the differing span of a removed row and its replacement', () => {
    const rows = markPairs([
      { kind: 'ctx', text: 'a' },
      { kind: 'del', text: '  const x = old(1);' },
      { kind: 'add', text: '  const x = fresh(1);' },
    ]);
    expect(rows[1].mark).toEqual([12, 15]);
    expect(rows[2].mark).toEqual([12, 17]);
    expect(rows[0].mark).toBeUndefined();
  });

  it('pairs a run of removed rows with a run of the same length, in order', () => {
    const rows = markPairs([
      { kind: 'del', text: 'a = 1' },
      { kind: 'del', text: 'b = 2' },
      { kind: 'add', text: 'a = 10' },
      { kind: 'add', text: 'b = 20' },
    ]);
    expect(rows.map(r => r.mark)).toEqual([
      [5, 5],
      [5, 5],
      [5, 6],
      [5, 6],
    ]);
  });

  it('leaves a rewrite alone: unequal runs, or rows that share nothing but indent', () => {
    const rewrite = markPairs([
      { kind: 'del', text: 'one' },
      { kind: 'add', text: 'two' },
      { kind: 'add', text: 'three' },
    ]);
    expect(rewrite.every(r => r.mark === undefined)).toBe(true);
    expect(spanDiff('  foo()', '  bar()')).toEqual([
      [2, 5],
      [2, 5],
    ]);
    expect(spanDiff('  foo', '  bar')).toBeNull();
    expect(spanDiff('same', 'same')).toBeNull();
  });
});
