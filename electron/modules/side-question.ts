// A side question about the SDK chat's session — Claude Code's `/btw`, asked on
// the chat's own live `query()`.
//
// The SDK's `Query.askSideQuestion()` sends the same `side_question` control
// request the CLI's `/btw` does: the model answers from the session's context,
// runs no tool, and nothing is appended to the conversation. It is on the
// runtime `Query` but not in the published typings (0.3.280), hence the narrow
// interface below rather than a cast to `any`.
//
// Only on the chat's own process, by design. A second process that resumes the
// session cannot read its prompt cache: measured against an interactive
// `claude`, it read 0 tokens from cache and re-wrote the whole context (30k read
// and the session-specific part re-written with the `claude_code` preset). On
// the live query the question rides the same process, so it is a cache read —
// and it works while a turn is running, as `/btw` does in the terminal.
import type { SideQuestionAnswer, SideQuestionTurn } from '../shared/chat-types';

/** The part of the runtime `Query` the published typings leave out. */
export interface SideQuestionCapable {
  askSideQuestion(
    question: string,
    options?: { history?: SideQuestionTurn[]; signal?: AbortSignal }
  ): Promise<{ response: string; synthetic?: boolean } | null>;
}

const MAX_QUESTION = 4000;
const MAX_HISTORY = 20;
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export interface SideQuestionRequest {
  sessionId: string;
  question: string;
  history: SideQuestionTurn[];
}

/** The renderer's arguments, checked: a session id that is a transcript id, a
 *  question that is text, a history of settled exchanges. Throws what was wrong. */
export function parseSideQuestionRequest(
  sessionId: unknown,
  question: unknown,
  history: unknown
): SideQuestionRequest {
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
    throw new Error('Not a session id');
  }
  if (typeof question !== 'string' || !question.trim()) throw new Error('Empty question');
  if (question.length > MAX_QUESTION) {
    throw new Error(`Question longer than ${MAX_QUESTION} characters`);
  }
  if (!Array.isArray(history) || history.length > MAX_HISTORY) {
    throw new Error('Malformed history');
  }
  const turns = history.map(turn => {
    const t = turn as Partial<SideQuestionTurn> | null;
    if (typeof t?.question !== 'string' || typeof t.response !== 'string') {
      throw new Error('Malformed history');
    }
    return { question: t.question, response: t.response };
  });
  return { sessionId, question: question.trim(), history: turns };
}

/** Ask one side question on a live query. `null` from the CLI is no answer —
 *  reported as synthetic, never as an empty reply. The signal cancels the
 *  question only; the query, and the session, stay up. */
export async function askOnQuery(
  query: SideQuestionCapable | null,
  question: string,
  history: SideQuestionTurn[],
  signal: AbortSignal
): Promise<SideQuestionAnswer> {
  if (!query) throw new Error('The chat session is not running');
  const answer = await query.askSideQuestion(question, {
    ...(history.length > 0 && { history }),
    signal,
  });
  return answer === null
    ? { response: null, synthetic: true }
    : { response: answer.response, synthetic: answer.synthetic ?? false };
}
