import { describe, it, expect } from 'vitest'
import {
  Highlight,
  wrapHighlightsWithSentinels,
  materializeHighlightSentinels,
  hasHighlightSentinels,
  exportHighlightCss,
  locateQuoteInRaw,
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

  it('survives HTML escaping of the surrounding text (sentinels are PUA chars)', () => {
    // Simulate the export pipeline: wrap raw, escape, then materialize.
    const raw = 'a < b and c'
    const wrapped = wrapHighlightsWithSentinels(raw, [hl({ start: 0, end: 1, quote: 'a' })])
    const escaped = wrapped.replace(/</g, '&lt;')
    const html = materializeHighlightSentinels(escaped)
    expect(html).toBe('<mark class="cl-hl cl-hl-amber">a</mark> &lt; b and c')
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
