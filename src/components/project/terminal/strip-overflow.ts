// When the open sessions no longer fit the top bar, the row of tabs scrolls.
// The geometry is measured in the row's own coordinates (a tab's `left` from
// the start of the row, not of the screen), so these stay pure.

import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/** The width each edge fades over while there is more row past it. A tab is
 *  shown whole only clear of it. */
export const EDGE_FADE_PX = 28;

interface Viewport {
  scrollLeft: number;
  width: number;
  /** The whole row's width (`scrollWidth`). */
  total: number;
}

interface TabBox {
  id: string;
  left: number;
  width: number;
}

/** Where a tab says what state it is in: its dot, at its start. A tab counts
 *  as out of sight when that is, under a fade or past an edge. */
const MARK_PX = 24;

/** The window over the row less the fades, which are drawn only on a side
 *  with more row past it. */
function clearRegion(view: Viewport): { from: number; to: number } {
  const end = view.scrollLeft + view.width;
  return {
    from: view.scrollLeft + (view.scrollLeft > 0 ? EDGE_FADE_PX : 0),
    to: end - (end < view.total ? EDGE_FADE_PX : 0),
  };
}

/** The tabs out of sight past each edge. */
export function hiddenTabs(
  view: Viewport,
  tabs: readonly TabBox[]
): { left: string[]; right: string[] } {
  const left: string[] = [];
  const right: string[] = [];
  if (view.total <= view.width) return { left, right };
  const { from, to } = clearRegion(view);
  for (const t of tabs) {
    if (t.left < from) left.push(t.id);
    else if (t.left + MARK_PX > to) right.push(t.id);
  }
  return { left, right };
}

/** Where to scroll so the tab shows whole and clear of the fades, or null when
 *  it already does. */
export function revealScroll(view: Viewport, tab: TabBox): number | null {
  const { from, to } = clearRegion(view);
  if (tab.left < from) return Math.max(0, tab.left - EDGE_FADE_PX);
  if (tab.left + tab.width > to) {
    return Math.min(view.total - view.width, tab.left + tab.width - view.width + EDGE_FADE_PX);
  }
  return null;
}

function measure(row: HTMLElement): { view: Viewport; tabs: TabBox[] } {
  const origin = row.getBoundingClientRect();
  const tabs = [...row.querySelectorAll<HTMLElement>('[data-tab-id]')].map(el => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.tabId!, left: r.left - origin.left + row.scrollLeft, width: r.width };
  });
  return {
    view: { scrollLeft: row.scrollLeft, width: origin.width, total: row.scrollWidth },
    tabs,
  };
}

export interface StripOverflow {
  /** The tabs out of sight past each edge (`hiddenTabs`). */
  left: string[];
  right: string[];
  /** There is more row past that edge: it fades. */
  moreLeft: boolean;
  moreRight: boolean;
}

const FITS: StripOverflow = { left: [], right: [], moreLeft: false, moreRight: false };

function sameOverflow(a: StripOverflow, b: StripOverflow): boolean {
  return (
    a.moreLeft === b.moreLeft &&
    a.moreRight === b.moreRight &&
    a.left.join() === b.left.join() &&
    a.right.join() === b.right.join()
  );
}

/**
 * The scrolling row of tabs: what is out of sight on each side, kept current
 * on scroll and resize; the tab on screen brought into view when it changes or
 * the row does (`rowKey`) — never on any other render, which would snap the
 * row back while the user scrolls it; a vertical wheel turned into a
 * horizontal scroll, since the bar has nothing to scroll the other way; and
 * `reveal`, which brings a tab whole into view.
 */
export function useStripOverflow(
  rowRef: RefObject<HTMLElement | null>,
  currentId: string | null,
  rowKey: string
) {
  const [overflow, setOverflow] = useState(FITS);

  const update = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const { view, tabs } = measure(row);
    const next: StripOverflow = {
      ...hiddenTabs(view, tabs),
      moreLeft: view.scrollLeft > 0,
      moreRight: view.scrollLeft + view.width < view.total - 1,
    };
    setOverflow(prev => (sameOverflow(prev, next) ? prev : next));
  }, [rowRef]);

  const reveal = useCallback(
    (id: string, behavior: ScrollBehavior = 'smooth') => {
      const row = rowRef.current;
      if (!row) return;
      const { view, tabs } = measure(row);
      const tab = tabs.find(t => t.id === id);
      const to = tab ? revealScroll(view, tab) : null;
      if (to !== null) row.scrollTo?.({ left: to, behavior });
    },
    [rowRef]
  );

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return;
      row.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    row.addEventListener('scroll', update, { passive: true });
    row.addEventListener('wheel', onWheel, { passive: false });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resize?.observe(row);
    return () => {
      row.removeEventListener('scroll', update);
      row.removeEventListener('wheel', onWheel);
      resize?.disconnect();
    };
  }, [rowRef, update]);

  useLayoutEffect(() => {
    if (currentId) reveal(currentId, 'auto');
    update();
  }, [currentId, rowKey, reveal, update]);

  return { overflow, reveal };
}
