import { describe, it, expect } from 'vitest'
import {
  Highlight,
  wrapHighlightsWithSentinels,
  materializeHighlightSentinels,
  hasHighlightSentinels,
  exportHighlightCss,
  locateQuoteInRaw,
  fencedCodeRanges,
  isPersistableMessageUuid,
  textSegmentsExcluding,
  inlineRuns,
} from '../src/components/project/chat/highlights'

function hl(partial: Partial<Highlight> & Pick<Highlight, 'start' | 'end' | 'quote'>): Highlight {
  return {
    id: partial.id ?? 'id',
    messageUuid: partial.messageUuid ?? 'm',
    blockIndex: partial.blockIndex ?? 0,
    color: partial.color ?? 'amber',
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('wrapHighlightsWithSentinels + materializeHighlightSentinels', () => {
  it('wraps a simple quote and materializes to a <mark> with the color class', () => {
    const raw = 'The quick brown fox jumps'
    const wrapped = wrapHighlightsWithSentinels(raw, [hl({ start: 4, end: 9, quote: 'quick', color: 'green' })])
    expect(hasHighlightSentinels(wrapped)).toBe(true)
    const html = materializeHighlightSentinels(wrapped)
    expect(html).toBe('The <mark class="cl-hl cl-hl-green">quick</mark> brown fox jumps')
  })

  it('leaves text untouched when there are no highlights', () => {
    const raw = 'nothing to mark here'
    expect(wrapHighlightsWithSentinels(raw, [])).toBe(raw)
    expect(materializeHighlightSentinels(raw)).toBe(raw)
    expect(hasHighlightSentinels(raw)).toBe(false)
  })

  it('soft-degrades: a quote that genuinely changed is skipped, text intact', () => {
    const raw = 'plain prose without the rendered phrase'
    const wrapped = wrapHighlightsWithSentinels(raw, [
      hl({ start: 0, end: 8, quote: 'XYZ gone' /* not present at all */ }),
    ])
    expect(wrapped).toBe(raw)
    expect(hasHighlightSentinels(wrapped)).toBe(false)
  })

  it('locates a quote spanning inline code, keeping the backticks inside the mark', () => {
    // Rendered quote has no backticks; raw source does. The span must include
    // the whole `code` token so it re-renders as <code> inside the <mark>.
    const raw = 'run `npm test` now'
    const quote = 'run npm test now'
    const wrapped = wrapHighlightsWithSentinels(raw, [hl({ start: 0, end: quote.length, quote })])
    const html = materializeHighlightSentinels(wrapped)
    expect(html).toBe('<mark class="cl-hl cl-hl-amber">run `npm test` now</mark>')
  })

  it('locates a quote ending inside inline code, absorbing the closing backtick', () => {
    const raw = 'see `config.json`'
    const quote = 'see config.json'
    const wrapped = wrapHighlightsWithSentinels(raw, [hl({ start: 0, end: quote.length, quote })])
    const html = materializeHighlightSentinels(wrapped)
    // The trailing backtick is absorbed so it isn't orphaned outside the mark.
    expect(html).toBe('<mark class="cl-hl cl-hl-amber">see `config.json`</mark>')
  })

  it('locates a quote spanning bold markers', () => {
    const raw = 'this is **very** important'
    const quote = 'is very important'
    const located = locateQuoteInRaw(raw, quote, 0)
    expect(located).not.toBeNull()
    expect(raw.slice(located!.from, located!.to)).toBe('is **very** important')
  })

  it('locateQuoteInRaw returns null when the text is absent', () => {
    expect(locateQuoteInRaw('hello world', 'absent phrase', 0)).toBeNull()
  })

  it('locates a quote across an inline formula via the TeX export key ($ skipped)', () => {
    const raw = 'vedi $E=mc^2$ qui'
    // exportQuote: the formula replaced by its TeX source, no $ delimiters.
    const exportQuote = 'vedi E=mc^2 qui'
    const located = locateQuoteInRaw(raw, exportQuote, 0)
    expect(located).not.toBeNull()
    expect(raw.slice(located!.from, located!.to)).toBe(raw)
  })

  it('locates a quote spanning a paragraph break (rendered text drops the blank line)', () => {
    const raw = 'first para.\n\nsecond para.'
    // range.toString() concatenates the two paragraphs with no separator.
    const quote = 'first para.second para.'
    const located = locateQuoteInRaw(raw, quote, 0)
    expect(located).not.toBeNull()
    expect(raw.slice(located!.from, located!.to)).toBe(raw)
  })

  it('handles multiple non-overlapping highlights in document order', () => {
    const raw = 'alpha beta gamma'
    const wrapped = wrapHighlightsWithSentinels(raw, [
      hl({ start: 11, end: 16, quote: 'gamma', color: 'pink' }),
      hl({ start: 0, end: 5, quote: 'alpha', color: 'blue' }),
    ])
    const html = materializeHighlightSentinels(wrapped)
    expect(html).toBe(
      '<mark class="cl-hl cl-hl-blue">alpha</mark> beta <mark class="cl-hl cl-hl-pink">gamma</mark>',
    )
  })

  it('maps repeated quotes to successive occurrences via the advancing cursor', () => {
    const raw = 'go go go'
    const wrapped = wrapHighlightsWithSentinels(raw, [
      hl({ id: 'a', start: 0, end: 2, quote: 'go' }),
      hl({ id: 'b', start: 3, end: 5, quote: 'go' }),
    ])
    const html = materializeHighlightSentinels(wrapped)
    // Two distinct marks on the first two occurrences, third 'go' untouched.
    expect(html).toBe(
      '<mark class="cl-hl cl-hl-amber">go</mark> <mark class="cl-hl cl-hl-amber">go</mark> go',
    )
  })

  it('clamps overlapping highlights into adjacent marks without dropping either', () => {
    // h1 covers "alpha beta", h2 covers "beta gamma" — they overlap on "beta".
    const raw = 'alpha beta gamma'
    const wrapped = wrapHighlightsWithSentinels(raw, [
      hl({ id: 'a', start: 0, end: 10, quote: 'alpha beta', color: 'amber' }),
      hl({ id: 'b', start: 6, end: 16, quote: 'beta gamma', color: 'green' }),
    ])
    const html = materializeHighlightSentinels(wrapped)
    // The earlier (amber) highlight keeps the shared "beta"; green takes the rest.
    // The leading space of green's run is trimmed (whitespace isn't highlighted),
    // so it sits between the two marks as plain text.
    expect(html).toBe(
      '<mark class="cl-hl cl-hl-amber">alpha beta</mark> <mark class="cl-hl cl-hl-green">gamma</mark>',
    )
  })

  it('drops a highlight fully covered by an earlier, larger one', () => {
    const raw = 'the whole sentence here'
    const wrapped = wrapHighlightsWithSentinels(raw, [
      hl({ id: 'a', start: 0, end: 23, quote: 'the whole sentence here', color: 'blue' }),
      hl({ id: 'b', start: 4, end: 9, quote: 'whole', color: 'pink' }),
    ])
    const html = materializeHighlightSentinels(wrapped)
    expect(html).toBe('<mark class="cl-hl cl-hl-blue">the whole sentence here</mark>')
  })

  it('survives HTML escaping of the surrounding text (sentinels are PUA chars)', () => {
    // Simulate the export pipeline: wrap raw, escape, then materialize.
    const raw = 'a < b and c'
    const wrapped = wrapHighlightsWithSentinels(raw, [hl({ start: 0, end: 1, quote: 'a' })])
    const escaped = wrapped.replace(/</g, '&lt;')
    const html = materializeHighlightSentinels(escaped)
    expect(html).toBe('<mark class="cl-hl cl-hl-amber">a</mark> &lt; b and c')
  })
})

describe('fencedCodeRanges', () => {
  it('returns no ranges when there is no fence', () => {
    expect(fencedCodeRanges('plain prose, even with `inline code`')).toEqual([])
  })

  it('spans an opening fence through its closer', () => {
    const raw = ['before', '```js', 'const x = 1', '```', 'after'].join('\n')
    const ranges = fencedCodeRanges(raw)
    expect(ranges).toHaveLength(1)
    // The code line sits inside the located range; the surrounding prose does not.
    const code = raw.indexOf('const x = 1')
    expect(ranges[0].from).toBeLessThanOrEqual(code)
    expect(ranges[0].to).toBeGreaterThan(code + 'const x = 1'.length)
    expect(code).toBeGreaterThan(0)
  })

  it('treats an unterminated fence as running to the end', () => {
    const raw = ['intro', '~~~', 'no closer'].join('\n')
    const ranges = fencedCodeRanges(raw)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].to).toBe(raw.length)
  })

  it('does not mistake inline single backticks for a fence', () => {
    expect(fencedCodeRanges('use `a` and `b` here')).toEqual([])
  })
})

describe('wrapHighlightsWithSentinels skipFencedCode', () => {
  const raw = ['Run this:', '', '```bash', 'npm test', '```'].join('\n')

  it('skips a highlight resolving inside a fenced code block', () => {
    const wrapped = wrapHighlightsWithSentinels(
      raw,
      [hl({ start: 0, end: 8, quote: 'npm test' })],
      { skipFencedCode: true },
    )
    expect(wrapped).toBe(raw)
    expect(hasHighlightSentinels(wrapped)).toBe(false)
  })

  it('still wraps the same highlight when the flag is off (HTML/PDF path)', () => {
    const wrapped = wrapHighlightsWithSentinels(raw, [hl({ start: 0, end: 8, quote: 'npm test' })])
    expect(hasHighlightSentinels(wrapped)).toBe(true)
  })

  it('still wraps inline code even with skipFencedCode on', () => {
    const inline = 'use `npm test` now'
    const quote = 'use npm test now'
    const wrapped = wrapHighlightsWithSentinels(
      inline,
      [hl({ start: 0, end: quote.length, quote })],
      { skipFencedCode: true },
    )
    expect(materializeHighlightSentinels(wrapped)).toBe(
      '<mark class="cl-hl cl-hl-amber">use `npm test` now</mark>',
    )
  })
})

describe('inlineRuns', () => {
  it('keeps a single paragraph as one run', () => {
    expect(inlineRuns('hello world', 0, 11)).toEqual([[0, 11]])
  })

  it('splits on a blank line into per-paragraph runs (trimmed)', () => {
    const raw = 'para one\n\npara two'
    expect(inlineRuns(raw, 0, raw.length)).toEqual([
      [0, 8],
      [10, 18],
    ])
  })

  it('drops a display-math block but keeps the paragraphs around it', () => {
    const raw = 'before\n\n$$x = y$$\n\nafter'
    const runs = inlineRuns(raw, 0, raw.length)
    expect(runs.map(([s, e]) => raw.slice(s, e))).toEqual(['before', 'after'])
  })

  it('drops a run that lies inside a fenced range', () => {
    expect(inlineRuns('code', 0, 4, [{ from: 0, to: 4 }])).toEqual([])
  })
})

describe('textSegmentsExcluding', () => {
  it('returns the whole span when there are no intervals', () => {
    expect(textSegmentsExcluding(0, 10, [])).toEqual([[0, 10]])
  })

  it('splits around a single formula in the middle', () => {
    // "text [formula] text" — exclude the formula offsets [5, 12).
    expect(textSegmentsExcluding(0, 20, [{ start: 5, end: 12 }])).toEqual([
      [0, 5],
      [12, 20],
    ])
  })

  it('handles adjacent / multiple formulas', () => {
    expect(
      textSegmentsExcluding(0, 30, [
        { start: 4, end: 8 },
        { start: 8, end: 14 },
        { start: 20, end: 25 },
      ]),
    ).toEqual([
      [0, 4],
      [14, 20],
      [25, 30],
    ])
  })

  it('clamps a formula that starts before the highlight and drops a fully-covered tail', () => {
    // Formula spans [0, 6): the highlight starts at 2, so no leading segment;
    // a trailing formula past `end` is clamped away.
    expect(textSegmentsExcluding(2, 18, [{ start: 0, end: 6 }, { start: 15, end: 30 }])).toEqual([
      [6, 15],
    ])
  })

  it('returns nothing when the highlight is entirely inside one formula', () => {
    expect(textSegmentsExcluding(5, 9, [{ start: 0, end: 20 }])).toEqual([])
  })
})

describe('isPersistableMessageUuid', () => {
  it('rejects synthetic __sentinel__ uuids and empty strings', () => {
    expect(isPersistableMessageUuid('__pending_user__')).toBe(false)
    expect(isPersistableMessageUuid('')).toBe(false)
  })

  it('accepts real transcript uuids', () => {
    expect(isPersistableMessageUuid('b3b6e0c2-1f0a-4f4e-9d2a-2a1f9c8e7d6b')).toBe(true)
  })
})

describe('exportHighlightCss', () => {
  it('emits a rule for every highlight color', () => {
    const css = exportHighlightCss()
    expect(css).toContain('mark.cl-hl-amber')
    expect(css).toContain('mark.cl-hl-green')
    expect(css).toContain('mark.cl-hl-blue')
    expect(css).toContain('mark.cl-hl-pink')
  })
})
