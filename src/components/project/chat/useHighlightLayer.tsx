import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Highlight as TextHighlight,
  HighlightColor,
  HIGHLIGHT_COLORS,
  blockKey,
  rangeFromOffsets,
  textOffsetWithin,
  textSegmentsExcluding,
} from './highlights'
import { HighlightsApi } from './useHighlights'

// `Highlight` (unqualified) below is the DOM Custom Highlight API constructor;
// our persisted-model type is aliased to TextHighlight to avoid the name clash.

// Wires text-selection → persistent highlights for the chat reading column, and
// paints them with the CSS Custom Highlight API (no DOM mutation, so it never
// fights react-markdown's reconciliation). A highlight is scoped to one message
// text block (the [data-hl-block] wrapper) but may span multiple rendered
// paragraphs/formulas inside it — offsets live in that wrapper's textContent, so
// rangeFromOffsets reconstructs a range across paragraph boundaries fine. The
// export relocates by quote and soft-degrades when it can't find the text
// verbatim in the raw markdown (e.g. across a paragraph break or a formula).

const HL_NAMES = HIGHLIGHT_COLORS.map(c => `cl-hl-${c.key}`)
const HL_FORMULA_CLASSES = HIGHLIGHT_COLORS.map(c => `cl-hl-formula-${c.key}`)

/** Offset spans (in the wrapper's textContent) of every KaTeX formula that
 *  intersects [start, end). KaTeX lays out math with CSS (kerning, fractions,
 *  positioned sub/superscripts), so the per-glyph Custom Highlight API leaves gaps
 *  across it — these spans are kept out of the painted ranges and the formula box
 *  is solid-filled instead (see repaint). */
function formulaIntervalsWithin(
  wrapper: Element,
  start: number,
  end: number,
): Array<{ el: Element; start: number; end: number }> {
  const out: Array<{ el: Element; start: number; end: number }> = []
  wrapper.querySelectorAll('.katex').forEach(el => {
    const before = document.createRange()
    before.selectNodeContents(wrapper)
    try {
      before.setEndBefore(el)
    } catch {
      return
    }
    const kStart = before.toString().length
    const own = document.createRange()
    own.selectNode(el)
    const kEnd = kStart + own.toString().length
    if (kStart < end && kEnd > start) out.push({ el, start: kStart, end: kEnd })
  })
  return out.sort((a, b) => a.start - b.start)
}

/** Export relocation key for a selection: like range.toString() but with each
 *  KaTeX formula replaced by its raw TeX source (from the MathML annotation), so
 *  it can be found in the raw markdown ($…$/$$…$$) where the rendered MathML text
 *  can't. Returns null when there are no formulas (the plain quote already works). */
function buildExportQuote(range: Range): string | null {
  const frag = range.cloneContents()
  const formulas = frag.querySelectorAll('.katex')
  if (formulas.length === 0) return null
  formulas.forEach(k => {
    const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    k.replaceWith(document.createTextNode(tex ?? ''))
  })
  return frag.textContent ?? ''
}

type DocWithCaret = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

/** True when the CSS Custom Highlight API is available (Chromium 105+). */
function highlightApiSupported(): boolean {
  return typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && !!CSS.highlights
}

/** Climb to the [data-hl-block] wrapper that owns `node`, if any. */
function wrapperOf(node: Node): HTMLElement | null {
  const start = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
  return (start?.closest('[data-hl-block]') as HTMLElement | null) ?? null
}

function parseBlockKey(attr: string): { messageUuid: string; blockIndex: number } | null {
  const sep = attr.lastIndexOf(':')
  if (sep < 0) return null
  return { messageUuid: attr.slice(0, sep), blockIndex: Number(attr.slice(sep + 1)) }
}

export type ToolbarPlacement = { left: number; top: number }
export type ToolbarState =
  | { kind: 'create'; at: ToolbarPlacement }
  | { kind: 'edit'; at: ToolbarPlacement; color: HighlightColor }
  | null

// What the next color pick / remove acts on.
type Pending =
  | { kind: 'create'; messageUuid: string; blockIndex: number; start: number; end: number; quote: string; exportQuote?: string }
  | { kind: 'edit'; id: string }
  | null

type Params = {
  // The transcript column element. Passed as state (not a ref) so the effects
  // below re-run once the column actually mounts — it appears only after the
  // messages load, so a ref would leave the listeners attached to nothing.
  container: HTMLElement | null
  api: HighlightsApi
  /** Disable capture/paint (e.g. while an overlay covers the transcript). */
  enabled?: boolean
}

export function useHighlightLayer({ container, api, enabled = true }: Params) {
  const { highlights, addHighlight, removeHighlight, setHighlightColor } = api
  const [toolbar, setToolbar] = useState<ToolbarState>(null)
  const pendingRef = useRef<Pending>(null)
  // Latest highlights for event handlers bound once (avoid re-binding listeners).
  const highlightsRef = useRef<TextHighlight[]>(highlights)
  useLayoutEffect(() => {
    highlightsRef.current = highlights
  }, [highlights])

  const closeToolbar = useCallback(() => {
    pendingRef.current = null
    setToolbar(null)
  }, [])

  // --- Painting ----------------------------------------------------------
  const repaint = useCallback(() => {
    if (!container || !highlightApiSupported()) return
    const buckets: Record<HighlightColor, Range[]> = { amber: [], green: [], blue: [], pink: [] }
    const allRanges: Range[] = []
    // KaTeX formulas to solid-fill (and their color), instead of per-glyph paint.
    const formulaPaints: Array<{ el: Element; color: HighlightColor }> = []
    // Drop the previous formula box-fill flags before recomputing.
    container
      .querySelectorAll('.cl-hl-formula')
      .forEach(el => el.classList.remove('cl-hl-formula', ...HL_FORMULA_CLASSES))
    for (const h of highlightsRef.current) {
      const wrapper = container.querySelector(
        `[data-hl-block="${CSS.escape(blockKey(h.messageUuid, h.blockIndex))}"]`,
      )
      if (!wrapper) continue
      const range = rangeFromOffsets(wrapper, h.start, h.end)
      if (!range) continue
      // Stale-skip: the anchored range no longer matches the recorded text.
      if (h.quote && range.toString().trim() !== h.quote.trim()) continue
      // KaTeX formulas inside the highlight get a solid box fill (the per-glyph
      // Highlight API leaves gaps across math layout) and are excluded from the
      // painted ranges so the two don't double up.
      const formulas = formulaIntervalsWithin(wrapper, h.start, h.end)
      if (formulas.length === 0) {
        buckets[h.color]?.push(range)
        allRanges.push(range)
      } else {
        for (const [s, e] of textSegmentsExcluding(h.start, h.end, formulas)) {
          const r = rangeFromOffsets(wrapper, s, e)
          if (r) {
            buckets[h.color]?.push(r)
            allRanges.push(r)
          }
        }
        for (const f of formulas) formulaPaints.push({ el: f.el, color: h.color })
      }
    }
    for (const c of HIGHLIGHT_COLORS) {
      const name = `cl-hl-${c.key}`
      const ranges = buckets[c.key]
      if (ranges.length > 0) CSS.highlights.set(name, new Highlight(...ranges))
      else CSS.highlights.delete(name)
    }
    for (const { el, color } of formulaPaints) {
      el.classList.add('cl-hl-formula', `cl-hl-formula-${color}`)
    }
    // Inline code chips own an opaque background + padding that would mask the
    // highlight overlay painted behind them (the reported "spaces near backticks
    // aren't colored"). Mark every inline <code> that falls inside a highlight so
    // CSS can drop its background and let the highlight show through. Toggling a
    // class doesn't re-trigger the MutationObserver below (it watches childList/
    // characterData, not attributes).
    container.querySelectorAll('code.cl-hl-through').forEach(el => el.classList.remove('cl-hl-through'))
    if (allRanges.length > 0) {
      container.querySelectorAll('code:not(pre code)').forEach(el => {
        if (allRanges.some(r => r.intersectsNode(el))) el.classList.add('cl-hl-through')
      })
    }
  }, [container])

  // Repaint when highlights change, and whenever the transcript DOM mutates
  // (filter/density toggles, markdown remounts) — Ranges break when their text
  // nodes are replaced, so a MutationObserver re-pins them.
  useLayoutEffect(() => {
    if (!enabled) return
    repaint()
    if (!container || typeof MutationObserver === 'undefined') return
    let raf = 0
    const obs = new MutationObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(repaint)
    })
    obs.observe(container, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelAnimationFrame(raf)
      obs.disconnect()
    }
  }, [enabled, repaint, highlights, container])

  // Clear our registry entries when the layer goes away so a stale paint can't
  // linger over a different session/view.
  useEffect(() => {
    return () => {
      if (!highlightApiSupported()) return
      for (const name of HL_NAMES) CSS.highlights.delete(name)
    }
  }, [])

  // --- Selection capture & hit-test --------------------------------------
  const findHighlightAtPoint = useCallback(
    (x: number, y: number): TextHighlight | null => {
      if (!container) return null
      const caret = (document as DocWithCaret).caretRangeFromPoint?.(x, y)
      if (!caret) return null
      const wrapper = wrapperOf(caret.startContainer)
      if (!wrapper || !container.contains(wrapper)) return null
      const attr = wrapper.getAttribute('data-hl-block')
      const parsed = attr ? parseBlockKey(attr) : null
      if (!parsed) return null
      const offset = textOffsetWithin(wrapper, caret.startContainer, caret.startOffset)
      return (
        highlightsRef.current.find(
          h =>
            h.messageUuid === parsed.messageUuid &&
            h.blockIndex === parsed.blockIndex &&
            offset >= h.start &&
            offset < h.end,
        ) ?? null
      )
    },
    [container],
  )

  useEffect(() => {
    // Without the Custom Highlight API a created highlight could never be
    // painted — don't wire capture at all, so the swatch toolbar never appears
    // promising something we can't render (no-op on Chromium, which supports it).
    if (!enabled || !container || !highlightApiSupported()) return

    const onMouseUp = () => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      // Use the range's textContent (NOT sel.toString()) as the quote, so capture,
      // repaint and the stale-check all measure text the same way. This is what
      // makes selections spanning a KaTeX formula work: a formula renders a hidden
      // MathML twin that the offset walk + repaint range both include, but
      // sel.toString() drops — recording sel.toString() left the quote out of sync
      // with the repainted range, so the highlight silently failed the stale-check
      // and never painted. The export relocates by quote and simply soft-degrades
      // a highlight whose text it can't find verbatim in the markdown (formulas).
      const text = range.toString()
      if (text.trim().length === 0) return // collapsed → handled by click hit-test
      const wrapper = wrapperOf(range.startContainer)
      const endWrapper = wrapperOf(range.endContainer)
      // Scoped to one message text block: start and end must share the same
      // [data-hl-block] wrapper (a selection may still span paragraphs/formulas
      // inside it). A selection crossing two messages/blocks is rejected.
      if (!wrapper || wrapper !== endWrapper || !container.contains(wrapper)) {
        closeToolbar()
        return
      }
      const attr = wrapper.getAttribute('data-hl-block')
      const parsed = attr ? parseBlockKey(attr) : null
      if (!parsed) return
      const a = textOffsetWithin(wrapper, range.startContainer, range.startOffset)
      const b = textOffsetWithin(wrapper, range.endContainer, range.endOffset)
      const [start, end] = a <= b ? [a, b] : [b, a]
      if (end <= start) return
      // exportQuote: only set when the selection spans a formula (TeX-aware key).
      const exportQuote = buildExportQuote(range) ?? undefined
      pendingRef.current = { kind: 'create', ...parsed, start, end, quote: text, exportQuote }
      const rect = range.getBoundingClientRect()
      setToolbar({ kind: 'create', at: { left: rect.left + rect.width / 2, top: rect.top } })
    }

    const onClick = (e: MouseEvent) => {
      const sel = window.getSelection()
      if (sel && sel.toString().trim().length > 0) return // real selection → mouseup owns it
      const hit = findHighlightAtPoint(e.clientX, e.clientY)
      if (hit) {
        pendingRef.current = { kind: 'edit', id: hit.id }
        setToolbar({ kind: 'edit', at: { left: e.clientX, top: e.clientY - 8 }, color: hit.color })
      } else {
        closeToolbar()
      }
    }

    container.addEventListener('mouseup', onMouseUp)
    container.addEventListener('click', onClick)
    return () => {
      container.removeEventListener('mouseup', onMouseUp)
      container.removeEventListener('click', onClick)
    }
  }, [enabled, container, closeToolbar, findHighlightAtPoint])

  // Dismiss when clicking outside both the transcript and the toolbar.
  useEffect(() => {
    if (!toolbar) return
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (container?.contains(target)) return
      if ((target as Element).closest?.('[data-hl-toolbar]')) return
      closeToolbar()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [toolbar, container, closeToolbar])

  // --- Actions -----------------------------------------------------------
  const pickColor = useCallback(
    (color: HighlightColor) => {
      const p = pendingRef.current
      if (!p) return
      if (p.kind === 'create') {
        addHighlight({
          messageUuid: p.messageUuid,
          blockIndex: p.blockIndex,
          start: p.start,
          end: p.end,
          quote: p.quote,
          exportQuote: p.exportQuote,
          color,
        })
        window.getSelection()?.removeAllRanges()
      } else {
        setHighlightColor(p.id, color)
      }
      closeToolbar()
    },
    [addHighlight, setHighlightColor, closeToolbar],
  )

  const removeCurrent = useCallback(() => {
    const p = pendingRef.current
    if (p?.kind === 'edit') removeHighlight(p.id)
    closeToolbar()
  }, [removeHighlight, closeToolbar])

  return { toolbar, pickColor, removeCurrent, closeToolbar }
}
