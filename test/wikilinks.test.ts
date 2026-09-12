// The grammar of `[[…]]` as the renderer reads it, kept apart from the chips so
// the edge cases can be stated directly.

import { describe, expect, it } from 'vitest';
import { parseWikiLink, parseWikiLinks, wikiLinkTargets } from '../src/lib/wikilinks';

describe('parseWikiLink', () => {
  it('separates what to resolve from what to show', () => {
    expect(parseWikiLink('Nota')).toEqual({ target: 'Nota', label: 'Nota' });
    expect(parseWikiLink('Nota|come la chiamo')).toEqual({
      target: 'Nota',
      label: 'come la chiamo',
    });
    // A heading is part of neither: it names a section of the same file, and the
    // chip cannot scroll to it.
    expect(parseWikiLink('Nota#Sezione')).toEqual({ target: 'Nota', label: 'Nota' });
  });
});

describe('parseWikiLinks', () => {
  it('reads every occurrence, in order', () => {
    const refs = parseWikiLinks('Vedi [[Uno]] e poi [[Due|due]].');
    expect(refs.map(r => r.target)).toEqual(['Uno', 'Due']);
    expect(refs.map(r => r.label)).toEqual(['Uno', 'due']);
  });

  it('does not let an unclosed bracket swallow the paragraph', () => {
    expect(parseWikiLinks('Un [[aperto\ne una riga dopo [[Nota]]').map(r => r.target)).toEqual([
      'Nota',
    ]);
  });

  it('ignores an empty target', () => {
    expect(parseWikiLinks('[[]] e [[ ]] e [[|alias]]')).toEqual([]);
  });
});

describe('wikiLinkTargets', () => {
  it('reports each distinct name once', () => {
    expect(wikiLinkTargets('[[Nota]], ancora [[Nota]], e [[Altra]]')).toEqual(['Nota', 'Altra']);
  });

  it('skips fenced blocks, which are never drawn as chips', () => {
    expect(wikiLinkTargets('Vedi [[Vera]].\n\n```md\nVedi [[Citata]].\n```\n')).toEqual(['Vera']);
    expect(wikiLinkTargets('~~~\n[[Citata]]\n~~~\n[[Vera]]')).toEqual(['Vera']);
  });

  it('treats an unclosed fence the way the markdown parser will — it runs to the end', () => {
    expect(wikiLinkTargets('[[Vera]]\n\n```\n[[Citata]]\n')).toEqual(['Vera']);
  });

  it('keeps inline code: a backticked citation is still a citation', () => {
    expect(wikiLinkTargets('sbloccato (`[[Domanda di Laurea Delphi]]`)')).toEqual([
      'Domanda di Laurea Delphi',
    ]);
  });
});
