import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Highlight as TextHighlight,
  HighlightColor,
  HIGHLIGHT_COLORS,
  blockKey,
  rangeFromOffsets,
  textOffsetWithin,
} from './highlights'
import { HighlightsApi } from './useHighlights'

// `Highlight` (unqualified) below is the DOM Custom Highlight API constructor;
// our persisted-model type is aliased to TextHighlight to avoid the name clash.

// Wires text-selection → persistent highlights for the chat reading column, and
// paints them with the CSS Custom Highlight API (no DOM mutation, so it never
// fights react-markdown's reconciliation). Selections are constrained to a single
// rendered block element (paragraph/list-item/heading/code) so both range
// reconstruction and the export quote-match stay robust.

// Block-level tags that bound a single highlight. A selection crossing two of
// these (e.g. two paragraphs) is rejected.
const BLOCK_TAGS = new Set([
  'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'PRE', 'BLOCKQUOTE', 'TD', 'TH', 'DD', 'DT', 'FIGCAPTION',
])

const HL_NAMES = HIGHLIGHT_COLORS.map(c => `cl-hl-${c.key}`)

type DocWithCaret = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null
}

/** True when the CSS Custom Highlight API is available (Chromium 105+). */
function highlightApiSupported(): boolean {
  return typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && !!CSS.highlights
}

/** Nearest highlightable block-level element of `node`, bounded by `wrapper`.
 *  Falls back to the wrapper itself (e.g. a user message rendered as a bare <p>). */
function blockElementOf(node: Node, wrapper: Element): Element {
  let el: Element | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
  while (el && el !== wrapper) {
    if (BLOCK_TAGS.has(el.tagName)) return el
    el = el.parentElement
  }
  return wrapper
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
  | { kind: 'create'; messageUuid: string; blockIndex: number; start: number; end: number; quote: string }
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
    for (const h of highlightsRef.current) {
      const wrapper = container.querySelector(
        `[data-hl-block="${CSS.escape(blockKey(h.messageUuid, h.blockIndex))}"]`,
      )
      if (!wrapper) continue
      const range = rangeFromOffsets(wrapper, h.start, h.end)
      if (!range) continue
      // Stale-skip: the anchored range no longer matches the recorded text.
      if (h.quote && range.toString().trim() !== h.quote.trim()) continue
      buckets[h.color]?.push(range)
      allRanges.push(range)
    }
    for (const c of HIGHLIGHT_COLORS) {
      const name = `cl-hl-${c.key}`
      const ranges = buckets[c.key]
      if (ranges.length > 0) CSS.highlights.set(name, new Highlight(...ranges))
      else CSS.highlights.delete(name)
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
    if (!enabled || !container) return

    const onMouseUp = () => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return
      const text = sel.toString()
      if (text.trim().length === 0) return // collapsed → handled by click hit-test
      const range = sel.getRangeAt(0)
      const wrapper = wrapperOf(range.startContainer)
      const endWrapper = wrapperOf(range.endContainer)
      // Single-block only: same owning wrapper AND same inner block element.
      if (!wrapper || wrapper !== endWrapper || !container.contains(wrapper)) {
        closeToolbar()
        return
      }
      if (blockElementOf(range.startContainer, wrapper) !== blockElementOf(range.endContainer, wrapper)) {
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
      pendingRef.current = { kind: 'create', ...parsed, start, end, quote: text }
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
