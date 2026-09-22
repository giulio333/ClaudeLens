import { useLayoutEffect, useCallback } from 'react';
import { rangeFromOffsets } from './highlights';

/**
 * Find-in-transcript, the paint half — sibling of `useHighlightLayer`.
 *
 * It paints with the same instrument for the same reason: the CSS Custom
 * Highlight API colours text without touching the DOM, so it never fights
 * react-markdown's reconciliation, and a `MutationObserver` re-pins the ranges
 * when a windowed row remounts (a `Range` breaks when its text nodes are
 * replaced). The two layers coexist because neither clears the registry
 * wholesale — each deletes only the names it owns.
 *
 * **It walks the DOM, not the data, and that is what makes it simple.** The
 * scan (`find.ts`) works on the raw markdown to say WHICH turns match; this one
 * works on the rendered text to say WHERE inside a mounted row, and the two
 * never have to agree on an offset — which is the reconciliation a match-level
 * find would have been made of. Rows that are not mounted paint nothing, which
 * costs nothing: they are off screen.
 *
 * Two names, because the turn being read is not the same as the others: every
 * occurrence gets `cl-find`, and the ones inside the active turn get
 * `cl-find-active` — otherwise walking the hits would light the whole session
 * identically and the jump would say nothing about where it landed.
 */

const FIND_NAMES = ['cl-find', 'cl-find-active'];

/** True when the CSS Custom Highlight API is available (Chromium 105+). */
function supported(): boolean {
  return typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && !!CSS.highlights;
}

/** Every `[start, end)` of `needle` in `hay`, case-insensitively. */
function occurrences(hay: string, needle: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const h = hay.toLowerCase();
  let from = 0;
  for (;;) {
    const at = h.indexOf(needle, from);
    if (at === -1) return out;
    out.push([at, at + needle.length]);
    // Advance past the whole match: overlapping hits would paint the same run
    // twice and, for a single-character query, never terminate on their own.
    from = at + needle.length;
  }
}

export function useFindLayer({
  container,
  query,
  activeUuid,
  enabled = true,
}: {
  container: HTMLElement | null;
  /** Raw query as typed; blank means "paint nothing". */
  query: string;
  /** Message uuid of the turn the reader was sent to, so its occurrences can be
   *  told apart from the rest. A uuid, not a turn number, because that is what
   *  the DOM carries: `data-hl-block` is `<uuid>:<blockIndex>` and the rows
   *  themselves record no turn number. */
  activeUuid: string | null;
  /** False while an overlay covers the transcript. The workspace stays mounted
   *  at `display:none` then, so without this the observer would keep firing rAF
   *  repaints against a hidden subtree for as long as the overlay is up — the
   *  same reason `useHighlightLayer` takes the flag. */
  enabled?: boolean;
}) {
  const repaint = useCallback(() => {
    if (!supported()) return;
    const needle = enabled ? query.trim().toLowerCase() : '';
    if (!container || !needle) {
      for (const name of FIND_NAMES) CSS.highlights.delete(name);
      return;
    }
    const plain: Range[] = [];
    const active: Range[] = [];
    // `data-find-block` marks prose find reaches but highlights don't: a
    // thinking note, which has no index among the turn's text blocks.
    container.querySelectorAll('[data-hl-block], [data-find-block]').forEach(wrapper => {
      const textContent = wrapper.textContent ?? '';
      if (!textContent) return;
      // Which turn this block belongs to: the uuid half of its own key.
      const key =
        wrapper.getAttribute('data-hl-block') ?? wrapper.getAttribute('data-find-block') ?? '';
      const isActive = activeUuid !== null && key.slice(0, key.lastIndexOf(':')) === activeUuid;
      for (const [start, end] of occurrences(textContent, needle)) {
        const range = rangeFromOffsets(wrapper, start, end);
        if (range) (isActive ? active : plain).push(range);
      }
    });
    if (plain.length > 0) CSS.highlights.set('cl-find', new Highlight(...plain));
    else CSS.highlights.delete('cl-find');
    if (active.length > 0) CSS.highlights.set('cl-find-active', new Highlight(...active));
    else CSS.highlights.delete('cl-find-active');
  }, [container, query, activeUuid, enabled]);

  // Repaint on every input that can move a match: the query, the turn being
  // read, and the transcript DOM itself (a windowed row mounting, a density
  // toggle, markdown remounting).
  useLayoutEffect(() => {
    repaint();
    if (!enabled || !container || typeof MutationObserver === 'undefined') return;
    let raf = 0;
    const obs = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(repaint);
    });
    obs.observe(container, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
    };
  }, [enabled, container, repaint]);

  // Clear our own names when the layer goes away, so a stale paint can't linger
  // over another session. Only ours — `useHighlightLayer` owns the rest.
  useLayoutEffect(() => {
    return () => {
      if (!supported()) return;
      for (const name of FIND_NAMES) CSS.highlights.delete(name);
    };
  }, []);
}
