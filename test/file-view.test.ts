// The presentation model of the file tools: what the editor window draws for a
// Read (rows with the line numbers Claude Code printed), a Write (the content
// from line 1) and an Edit (a diff of old_string → new_string). Pure, so the
// rules can be stated directly.

import { describe, it, expect } from 'vitest';
import {
  contentRows,
  diffStat,
  fileName,
  lineDiff,
  lineRange,
  numberedRows,
  shortDir,
  splitLines,
  writeOutcome,
} from '../src/components/project/chat/file-view';

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
  it('numbers a written file from 1, every line new', () => {
    expect(contentRows('a\nb\n')).toEqual([
      { kind: 'add', text: 'a', line: 1 },
      { kind: 'add', text: 'b', line: 2 },
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
