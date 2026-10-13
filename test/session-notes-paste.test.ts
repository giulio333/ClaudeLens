// @vitest-environment jsdom
import { htmlToNoteBlocks } from '../src/components/project/terminal/session-notes-paste';

const shape = (html: string) =>
  htmlToNoteBlocks(html)?.map(({ type, text, done }) => ({ type, text, done })) ?? null;

describe('pasting rendered HTML', () => {
  it('keeps the list a Lens selection carries, around the prose', () => {
    const html =
      '<p>The install has five steps:</p><ol><li>Prerequisites and firewall.</li>' +
      '<li>Extract the <code>deploy</code> package.</li></ol><p>Then verify.</p>';
    expect(shape(html)).toEqual([
      { type: 'text', text: 'The install has five steps:', done: false },
      { type: 'bullet', text: 'Prerequisites and firewall.', done: false },
      { type: 'bullet', text: 'Extract the deploy package.', done: false },
      { type: 'text', text: 'Then verify.', done: false },
    ]);
  });

  it('turns a task-list item into a to-do and flattens nested lists', () => {
    const html =
      '<ul><li><input type="checkbox" checked disabled> done</li>' +
      '<li><input type="checkbox" disabled> open<ul><li>detail</li></ul></li></ul>';
    expect(shape(html)).toEqual([
      { type: 'check', text: 'done', done: true },
      { type: 'check', text: 'open', done: false },
      { type: 'bullet', text: 'detail', done: false },
    ]);
  });

  it('leaves HTML without a list to the plain text', () => {
    expect(htmlToNoteBlocks('<p>one</p><p>two</p>')).toBeNull();
    expect(htmlToNoteBlocks('')).toBeNull();
  });
});
