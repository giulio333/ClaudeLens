// The narration model: which tool calls have something to say, how long each
// sentence holds the line, and what happens when they arrive faster than
// anyone reads. Every claim here is about the pure half (`chat/thoughts.ts`);
// the paced hook is driven in `thought-stream.test.tsx`.

import { describe, it, expect } from 'vitest';
import {
  DWELL_CEIL_MS,
  DWELL_FLOOR_MS,
  PENDING_MAX,
  THOUGHT_MAX,
  advance,
  collectThoughts,
  dwellMs,
  emptyQueue,
  enqueue,
  pendingToolThought,
  thoughtOf,
  type Thought,
} from '../src/components/project/chat/thoughts';
import type { ChatContentBlock, ChatMessage } from '../src/hooks/useIPC';

const T0 = Date.parse('2026-09-02T10:00:00.000Z');

function assistant(atMs: number, ...content: ChatContentBlock[]): ChatMessage {
  return {
    uuid: `a-${atMs}-${content.length}`,
    role: 'assistant',
    timestamp: new Date(atMs).toISOString(),
    content,
  };
}

function call(id: string, name: string, input: Record<string, unknown>): ChatContentBlock {
  return { type: 'tool_use', id, name, input };
}

function result(toolUseId: string): ChatContentBlock {
  return { type: 'tool_result', toolUseId, content: 'ok', isError: false };
}

function userWith(...content: ChatContentBlock[]): ChatMessage {
  return {
    uuid: `u-${content.length}`,
    role: 'user',
    timestamp: new Date(T0).toISOString(),
    content,
  };
}

function thought(id: string, text: string): Thought {
  return { id, tool: 'Bash', text };
}

describe('thoughtOf', () => {
  it('reads the description a call carries', () => {
    expect(thoughtOf({ command: 'git log -3', description: 'Show recent commits' })).toBe(
      'Show recent commits'
    );
  });

  it('says nothing for a call with no description, rather than describing the input', () => {
    // The opposite priority to `toolArg`, deliberately: a command line is not
    // a sentence about intent, and inventing one is the failure mode this
    // whole surface has to avoid.
    expect(thoughtOf({ command: 'npm test' })).toBe('');
    expect(thoughtOf({ file_path: '/Users/alice/src/main.ts' })).toBe('');
    expect(thoughtOf(undefined)).toBe('');
  });

  it('treats a blank or non-string description as absent', () => {
    expect(thoughtOf({ description: '   ' })).toBe('');
    expect(thoughtOf({ description: 42 })).toBe('');
  });

  it('flattens a multi-line description to one line', () => {
    expect(thoughtOf({ description: 'Read the\n  monitor   module' })).toBe(
      'Read the monitor module'
    );
  });

  it('trims an over-long description and marks the cut', () => {
    const long = 'x'.repeat(THOUGHT_MAX + 30);
    const out = thoughtOf({ description: long });
    expect(out).toHaveLength(THOUGHT_MAX);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('dwellMs', () => {
  it('holds a longer sentence longer', () => {
    expect(dwellMs('x'.repeat(40))).toBeGreaterThan(dwellMs('x'.repeat(10)));
  });

  it('never drops below the floor, however short the sentence', () => {
    expect(dwellMs('Read')).toBe(DWELL_FLOOR_MS);
  });

  it('never exceeds the ceiling, however long the sentence', () => {
    expect(dwellMs('x'.repeat(500))).toBe(DWELL_CEIL_MS);
  });
});

describe('collectThoughts', () => {
  it('returns the described calls that arrived after the cutoff', () => {
    const seen = new Set<string>();
    const fresh = collectThoughts(
      [assistant(T0 + 1000, call('t1', 'Bash', { description: 'Run the suite' }))],
      T0,
      seen
    );
    expect(fresh).toEqual([{ id: 't1', tool: 'Bash', text: 'Run the suite' }]);
  });

  it('ignores calls that predate the cutoff, so opening a session replays nothing', () => {
    const seen = new Set<string>();
    const fresh = collectThoughts(
      [assistant(T0 - 60_000, call('old', 'Bash', { description: 'Something from before' }))],
      T0,
      seen
    );
    expect(fresh).toEqual([]);
  });

  it('never returns the same call twice across reads of a growing transcript', () => {
    const seen = new Set<string>();
    const msgs = [assistant(T0 + 1000, call('t1', 'Bash', { description: 'Run the suite' }))];
    collectThoughts(msgs, T0, seen);
    const second = collectThoughts(
      [...msgs, assistant(T0 + 2000, call('t2', 'Bash', { description: 'Read the log' }))],
      T0,
      seen
    );
    expect(second.map(t => t.id)).toEqual(['t2']);
  });

  it('marks an undescribed call seen too, so it is examined once and never again', () => {
    const seen = new Set<string>();
    collectThoughts(
      [assistant(T0 + 1000, call('quiet', 'Read', { file_path: '/a.ts' }))],
      T0,
      seen
    );
    expect(seen.has('quiet')).toBe(true);
  });

  it('skips a call whose message carries no usable timestamp', () => {
    const seen = new Set<string>();
    const broken: ChatMessage = {
      uuid: 'x',
      role: 'assistant',
      timestamp: 'not a date',
      content: [call('t1', 'Bash', { description: 'Undatable' })],
    };
    expect(collectThoughts([broken], T0, seen)).toEqual([]);
  });

  it('reads only assistant messages', () => {
    const seen = new Set<string>();
    const fromUser: ChatMessage = {
      uuid: 'u1',
      role: 'user',
      timestamp: new Date(T0 + 1000).toISOString(),
      content: [call('t1', 'Bash', { description: 'Not the model speaking' })],
    };
    expect(collectThoughts([fromUser], T0, seen)).toEqual([]);
  });
});

describe('enqueue', () => {
  it('puts the first thought on the line immediately', () => {
    const q = enqueue(emptyQueue(), [thought('t1', 'Run the suite')], T0);
    expect(q.showing?.thought.id).toBe('t1');
    expect(q.pending).toEqual([]);
  });

  it('sets the replacement time from the sentence itself', () => {
    const q = enqueue(emptyQueue(), [thought('t1', 'Run the suite')], T0);
    expect(q.showing?.until).toBe(T0 + dwellMs('Run the suite'));
  });

  it('leaves the current thought alone and queues the next', () => {
    const first = enqueue(emptyQueue(), [thought('t1', 'First')], T0);
    const q = enqueue(first, [thought('t2', 'Second')], T0 + 100);
    expect(q.showing?.thought.id).toBe('t1');
    expect(q.pending.map(t => t.id)).toEqual(['t2']);
  });

  it('keeps the newest and drops the oldest waiting when calls outpace reading', () => {
    // A queue drained in order lags the session by the sum of its own dwells,
    // so on a burst the middle is what goes.
    const first = enqueue(emptyQueue(), [thought('t1', 'First')], T0);
    const q = enqueue(
      first,
      [thought('t2', 'Second'), thought('t3', 'Third'), thought('t4', 'Fourth')],
      T0 + 100
    );
    expect(q.pending).toHaveLength(PENDING_MAX);
    expect(q.pending.map(t => t.id)).toEqual(['t3', 't4']);
  });

  it('is a no-op — same object — when nothing arrived', () => {
    const before = enqueue(emptyQueue(), [thought('t1', 'First')], T0);
    expect(enqueue(before, [], T0 + 100)).toBe(before);
  });
});

describe('advance', () => {
  it('holds the thought until its dwell has elapsed', () => {
    const q = enqueue(emptyQueue(), [thought('t1', 'First')], T0);
    expect(advance(q, T0 + 10)).toBe(q);
  });

  it('promotes the next waiting thought once the dwell is up', () => {
    const q = enqueue(
      enqueue(emptyQueue(), [thought('t1', 'First')], T0),
      [thought('t2', 'Second')],
      T0 + 10
    );
    const next = advance(q, (q.showing?.until ?? 0) + 1);
    expect(next.showing?.thought.id).toBe('t2');
    expect(next.pending).toEqual([]);
  });

  it('empties the line instead of holding a sentence the session has moved past', () => {
    const q = enqueue(emptyQueue(), [thought('t1', 'First')], T0);
    expect(advance(q, (q.showing?.until ?? 0) + 1).showing).toBeNull();
  });
});

describe('pendingToolThought', () => {
  it('names the newest call of that tool still awaiting a result', () => {
    const messages = [
      assistant(T0, call('t1', 'Bash', { description: 'Older call' })),
      userWith(result('t1')),
      assistant(T0 + 1000, call('t2', 'Bash', { description: 'The running one' })),
    ];
    expect(pendingToolThought(messages, 'Bash')).toBe('The running one');
  });

  it('says nothing once every call of that tool has come back', () => {
    const messages = [
      assistant(T0, call('t1', 'Bash', { description: 'Done already' })),
      userWith(result('t1')),
    ];
    expect(pendingToolThought(messages, 'Bash')).toBe('');
  });

  it('does not answer with another tool’s sentence', () => {
    const messages = [assistant(T0, call('t1', 'Bash', { description: 'A shell call' }))];
    expect(pendingToolThought(messages, 'Edit')).toBe('');
  });

  it('says nothing for a running call that carries no description', () => {
    const messages = [assistant(T0, call('t1', 'Read', { file_path: '/a.ts' }))];
    expect(pendingToolThought(messages, 'Read')).toBe('');
  });
});
