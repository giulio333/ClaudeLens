// @vitest-environment jsdom
//
// The paced half of the narration: `useThoughtStream` turning a growing
// transcript into one sentence at a time. Three of these claims cannot be made
// against the pure queue, because they are about what the hook remembers
// between reads:
//
//   1. only calls that arrive AFTER the view opened are narrated (a re-read of
//      a finished session must not run its history past you);
//   2. a sentence holds the line for its own dwell and the line then EMPTIES
//      rather than keeping a stale one;
//   3. with narration off, arriving calls are marked narrated anyway — turning
//      it back on starts from the present instead of unspooling what was
//      missed.

import { createElement } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

import { useThoughtStream } from '../src/components/project/chat/useThoughtStream';
import { dwellMs } from '../src/components/project/chat/thoughts';
import type { ChatContentBlock, ChatMessage } from '../src/hooks/useIPC';

const T0 = Date.parse('2026-09-02T10:00:00.000Z');

function described(id: string, text: string, atMs: number): ChatMessage {
  const block: ChatContentBlock = {
    type: 'tool_use',
    id,
    name: 'Bash',
    input: { command: 'true', description: text },
  };
  return {
    uuid: `a-${id}`,
    role: 'assistant',
    timestamp: new Date(atMs).toISOString(),
    content: [block],
  };
}

function Harness({ messages, enabled }: { messages: ChatMessage[]; enabled: boolean }) {
  const thought = useThoughtStream(messages, enabled);
  return createElement('output', { 'data-testid': 'line' }, thought ? thought.text : '');
}

function line(): string {
  return screen.getByTestId('line').textContent ?? '';
}

function mount(messages: ChatMessage[] = [], enabled = true) {
  return render(createElement(Harness, { messages, enabled }));
}

/** Push a new transcript at the hook, `afterMs` after mount. */
function feed(
  view: ReturnType<typeof mount>,
  messages: ChatMessage[],
  enabled = true,
  afterMs = 500
) {
  act(() => {
    vi.advanceTimersByTime(afterMs);
  });
  act(() => {
    view.rerender(createElement(Harness, { messages, enabled }));
  });
  // The line is published by the clock, not by the read — let it fire.
  act(() => {
    vi.advanceTimersByTime(1);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useThoughtStream', () => {
  it('narrates a described call that arrives after the view opened', () => {
    const view = mount();
    feed(view, [described('t1', 'Show recent commits', T0 + 400)]);
    expect(line()).toBe('Show recent commits');
  });

  it('says nothing about a transcript that was already there when it opened', () => {
    // The Lens re-reads the whole file on every watcher burst; without a cutoff
    // every read would be a fresh performance of the same session.
    mount([
      described('old1', 'Read the monitor module', T0 - 120_000),
      described('old2', 'Run the suite', T0 - 60_000),
    ]);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(line()).toBe('');
  });

  it('shows one sentence at a time, holding the first while the second waits', () => {
    const view = mount();
    feed(view, [
      described('t1', 'Show recent commits', T0 + 400),
      described('t2', 'Read the monitor module', T0 + 450),
    ]);
    expect(line()).toBe('Show recent commits');
  });

  it('hands the line to the next sentence once the first has had its time', () => {
    const view = mount();
    feed(view, [
      described('t1', 'Show recent commits', T0 + 400),
      described('t2', 'Read the monitor module', T0 + 450),
    ]);
    act(() => {
      vi.advanceTimersByTime(dwellMs('Show recent commits') + 10);
    });
    expect(line()).toBe('Read the monitor module');
  });

  it('empties the line when the session moves on to work that has no note', () => {
    const view = mount();
    feed(view, [described('t1', 'Show recent commits', T0 + 400)]);
    act(() => {
      vi.advanceTimersByTime(dwellMs('Show recent commits') + 10);
    });
    expect(line()).toBe('');
  });

  it('drops the middle of a burst rather than falling behind the session', () => {
    const view = mount();
    feed(view, [
      described('t1', 'First call', T0 + 400),
      described('t2', 'Second call', T0 + 420),
      described('t3', 'Third call', T0 + 440),
      described('t4', 'Fourth call', T0 + 460),
    ]);
    expect(line()).toBe('First call');
    act(() => {
      vi.advanceTimersByTime(dwellMs('First call') + 10);
    });
    expect(line()).toBe('Third call');
  });

  it('narrates nothing while narration is off', () => {
    const view = mount([], false);
    feed(view, [described('t1', 'Show recent commits', T0 + 400)], false);
    expect(line()).toBe('');
  });

  it('starts from the present when narration is turned back on', () => {
    const view = mount([], false);
    const missed = [described('t1', 'Missed while hidden', T0 + 400)];
    feed(view, missed, false);
    // Turned on, same transcript: what happened while hidden stays unsaid.
    act(() => {
      view.rerender(createElement(Harness, { messages: missed, enabled: true }));
    });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(line()).toBe('');
    feed(view, [...missed, described('t2', 'Happening now', T0 + 1500)], true);
    expect(line()).toBe('Happening now');
  });

  it('does not grant the sentence on screen a fresh dwell on every transcript read', () => {
    // A live session appends in bursts, so this effect re-runs constantly. The
    // deadline is absolute for exactly that reason: re-arming it must re-arm
    // the same moment, or a busy session would freeze one sentence on the line.
    const view = mount();
    const msgs = [described('t1', 'Show recent commits', T0 + 400)];
    feed(view, msgs);
    const dwell = dwellMs('Show recent commits');
    // A watcher burst partway through the dwell: new array, nothing new in it.
    feed(view, [...msgs], true, dwell - 300);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(line()).toBe('');
  });

  it('leaves no timer behind when the view goes away', () => {
    const view = mount();
    feed(view, [described('t1', 'Show recent commits', T0 + 400)]);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
