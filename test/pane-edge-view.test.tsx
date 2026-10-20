// @vitest-environment jsdom
//
// The stage's edge as drawn: what a tab remembers decides it, the sweep for a
// turn that ended plays once and is gone when its animation ends, and a stage
// mounted after the turn ended never sweeps for it. The rules are
// `pane-edge.test.ts`; this is the span and its one-shot.
import { StrictMode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { PaneEdge } from '../src/components/project/terminal/PaneEdge';
import type { AttentionState } from '../src/components/project/terminal/tab-attention';
import { TabAttentionContext } from '../src/components/project/terminal/use-tab-attention';

afterEach(cleanup);

const working: AttentionState = {
  seq: 3,
  byId: { t1: { tone: 'busy', from: 'idle', seq: 3, unseen: false } },
};
const settled: AttentionState = {
  seq: 4,
  byId: { t1: { tone: 'idle', from: 'busy', seq: 4, unseen: false } },
};

function tree(state: AttentionState, key = 0) {
  return (
    <StrictMode>
      <TabAttentionContext.Provider value={state}>
        <PaneEdge key={key} instanceId="t1" />
      </TabAttentionContext.Provider>
    </StrictMode>
  );
}

const edge = (container: HTMLElement) => container.querySelector<HTMLElement>('.cl-pane-edge');

// jsdom has no AnimationEvent, so React listens for the prefixed name its probe
// of the style object picks; the event carries its animation's name by hand.
const style = document.createElement('div').style as unknown as Record<string, unknown>;
const END =
  'AnimationEvent' in window || !('WebkitAnimation' in style)
    ? 'animationend'
    : 'webkitAnimationEnd';
function animationEnd(el: Element, animationName: string) {
  const event = new Event(END, { bubbles: true });
  Object.defineProperty(event, 'animationName', { value: animationName });
  act(() => {
    el.dispatchEvent(event);
  });
}

it('runs while Claude works, sweeps once when the turn ends, then is gone', () => {
  const { container, rerender } = render(tree(working));
  expect(edge(container)?.dataset.signal).toBe('working');
  expect(edge(container)?.getAttribute('aria-hidden')).toBe('true');

  rerender(tree(settled));
  expect(edge(container)?.dataset.signal).toBe('settled');
  // The line's sweep ending is not enough: the ring fading is what clears it.
  animationEnd(edge(container)!, 'cl-pane-edge-sweep');
  expect(edge(container)?.dataset.signal).toBe('settled');
  animationEnd(edge(container)!, 'cl-pane-edge-settle');
  expect(edge(container)).toBeNull();

  // Shown again later (a switch of tab, the same state): nothing replays.
  rerender(tree({ ...settled }));
  expect(edge(container)).toBeNull();
});

it('never sweeps for a turn that ended before the stage was mounted', () => {
  const { container } = render(tree(settled, 1));
  expect(edge(container)).toBeNull();
});

it('rings while the session waits, and draws nothing for one it does not know', () => {
  const { container, rerender } = render(
    tree({ seq: 2, byId: { t1: { tone: 'waiting', from: 'busy', seq: 2, unseen: false } } })
  );
  expect(edge(container)?.dataset.signal).toBe('waiting');
  rerender(tree({ seq: 2, byId: {} }));
  expect(edge(container)).toBeNull();
});
