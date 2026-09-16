// The presentation model of the file tools: what the editor window draws for a
// Read (rows with the line numbers Claude Code printed), a Write (the content
// from line 1) and an Edit (a diff of old_string → new_string). Pure, so the
// rules can be stated directly.

import { describe, it, expect } from 'vitest';
import {
  contentRows,
  diffStat,
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
