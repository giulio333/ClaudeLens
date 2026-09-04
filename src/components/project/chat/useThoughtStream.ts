import { useEffect, useRef, useState } from 'react';
import { ChatMessage } from '../../../hooks/useIPC';
import { Thought, ThoughtQueue, advance, collectThoughts, emptyQueue, enqueue } from './thoughts';

/**
 * Hook: one thought on screen at a time, paced for reading.
 *
 * The source is whatever `messages` the caller already has — the Lens's
 * watcher-driven disk read, or the live chat's stream transcript — so this adds
 * no IPC and no watcher of its own. New described calls are found by diffing
 * `tool_use` ids against the ones already narrated (`collectThoughts`), which
 * is what makes a re-read of the same transcript cost nothing but the walk.
 *
 * **The queue lives in a ref and the clock is what renders.** The state React
 * holds is only the sentence currently on the line, and the single place it is
 * written is the timer callback (`pump`). That is not a workaround for a lint
 * rule but the honest shape of the thing: a paced line is an external system
 * with a clock, and this hook drives it and subscribes to it. Deriving the line
 * from `messages` with a `setState` in the effect body would also re-render on
 * every watcher burst of a session that had nothing to say — and a transcript
 * append fires those in bursts.
 *
 * Two things it deliberately will not do:
 *
 *  - **Replay history.** The cutoff is the moment this hook started observing,
 *    not the start of the session: opening a finished session must not run its
 *    hundreds of past calls past you as if they were happening.
 *  - **Build a backlog while hidden.** With `enabled` false the diff still
 *    runs, so every call that happened in the meantime is marked narrated and
 *    turning the line back on starts from the present instead of unspooling
 *    what was missed.
 */
export function useThoughtStream(messages: ChatMessage[], enabled: boolean): Thought | null {
  const [line, setLine] = useState<Thought | null>(null);
  // The queue, what has already been narrated, and the cutoff that keeps the
  // transcript's history off the line. All refs: none of them is something a
  // render should read, and the cutoff is `Date.now()`, which a render may not
  // call at all.
  const queueRef = useRef<ThoughtQueue>(emptyQueue());
  const seenRef = useRef<Set<string>>(new Set());
  const sinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (sinceRef.current === null) sinceRef.current = Date.now();
    // Runs even when disabled: that is what stops a hidden line from becoming
    // a backlog (see above).
    const fresh = collectThoughts(messages, sinceRef.current, seenRef.current);
    queueRef.current = enabled ? enqueue(queueRef.current, fresh, Date.now()) : emptyQueue();

    // The clock. Each firing publishes the queue's head and arms the next for
    // that sentence's own dwell. `until` is absolute, so re-running this effect
    // on the next transcript read re-arms the SAME deadline instead of granting
    // the sentence on screen a fresh one.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pump = () => {
      timer = null;
      const showing = queueRef.current.showing;
      setLine(showing?.thought ?? null);
      if (!showing) return;
      timer = setTimeout(
        () => {
          queueRef.current = advance(queueRef.current, Date.now());
          pump();
        },
        Math.max(0, showing.until - Date.now())
      );
    };
    timer = setTimeout(pump, 0);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [messages, enabled]);

  return line;
}
