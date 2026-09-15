import { findMatchingTurns, stepToHit } from '../src/components/project/chat/find';
import { buildProcessedMessages } from '../src/components/project/chat/utils';
import { ChatMessage, ChatContentBlock } from '../src/types';

let uuidCounter = 0;
function msg(role: 'user' | 'assistant', content: ChatContentBlock[]): ChatMessage {
  return {
    uuid: `uuid-${uuidCounter++}`,
    role,
    timestamp: '2026-05-30T00:00:00.000Z',
    content,
  };
}
const text = (t: string): ChatContentBlock => ({ type: 'text', text: t });
const thinking = (t: string): ChatContentBlock => ({ type: 'thinking', thinking: t });
const toolUse = (
  id: string,
  name: string,
  input: Record<string, unknown> = {}
): ChatContentBlock => ({ type: 'tool_use', id, name, input });
const toolResult = (toolUseId: string, content: string): ChatContentBlock => ({
  type: 'tool_result',
  toolUseId,
  content,
  isError: false,
});

beforeEach(() => {
  uuidCounter = 0;
});

describe('findMatchingTurns', () => {
  it('reports 1-based turn numbers, in reading order', () => {
    const processed = buildProcessedMessages([
      msg('user', [text('where is the parser')]),
      msg('assistant', [text('nothing here')]),
      msg('assistant', [text('the PARSER lives in utils')]),
    ]);
    expect(findMatchingTurns(processed, 'parser', 'all')).toEqual([1, 3]);
  });

  it('matches case-insensitively and on substrings', () => {
    const processed = buildProcessedMessages([msg('assistant', [text('Unmistakable')])]);
    expect(findMatchingTurns(processed, 'MISTAK', 'all')).toEqual([1]);
  });

  it('matches nothing on a blank query — "no query" is not "every turn"', () => {
    const processed = buildProcessedMessages([
      msg('user', [text('a')]),
      msg('assistant', [text('b')]),
    ]);
    expect(findMatchingTurns(processed, '', 'all')).toEqual([]);
    expect(findMatchingTurns(processed, '   ', 'all')).toEqual([]);
  });

  it('reads thinking in FULL density and ignores it in MIN', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [thinking('the needle is in here'), text('an answer')]),
    ]);
    expect(findMatchingTurns(processed, 'needle', 'all')).toEqual([1]);
    // MIN hides thinking, so a hit there would land on a turn showing no match.
    expect(findMatchingTurns(processed, 'needle', 'minimal')).toEqual([]);
  });

  it('does not search tool calls or their output — the paint layer cannot light them', () => {
    const processed = buildProcessedMessages([
      msg('assistant', [text('running it'), toolUse('t1', 'Bash', { command: 'grep needle' })]),
      msg('user', [toolResult('t1', 'needle found at line 4')]),
    ]);
    expect(findMatchingTurns(processed, 'needle', 'all')).toEqual([]);
  });
});

describe('stepToHit', () => {
  const hits = [2, 5, 9];

  it('enters the list from either end when nothing is current', () => {
    expect(stepToHit(hits, null, 1)).toBe(2);
    expect(stepToHit(hits, null, -1)).toBe(9);
  });

  it('steps forward and back from a turn that is itself a hit', () => {
    expect(stepToHit(hits, 5, 1)).toBe(9);
    expect(stepToHit(hits, 5, -1)).toBe(2);
  });

  it('steps from a turn that is not a hit — "next" means next after where I am reading', () => {
    expect(stepToHit(hits, 6, 1)).toBe(9);
    expect(stepToHit(hits, 6, -1)).toBe(5);
  });

  it('wraps at both ends', () => {
    expect(stepToHit(hits, 9, 1)).toBe(2);
    expect(stepToHit(hits, 2, -1)).toBe(9);
  });

  it('has nowhere to go with no hits', () => {
    expect(stepToHit([], null, 1)).toBeNull();
    expect(stepToHit([], 4, -1)).toBeNull();
  });
});
