// A markdown file's frontmatter as the Files page reads it: the description as
// the lead, the rest as properties. `Markdown` leaves the block out of the
// page, so whatever this drops is not on screen at all.

import { describe, expect, it } from 'vitest';
import { readFrontmatter } from '../src/components/project/files/frontmatter';

const doc = (fm: string, body = '# Body\n') => `---\n${fm}\n---\n\n${body}`;

describe('a document frontmatter', () => {
  it('says the description as the lead and drops a name that repeats the file', () => {
    const fm = readFrontmatter(
      doc('name: some-topic\ndescription: what it is about'),
      'some-topic'
    );
    expect(fm).toEqual({ lead: 'what it is about', properties: [] });
  });

  it('keeps a name of its own as a property', () => {
    const fm = readFrontmatter(doc('name: Some Skill'), 'SKILL');
    expect(fm?.properties).toEqual([{ key: 'name', value: 'Some Skill', kind: 'text' }]);
  });

  it('flattens a nested map to its leaves, and dates read as dates', () => {
    const fm = readFrontmatter(
      doc(
        'metadata:\n  type: project\n  modified: 2026-10-19T12:36:37.812Z\n  created: 2026-10-01'
      ),
      'x'
    );
    expect(fm?.properties.map(p => [p.key, p.kind])).toEqual([
      ['type', 'text'],
      ['modified', 'date'],
      ['created', 'date'],
    ]);
    expect(fm?.properties[2].value).toBe('Oct 1, 2026');
  });

  it('names a leaf by its path when two leaves share a name', () => {
    const fm = readFrontmatter(doc('type: a\nmetadata:\n  type: b'), 'x');
    expect(fm?.properties.map(p => p.key)).toEqual(['type', 'metadata.type']);
  });

  it('reads a list as a list, and an empty value as a dash', () => {
    const fm = readFrontmatter(doc('tools: [Read, Bash]\nmodel:'), 'x');
    expect(fm?.properties).toEqual([
      { key: 'tools', value: ['Read', 'Bash'], kind: 'list' },
      { key: 'model', value: '—', kind: 'text' },
    ]);
  });

  it('shows a block that is not a YAML mapping as written', () => {
    expect(readFrontmatter(doc('key: [unclosed'), 'x')).toEqual({
      properties: [],
      raw: 'key: [unclosed',
    });
  });

  it('is null for a file without frontmatter', () => {
    expect(readFrontmatter('# Just a heading\n\n---\n', 'x')).toBeNull();
  });
});
