// Persistent text highlights for the Lens chat view. A highlight marks a stretch
// of a single rendered block (a paragraph, list item, heading…) of one message so
// the reader can flag what matters during a long chat — and so it survives into
// the exported transcript shared with a teammate.
//
// Anchor model: offsets are measured in the *rendered* textContent space of a
// block (what react-markdown paints), not the raw markdown source. The live view
// selects rendered text, so capture + repaint stay in that space. Export operates
// on raw markdown instead, so it re-locates each highlight by its `quote` string
// (soft-degrades when inline markdown sits inside the selection — see
// wrapHighlightsWithSentinels). Highlights are scoped to a single block by design,
// which keeps both range reconstruction and export injection simple and robust.

// ---------------------------------------------------------------------------
// Types & colors
// ---------------------------------------------------------------------------

export type HighlightColor = 'amber' | 'green' | 'blue' | 'pink'

export interface Highlight {
  /** Stable id (crypto.randomUUID) so recolor/remove target one mark. */
  id: string
  /** uuid of the owning chat message (stable, from the .jsonl transcript). */
  messageUuid: string
  /** Index of the text block within that message (usually 0). */
  blockIndex: number
  /** Start offset into the block's rendered textContent. */
  start: number
  /** End offset (exclusive) into the block's rendered textContent. */
  end: number
  /** The rendered text that was selected — used to export + validate (stale-skip). */
  quote: string
  color: HighlightColor
  createdAt: string
}

/** Persisted shape: one highlight list per session id. */
export type HighlightStore = Record<string, Highlight[]>

export const HIGHLIGHT_COLORS: Array<{ key: HighlightColor; label: string; css: string }> = [
  { key: 'amber', label: 'Amber', css: 'rgba(224, 168, 64, 0.38)' },
  { key: 'green', label: 'Green', css: 'rgba(96, 160, 110, 0.36)' },
  { key: 'blue', label: 'Blue', css: 'rgba(96, 142, 198, 0.34)' },
  { key: 'pink', label: 'Pink', css: 'rgba(208, 112, 152, 0.34)' },
]

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = 'amber'

export function highlightCss(color: HighlightColor): string {
  return (HIGHLIGHT_COLORS.find(c => c.key === color) ?? HIGHLIGHT_COLORS[0]).css
}

/** DOM data-attribute value identifying a highlightable block. */
export function blockKey(messageUuid: string, blockIndex: number): string {
  return `${messageUuid}:${blockIndex}`
}

// ---------------------------------------------------------------------------
// DOM range utilities (rendered-textContent offset space)
// ---------------------------------------------------------------------------

/** Character offset of (node, nodeOffset) within `container`'s textContent,
 *  walking text nodes in document order. Returns container length if not found. */
export function textOffsetWithin(container: Node, node: Node, nodeOffset: number): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let len = 0
  let n: Node | null
  while ((n = walker.nextNode())) {
    if (n === node) return len + nodeOffset
    len += n.textContent?.length ?? 0
  }
  // The selection endpoint may land on an element node (e.g. node === container
  // with an element offset). Fall back to the accumulated length.
  return len
}

/** Build a Range spanning [start, end) of `container`'s rendered textContent. */
export function rangeFromOffsets(container: Node, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let len = 0
  let started = false
  let n: Node | null
  while ((n = walker.nextNode())) {
    const textLen = n.textContent?.length ?? 0
    const next = len + textLen
    if (!started && start <= next) {
      range.setStart(n, Math.max(0, start - len))
      started = true
    }
    if (started && end <= next) {
      range.setEnd(n, Math.max(0, end - len))
      return range
    }
    len = next
  }
  if (started) {
    // end ran past the last text node — clamp to the container's end.
    range.setEnd(container, container.childNodes.length)
    return range
  }
  return null
}

// ---------------------------------------------------------------------------
// Export injection (raw markdown ← rendered-offset highlights via quote match)
// ---------------------------------------------------------------------------

// Private-use-area sentinels so markdown/HTML escaping never mangles them. They
// are injected into the raw block text, then materialized into <mark> tags after
// rendering. PUA chars never occur in real transcript text and pass through
// escapeHtml / the markdown inline regexes untouched. Built via String.fromCharCode
// so the source stays pure ASCII (no literal control glyphs).
const SENT_OPEN = String.fromCharCode(0xe000) // open marker, then the color name
const SENT_MID = String.fromCharCode(0xe001) // ends color name, opens the run
const SENT_CLOSE = String.fromCharCode(0xe002) // closes the run
const SENT_OPEN_RE = new RegExp(SENT_OPEN + '(amber|green|blue|pink)' + SENT_MID, 'g')
const SENT_CLOSE_RE = new RegExp(SENT_CLOSE, 'g')

// Inline markdown markers that render to nothing — skipped when matching a
// rendered quote against the raw source (so `code`, **bold**, _em_, ~strike~
// inside a highlight still locate).
const INLINE_MARKERS = new Set(['`', '*', '_', '~'])

/** Locate `quote` (rendered text, marker-free) inside `raw` (markdown source),
 *  starting at `fromCursor`. Matches char-for-char but skips inline markers in
 *  `raw` that don't line up with the quote — so the located span keeps the raw
 *  markup (e.g. backticks) and re-renders as <code>/<strong> inside the <mark>.
 *  Trailing markers are absorbed so a closing ` / ** isn't orphaned outside the
 *  span. Returns the raw [from, to) span, or null if not found. */
export function locateQuoteInRaw(
  raw: string,
  quote: string,
  fromCursor: number,
): { from: number; to: number } | null {
  if (!quote) return null
  for (let start = fromCursor; start <= raw.length - quote.length; start++) {
    let i = start
    let q = 0
    while (i < raw.length && q < quote.length) {
      if (raw[i] === quote[q]) {
        i++
        q++
      } else if (INLINE_MARKERS.has(raw[i])) {
        i++ // skip a markup char that has no counterpart in the rendered quote
      } else {
        break
      }
    }
    if (q === quote.length) {
      // Absorb a run of closing markers (e.g. the trailing backtick of `code`).
      while (i < raw.length && INLINE_MARKERS.has(raw[i])) i++
      return { from: start, to: i }
    }
  }
  return null
}

/** Wrap each highlight's quote (located in the raw block text, tolerant to inline
 *  markdown markers) with color sentinels. Highlights are processed in document
 *  order; the search cursor advances so repeated quotes map to successive
 *  occurrences. A quote that can't be located at all (the text genuinely changed)
 *  is skipped, leaving the surrounding text intact — the documented soft-degrade. */
export function wrapHighlightsWithSentinels(rawText: string, highlights: Highlight[]): string {
  if (highlights.length === 0) return rawText
  const ordered = [...highlights].sort((a, b) => a.start - b.start)
  type Span = { from: number; to: number; color: HighlightColor }
  const spans: Span[] = []
  let cursor = 0
  let lastTo = 0
  for (const h of ordered) {
    if (!h.quote) continue
    const located = locateQuoteInRaw(rawText, h.quote, cursor)
    if (!located) continue
    const { from, to } = located
    // Skip overlapping spans (a quote that re-matches inside a prior one).
    if (from < lastTo) continue
    spans.push({ from, to, color: h.color })
    cursor = to
    lastTo = to
  }
  if (spans.length === 0) return rawText
  let out = ''
  let pos = 0
  for (const s of spans) {
    out +=
      rawText.slice(pos, s.from) +
      SENT_OPEN + s.color + SENT_MID +
      rawText.slice(s.from, s.to) +
      SENT_CLOSE
    pos = s.to
  }
  out += rawText.slice(pos)
  return out
}

/** Replace sentinels with real <mark> tags. Safe to call on already-escaped HTML
 *  (the PUA sentinels survive escapeHtml untouched) and on raw markdown. */
export function materializeHighlightSentinels(value: string): string {
  return value
    .replace(SENT_OPEN_RE, (_m, color: string) => `<mark class="cl-hl cl-hl-${color}">`)
    .replace(SENT_CLOSE_RE, '</mark>')
}

/** Whether a string still carries un-materialized sentinels (used to gate work). */
export function hasHighlightSentinels(value: string): boolean {
  return value.includes(SENT_OPEN) || value.includes(SENT_CLOSE)
}

/** Inline CSS for the export document's <mark> classes, generated from the same
 *  color map the live view uses so the printed colors match the screen. */
export function exportHighlightCss(): string {
  const rules = HIGHLIGHT_COLORS.map(
    c => `mark.cl-hl-${c.key} { background-color: ${c.css}; }`,
  ).join('\n    ')
  // An inline <code> chip inside a <mark> carries its own opaque background that
  // would mask the highlight — drop it so the highlight color shows through
  // (mirrors the live view's .cl-hl-through rule).
  return `mark.cl-hl { color: inherit; border-radius: 2px; padding: 0 1px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
    mark.cl-hl code { background: transparent; padding-left: 0; padding-right: 0; }
    ${rules}`
}
