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

export type HighlightColor = 'amber' | 'green' | 'blue' | 'pink';

export interface Highlight {
  /** Stable id (crypto.randomUUID) so recolor/remove target one mark. */
  id: string;
  /** uuid of the owning chat message (stable, from the .jsonl transcript). */
  messageUuid: string;
  /** Index of the text block within that message (usually 0). */
  blockIndex: number;
  /** Start offset into the block's rendered textContent. */
  start: number;
  /** End offset (exclusive) into the block's rendered textContent. */
  end: number;
  /** The rendered text that was selected — used to validate (stale-skip) + as the
   *  default export relocation key. */
  quote: string;
  /** Export-only relocation key: like `quote` but with each KaTeX formula replaced
   *  by its raw TeX source, so it can be found in the raw markdown ($…$/$$…$$)
   *  where the rendered text can't. Set only when the selection spans a formula;
   *  the export falls back to `quote` otherwise. */
  exportQuote?: string;
  color: HighlightColor;
  createdAt: string;
}

/** Persisted shape: one highlight list per session id. */
export type HighlightStore = Record<string, Highlight[]>;

export const HIGHLIGHT_COLORS: Array<{ key: HighlightColor; label: string; css: string }> = [
  { key: 'amber', label: 'Amber', css: 'rgba(224, 168, 64, 0.38)' },
  { key: 'green', label: 'Green', css: 'rgba(96, 160, 110, 0.36)' },
  { key: 'blue', label: 'Blue', css: 'rgba(96, 142, 198, 0.34)' },
  { key: 'pink', label: 'Pink', css: 'rgba(208, 112, 152, 0.34)' },
];

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = 'amber';

export function highlightCss(color: HighlightColor): string {
  return (HIGHLIGHT_COLORS.find(c => c.key === color) ?? HIGHLIGHT_COLORS[0]).css;
}

/** DOM data-attribute value identifying a highlightable block. */
export function blockKey(messageUuid: string, blockIndex: number): string {
  return `${messageUuid}:${blockIndex}`;
}

/** Whether a message uuid is durable enough to anchor a highlight. Synthetic
 *  uuids (the optimistic `__pending_user__` bubble shown mid-stream) use a
 *  `__sentinel__` form and never persist: the real message lands later with its
 *  transcript uuid, so a highlight anchored to the synthetic one would orphan
 *  forever in the store (never repainted, never exported). Gate the
 *  `data-hl-block` attribute on this so such blocks aren't highlightable. */
export function isPersistableMessageUuid(uuid: string): boolean {
  return !!uuid && !(uuid.startsWith('__') && uuid.endsWith('__'));
}

// ---------------------------------------------------------------------------
// DOM range utilities (rendered-textContent offset space)
// ---------------------------------------------------------------------------

/** Character offset of (node, nodeOffset) within `container`'s textContent.
 *  Measured with a Range so an endpoint landing on an *element* node — a
 *  triple-click, or a mouse release on a block boundary, where `node` is an
 *  element and `nodeOffset` is a child index, not a text node — is handled
 *  correctly: the text up to that point is exactly what a range from the
 *  container start to (node, nodeOffset) contains. (A text-node tree-walk would
 *  miss the element endpoint and overshoot to the container's full length.) */
export function textOffsetWithin(container: Node, node: Node, nodeOffset: number): number {
  const range = document.createRange();
  range.selectNodeContents(container);
  try {
    range.setEnd(node, nodeOffset);
  } catch {
    // node not under container, or offset out of range — fall back to full length.
    return container.textContent?.length ?? 0;
  }
  return range.toString().length;
}

/** Split [start, end) into the sub-segments that fall OUTSIDE the given intervals
 *  (each `{start, end}`, e.g. a KaTeX formula's offset span), in order. Used so the
 *  per-glyph Custom Highlight API paints only the plain text between formulas — the
 *  formulas themselves get a solid box fill instead, since per-glyph painting
 *  leaves gaps across KaTeX's math layout. Intervals must be sorted by `start`. */
export function textSegmentsExcluding(
  start: number,
  end: number,
  intervals: Array<{ start: number; end: number }>
): Array<[number, number]> {
  const segments: Array<[number, number]> = [];
  let pos = start;
  for (const iv of intervals) {
    if (iv.start > pos) segments.push([pos, Math.min(iv.start, end)]);
    pos = Math.max(pos, iv.end);
    if (pos >= end) break;
  }
  if (pos < end) segments.push([pos, end]);
  return segments;
}

/** Build a Range spanning [start, end) of `container`'s rendered textContent. */
export function rangeFromOffsets(container: Node, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let len = 0;
  let started = false;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const textLen = n.textContent?.length ?? 0;
    const next = len + textLen;
    if (!started && start <= next) {
      range.setStart(n, Math.max(0, start - len));
      started = true;
    }
    if (started && end <= next) {
      range.setEnd(n, Math.max(0, end - len));
      return range;
    }
    len = next;
  }
  if (started) {
    // end ran past the last text node — clamp to the container's end.
    range.setEnd(container, container.childNodes.length);
    return range;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Export injection (raw markdown ← rendered-offset highlights via quote match)
// ---------------------------------------------------------------------------

// Private-use-area sentinels so markdown/HTML escaping never mangles them. They
// are injected into the raw block text, then materialized into <mark> tags after
// rendering. PUA chars never occur in real transcript text and pass through
// escapeHtml / the markdown inline regexes untouched. Built via String.fromCharCode
// so the source stays pure ASCII (no literal control glyphs).
const SENT_OPEN = String.fromCharCode(0xe000); // open marker, then the color name
const SENT_MID = String.fromCharCode(0xe001); // ends color name, opens the run
const SENT_CLOSE = String.fromCharCode(0xe002); // closes the run
const SENT_OPEN_RE = new RegExp(SENT_OPEN + '(amber|green|blue|pink)' + SENT_MID, 'g');
const SENT_CLOSE_RE = new RegExp(SENT_CLOSE, 'g');

// Inline markdown markers that render to nothing — skipped when matching a
// rendered quote against the raw source (so `code`, **bold**, _em_, ~strike~
// inside a highlight still locate). `$` is the math delimiter: it isn't in the
// rendered text nor in a formula's TeX source (exportQuote), so skipping it lets a
// highlight spanning `$…$`/`$$…$$` relocate against the raw.
const INLINE_MARKERS = new Set(['`', '*', '_', '~', '$']);

/** Locate `quote` (rendered text, marker-free) inside `raw` (markdown source),
 *  starting at `fromCursor`. Matches char-for-char but skips, in `raw`, the inline
 *  markers and whitespace that have no counterpart in the rendered quote — so the
 *  located span keeps the raw markup (e.g. backticks) and re-renders as
 *  <code>/<strong> inside the <mark>, and a quote spanning a paragraph break
 *  (the rendered text concatenates the paragraphs with no separator, the raw has a
 *  blank line) still locates. Trailing markers are absorbed so a closing ` / ** isn't
 *  orphaned outside the span. Returns the raw [from, to) span, or null if not found.
 *  Note: a quote crossing a math formula won't locate (the raw is TeX, the quote is
 *  the rendered text) — that highlight soft-degrades in export, by design. */
export function locateQuoteInRaw(
  raw: string,
  quote: string,
  fromCursor: number
): { from: number; to: number } | null {
  if (!quote) return null;
  for (let start = fromCursor; start <= raw.length - quote.length; start++) {
    let i = start;
    let q = 0;
    while (i < raw.length && q < quote.length) {
      if (raw[i] === quote[q]) {
        i++;
        q++;
      } else if (INLINE_MARKERS.has(raw[i]) || (q > 0 && /\s/.test(raw[i]))) {
        // Skip a markup char, or — only once the match is under way (q > 0, so we
        // never absorb leading whitespace into the span) — whitespace in the raw
        // with no counterpart in the rendered quote (e.g. the blank line between
        // two paragraphs).
        i++;
      } else {
        break;
      }
    }
    if (q === quote.length) {
      // Absorb a run of closing markers (e.g. the trailing backtick of `code`).
      while (i < raw.length && INLINE_MARKERS.has(raw[i])) i++;
      return { from: start, to: i };
    }
  }
  return null;
}

/** Character ranges [from, to) in `raw` that lie inside a fenced code block
 *  (``` or ~~~). Inline code (single backticks) is intentionally NOT included —
 *  it must keep rendering as <code> inside a <mark>. Used to soft-degrade
 *  highlights in the Markdown export, where a <mark> tag injected inside a fence
 *  would print as literal text instead of rendering. */
export function fencedCodeRanges(raw: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  let pos = 0;
  let open: { from: number; marker: string } | null = null;
  for (const line of raw.split('\n')) {
    const lineStart = pos;
    const lineEnd = pos + line.length;
    if (!open) {
      const m = line.match(/^\s*(`{3,}|~{3,})/);
      if (m) open = { from: lineStart, marker: m[1][0] };
    } else {
      // Closing fence: same fence char, alone on its line (CommonMark allows
      // surrounding whitespace but no info string on the closer).
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === open.marker) {
        ranges.push({ from: open.from, to: lineEnd });
        open = null;
      }
    }
    pos = lineEnd + 1; // +1 for the '\n' that split consumed
  }
  // An unterminated fence runs to the end of the block.
  if (open) ranges.push({ from: open.from, to: raw.length });
  return ranges;
}

/** Split a located raw span [from, to) into the inline runs that can safely carry
 *  a <mark>: one per markdown block. A single <mark> can't straddle a paragraph
 *  break (`<p><mark>a</p><p>b</mark></p>` is invalid HTML), so the span is cut on
 *  blank lines. Block-level segments that can't be inline-wrapped are dropped:
 *  display math (`$$…$$`, soft-degrades — it still renders, just unhighlighted)
 *  and fenced code. Leading/trailing whitespace is trimmed off each run. */
export function inlineRuns(
  rawText: string,
  from: number,
  to: number,
  fences: Array<{ from: number; to: number }> = []
): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  const push = (s: number, e: number) => {
    while (s < e && /\s/.test(rawText[s])) s++;
    while (e > s && /\s/.test(rawText[e - 1])) e--;
    if (s >= e) return;
    if (rawText.startsWith('$$', s)) return; // display math block — can't inline-wrap
    if (fences.some(f => s < f.to && e > f.from)) return;
    runs.push([s, e]);
  };
  const re = /\n[ \t]*\n+/g; // blank line(s) = paragraph/block boundary
  re.lastIndex = from;
  let last = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawText)) !== null && m.index < to) {
    push(last, m.index);
    last = m.index + m[0].length;
  }
  push(last, to);
  return runs;
}

/** Wrap each highlight's quote (located in the raw block text, tolerant to inline
 *  markdown markers) with color sentinels. Highlights are processed in document
 *  order; the search cursor advances just past each match's start so repeated
 *  quotes map to successive occurrences AND a highlight overlapping a prior one
 *  can still be located. Overlaps are then clamped so the emitted spans never
 *  nest — the earlier highlight's color wins the shared region, the later one
 *  keeps the remainder (matches the live view, which never drops a highlight; it
 *  only differs in how the overlap is tinted). Each located span is then split
 *  into per-block inline runs (see inlineRuns) so a <mark> never straddles a
 *  paragraph break. A quote that can't be located at all (the text genuinely
 *  changed) is skipped, leaving the surrounding text intact — the documented
 *  soft-degrade.
 *  With `skipFencedCode`, a quote that resolves inside a fenced code block is also
 *  skipped: the Markdown export can't carry a <mark> there (it would print
 *  literally). The HTML/PDF export omits the flag — a <mark> inside <pre><code>
 *  renders fine there, so highlighted code still shows on screen and in PDF. */
export function wrapHighlightsWithSentinels(
  rawText: string,
  highlights: Highlight[],
  opts: { skipFencedCode?: boolean } = {}
): string {
  if (highlights.length === 0) return rawText;
  const fences = opts.skipFencedCode ? fencedCodeRanges(rawText) : [];
  const insideFence = (from: number, to: number) => fences.some(f => from < f.to && to > f.from);
  const ordered = [...highlights].sort((a, b) => a.start - b.start);
  type Span = { from: number; to: number; color: HighlightColor };
  const spans: Span[] = [];
  let searchFrom = 0;
  let lastTo = 0;
  for (const h of ordered) {
    // Prefer the TeX-aware export key so a highlight spanning a formula relocates.
    const q = h.exportQuote ?? h.quote;
    if (!q) continue;
    const located = locateQuoteInRaw(rawText, q, searchFrom);
    if (!located) continue;
    const { from, to } = located;
    // Advance past this match's start (not its end), so a later highlight that
    // overlaps this one can still resolve.
    searchFrom = from + 1;
    // Soft-degrade a highlight that landed inside a fenced code block (Markdown
    // export only); the cursor already advanced so later quotes search past it.
    if (insideFence(from, to)) continue;
    // Clamp the start past the last emitted span: overlapping highlights become
    // adjacent (non-nested) marks instead of one being dropped. A highlight fully
    // covered by an earlier one collapses to nothing here.
    const start = Math.max(from, lastTo);
    if (start >= to) continue;
    spans.push({ from: start, to, color: h.color });
    lastTo = to;
  }
  // Expand each span into per-block inline runs so a <mark> never straddles a
  // block boundary (which would emit invalid HTML); drop display-math/fenced runs.
  const runs: Span[] = [];
  for (const s of spans) {
    for (const [rf, rt] of inlineRuns(rawText, s.from, s.to, fences)) {
      runs.push({ from: rf, to: rt, color: s.color });
    }
  }
  if (runs.length === 0) return rawText;
  let out = '';
  let pos = 0;
  for (const r of runs) {
    out +=
      rawText.slice(pos, r.from) +
      SENT_OPEN +
      r.color +
      SENT_MID +
      rawText.slice(r.from, r.to) +
      SENT_CLOSE;
    pos = r.to;
  }
  out += rawText.slice(pos);
  return out;
}

/** Replace sentinels with real <mark> tags. Safe to call on already-escaped HTML
 *  (the PUA sentinels survive escapeHtml untouched) and on raw markdown. */
export function materializeHighlightSentinels(value: string): string {
  return value
    .replace(SENT_OPEN_RE, (_m, color: string) => `<mark class="cl-hl cl-hl-${color}">`)
    .replace(SENT_CLOSE_RE, '</mark>');
}

/** Whether a string still carries un-materialized sentinels (used to gate work). */
export function hasHighlightSentinels(value: string): boolean {
  return value.includes(SENT_OPEN) || value.includes(SENT_CLOSE);
}

/** Inline CSS for the export document's <mark> classes, generated from the same
 *  color map the live view uses so the printed colors match the screen. */
export function exportHighlightCss(): string {
  const rules = HIGHLIGHT_COLORS.map(
    c => `mark.cl-hl-${c.key} { background-color: ${c.css}; }`
  ).join('\n    ');
  // An inline <code> chip inside a <mark> carries its own opaque background that
  // would mask the highlight — drop it so the highlight color shows through
  // (mirrors the live view's .cl-hl-through rule).
  return `mark.cl-hl { color: inherit; border-radius: 2px; padding: 0 1px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
    mark.cl-hl code { background: transparent; padding-left: 0; padding-right: 0; }
    ${rules}`;
}
