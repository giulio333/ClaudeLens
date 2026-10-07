// The side question (`/btw`) from the main process: what the renderer may send,
// and how one question is asked on the chat's live query — the answer mapped,
// "no answer" kept apart from an empty reply, the history and the cancelling
// signal handed through. A real side question is a model turn, which the suite
// does not spend: the query is a stand-in for the SDK's runtime `Query`.
import { describe, expect, it, vi } from 'vitest';
import {
  askOnQuery,
  parseSideQuestionRequest,
  type SideQuestionCapable,
} from '../electron/modules/side-question';

const SESSION = '0f3c9a21-4b7d-4e2a-9c11-5d6e7f8a9b0c';

function fakeQuery(answer: Awaited<ReturnType<SideQuestionCapable['askSideQuestion']>>) {
  return { askSideQuestion: vi.fn(async () => answer) } satisfies SideQuestionCapable;
}

describe('parseSideQuestionRequest', () => {
  it('accepts a transcript id, a question and settled exchanges, trimming the question', () => {
    const history = [{ question: 'a', response: 'b' }];
    expect(parseSideQuestionRequest(SESSION, '  what changed?  ', history)).toEqual({
      sessionId: SESSION,
      question: 'what changed?',
      history,
    });
  });

  it('refuses a session id that is not a transcript id', () => {
    expect(() => parseSideQuestionRequest('../etc/passwd', 'q', [])).toThrow('Not a session id');
    expect(() => parseSideQuestionRequest(undefined, 'q', [])).toThrow('Not a session id');
  });

  it('refuses an empty or oversized question', () => {
    expect(() => parseSideQuestionRequest(SESSION, '   ', [])).toThrow('Empty question');
    expect(() => parseSideQuestionRequest(SESSION, 'x'.repeat(4001), [])).toThrow('longer than');
  });

  it('refuses a history that is not a list of question/response strings', () => {
    expect(() => parseSideQuestionRequest(SESSION, 'q', 'nope')).toThrow('Malformed history');
    expect(() => parseSideQuestionRequest(SESSION, 'q', [{ question: 'a' }])).toThrow(
      'Malformed history'
    );
    expect(() => parseSideQuestionRequest(SESSION, 'q', [null])).toThrow('Malformed history');
  });

  it('keeps only the two fields of each exchange', () => {
    const parsed = parseSideQuestionRequest(SESSION, 'q', [
      { question: 'a', response: 'b', extra: 'dropped' },
    ]);
    expect(parsed.history).toEqual([{ question: 'a', response: 'b' }]);
  });
});

describe('askOnQuery', () => {
  const signal = new AbortController().signal;

  it('returns the answer the live query gave', async () => {
    const query = fakeQuery({ response: '**PAPAYA-42**' });
    await expect(askOnQuery(query, 'Which codeword?', [], signal)).resolves.toEqual({
      response: '**PAPAYA-42**',
      synthetic: false,
    });
  });

  it('reads no answer from the CLI as a synthetic one, never as an empty reply', async () => {
    await expect(askOnQuery(fakeQuery(null), 'q', [], signal)).resolves.toEqual({
      response: null,
      synthetic: true,
    });
  });

  it('keeps the CLI marking a fallback reply synthetic', async () => {
    const query = fakeQuery({ response: '(No answer available.)', synthetic: true });
    await expect(askOnQuery(query, 'q', [], signal)).resolves.toEqual({
      response: '(No answer available.)',
      synthetic: true,
    });
  });

  it('hands the settled exchanges and the signal through, and no history when there is none', async () => {
    const query = fakeQuery({ response: 'ok' });
    const history = [{ question: 'first?', response: 'first.' }];
    await askOnQuery(query, 'first?', [], signal);
    await askOnQuery(query, 'and then?', history, signal);
    expect(query.askSideQuestion).toHaveBeenNthCalledWith(1, 'first?', { signal });
    expect(query.askSideQuestion).toHaveBeenNthCalledWith(2, 'and then?', { history, signal });
  });

  it('passes the CLI error through', async () => {
    const query: SideQuestionCapable = {
      askSideQuestion: async () => {
        throw new Error('Side question cancelled');
      },
    };
    await expect(askOnQuery(query, 'q', [], signal)).rejects.toThrow('Side question cancelled');
  });

  it('says so when there is no live query to ask', async () => {
    await expect(askOnQuery(null, 'q', [], signal)).rejects.toThrow(
      'The chat session is not running'
    );
  });
});
