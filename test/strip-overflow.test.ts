// When the open sessions no longer fit the top bar, the tabs scroll: what lies
// past each edge, where to scroll so a tab shows whole (clear of the fade drawn
// over the edge), and which of the hidden tabs needs the user — the one thing
// a scrolled-away tab must not take out of sight with it.
import { describe, expect, it } from 'vitest';
import {
  EDGE_FADE_PX,
  hiddenTabs,
  revealScroll,
} from '../src/components/project/terminal/strip-overflow';

// A 300px window over a 700px row of 100px tabs: t0..t6 at 0, 100, …, 600.
const row = Array.from({ length: 7 }, (_, n) => ({ id: `t${n}`, left: n * 100, width: 100 }));

describe('hiddenTabs', () => {
  it('says nothing is hidden when the row fits', () => {
    const fit = row.slice(0, 3);
    expect(hiddenTabs({ scrollLeft: 0, width: 300, total: 300 }, fit)).toEqual({
      left: [],
      right: [],
    });
  });

  it('lists the tabs whose mark is past an edge or under its fade', () => {
    expect(hiddenTabs({ scrollLeft: 0, width: 300, total: 700 }, row)).toEqual({
      left: [],
      right: ['t3', 't4', 't5', 't6'],
    });
    // Scrolled to 250: t0 and t1 are gone left, t2's dot is under the left fade.
    const mid = hiddenTabs({ scrollLeft: 250, width: 300, total: 700 }, row);
    expect(mid.left).toEqual(['t0', 't1', 't2']);
    expect(mid.right).toEqual(['t5', 't6']);
  });
});

describe('revealScroll', () => {
  it('leaves the row alone when the tab already shows whole', () => {
    expect(revealScroll({ scrollLeft: 0, width: 300, total: 700 }, row[1])).toBeNull();
  });

  it('scrolls just enough to clear the fade on the side the tab is on', () => {
    expect(revealScroll({ scrollLeft: 0, width: 300, total: 700 }, row[5])).toBe(
      600 - 300 + EDGE_FADE_PX
    );
    expect(revealScroll({ scrollLeft: 400, width: 300, total: 700 }, row[1])).toBe(
      100 - EDGE_FADE_PX
    );
  });

  it('never scrolls before the start or past the end', () => {
    expect(revealScroll({ scrollLeft: 300, width: 300, total: 700 }, row[0])).toBe(0);
    expect(revealScroll({ scrollLeft: 0, width: 300, total: 700 }, row[6])).toBe(400);
  });

  it('clears a tab of the fade on the side with more row, and only there', () => {
    // t2 ends where the window does, under the fade of the row still to come.
    expect(revealScroll({ scrollLeft: 0, width: 300, total: 700 }, row[2])).toBe(28);
    // At the very end of the row there is no fade to clear.
    expect(revealScroll({ scrollLeft: 400, width: 300, total: 700 }, row[6])).toBeNull();
  });
});
