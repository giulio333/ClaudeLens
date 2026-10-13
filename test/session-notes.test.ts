import {
  backspaceAtStart,
  enterAt,
  lineShortcut,
  newBlock,
  notesBadge,
  notesTally,
  parseNotes,
  pasteAt,
  serializeNotes,
} from '../src/components/project/terminal/session-notes';

const shape = (md: string) => parseNotes(md).map(({ type, text, done }) => ({ type, text, done }));

describe('notes format', () => {
  it('reads to-dos and list items and keeps every other line as text', () => {
    expect(shape('Plan\n- [ ] one\n* [X] two\n  - [x] three\n- item\n[ ] not a list\n')).toEqual([
      { type: 'text', text: 'Plan', done: false },
      { type: 'check', text: 'one', done: false },
      { type: 'check', text: 'two', done: true },
      { type: 'check', text: 'three', done: true },
      { type: 'bullet', text: 'item', done: false },
      { type: 'text', text: '[ ] not a list', done: false },
    ]);
  });

  it('round-trips through Markdown', () => {
    const md = 'Plan\n\n- [ ] one\n- [x] two\n- item\nafter\n';
    expect(serializeNotes(parseNotes(md))).toBe(md);
  });

  it('serializes blank notes to nothing and keeps a to-do on one line', () => {
    expect(serializeNotes([newBlock(), newBlock('check')])).toBe('');
    expect(serializeNotes([newBlock('check', 'a\nb')])).toBe('- [ ] a b\n');
  });

  it('turns a typed [] or - at a line start into a to-do or a list item', () => {
    expect(lineShortcut('[] buy milk')).toEqual({ type: 'check', done: false, rest: 'buy milk' });
    expect(lineShortcut('- [x] done')).toEqual({ type: 'check', done: true, rest: 'done' });
    expect(lineShortcut('- item')).toEqual({ type: 'bullet', done: false, rest: 'item' });
    expect(lineShortcut('[]no space')).toBeNull();
    expect(lineShortcut('-no space')).toBeNull();
    expect(lineShortcut('text [] later')).toBeNull();
  });
});

describe('badge', () => {
  it('counts only to-dos with text', () => {
    expect(notesTally('- [ ] a\n- [x] b\n- [ ] \nnote\n')).toEqual({
      total: 2,
      done: 1,
      hasText: true,
    });
    expect(notesTally(undefined)).toEqual({ total: 0, done: 0, hasText: false });
  });

  it('shows progress, a check when all are done, a dot for text, nothing when empty', () => {
    expect(notesBadge(notesTally('- [x] a\n- [ ] b\n'))).toMatchObject({
      kind: 'progress',
      label: '1/2',
    });
    expect(notesBadge(notesTally('- [x] a\n'))).toMatchObject({ kind: 'done' });
    expect(notesBadge(notesTally('just text\n'))).toMatchObject({ kind: 'text' });
    expect(notesBadge(notesTally(''))).toBeNull();
  });
});

describe('editing', () => {
  it('splits a line at the caret into one of the same kind', () => {
    const blocks = [newBlock('check', 'firstsecond')];
    const edit = enterAt(blocks, 0, 5);
    expect(edit.blocks.map(b => [b.type, b.text])).toEqual([
      ['check', 'first'],
      ['check', 'second'],
    ]);
    expect(edit.focus).toEqual({ id: edit.blocks[1].id, pos: 0 });
  });

  it('continues a list on Enter and leaves it on an empty line', () => {
    expect(enterAt([newBlock('bullet', 'one')], 0, 3).blocks).toMatchObject([
      { type: 'bullet', text: 'one' },
      { type: 'bullet', text: '' },
    ]);
    for (const kind of ['check', 'bullet'] as const) {
      expect(enterAt([newBlock(kind, '')], 0, 0).blocks).toMatchObject([
        { type: 'text', text: '' },
      ]);
    }
  });

  it('turns a to-do back into text, then joins the line above', () => {
    const blocks = [newBlock('text', 'top'), newBlock('check', 'low')];
    const first = backspaceAtStart(blocks, 1)!;
    expect(first.blocks[1]).toMatchObject({ type: 'text', text: 'low' });
    const second = backspaceAtStart(first.blocks, 1)!;
    expect(second.blocks.map(b => b.text)).toEqual(['toplow']);
    expect(second.focus).toEqual({ id: blocks[0].id, pos: 3 });
    expect(backspaceAtStart([newBlock('text', 'x')], 0)).toBeNull();
  });

  it('pastes several lines as lines of their own', () => {
    const blocks = [newBlock('text', 'AB')];
    const edit = pasteAt(blocks, 0, 1, 1, 'one\n- [ ] two\nthree');
    expect(edit.blocks.map(b => [b.type, b.text])).toEqual([
      ['text', 'Aone'],
      ['check', 'two'],
      ['text', 'threeB'],
    ]);
    expect(edit.focus).toEqual({ id: edit.blocks[2].id, pos: 5 });
  });
});
