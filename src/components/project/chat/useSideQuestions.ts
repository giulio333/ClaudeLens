import { useCallback, useEffect, useRef, useState } from 'react';
import type { SideQuestionTurn } from '../../../types';

export type SideQuestionStatus = 'pending' | 'answered' | 'empty' | 'failed' | 'stopped';

export interface SideExchange {
  id: string;
  question: string;
  status: SideQuestionStatus;
  response?: string;
  error?: string;
}

const NO_SESSION = 'Send a message first — /btw asks the session this chat has running.';

/** Hook: the side questions (`/btw`) asked about the SDK chat's session, and
 *  the one in flight.
 *
 *  Each question goes to the chat's own live query (`sessions:sideQuestion`),
 *  never to a resumed copy, so it reads the session's prompt cache. Follow-ups
 *  carry the exchanges already answered as history — a failed or stopped one
 *  is not part of what was said. A late answer to a question that was stopped,
 *  cleared or left by unmounting changes nothing: `inFlight` no longer names it. */
export function useSideQuestions(sessionId: string | null) {
  const [exchanges, setExchanges] = useState<SideExchange[]>([]);
  const inFlight = useRef<string | null>(null);

  const settle = useCallback((id: string, patch: Partial<SideExchange>) => {
    setExchanges(list => list.map(x => (x.id === id ? { ...x, ...patch } : x)));
  }, []);

  const cancel = useCallback(() => {
    const id = inFlight.current;
    inFlight.current = null;
    if (id) void window.electronAPI.sessions.cancelSideQuestion(id);
    return id;
  }, []);
  useEffect(
    () => () => {
      cancel();
    },
    [cancel]
  );

  const run = useCallback(
    async (question: string, history: SideQuestionTurn[]) => {
      const id = crypto.randomUUID();
      setExchanges(list => [...list, { id, question, status: 'pending' }]);
      if (!sessionId) {
        settle(id, { status: 'failed', error: NO_SESSION });
        return;
      }
      inFlight.current = id;
      const res = await window.electronAPI.sessions
        .sideQuestion(sessionId, question, history, id)
        .catch((e: unknown) => ({ data: null, error: String(e) }));
      if (inFlight.current !== id) return;
      inFlight.current = null;
      if (res.error || !res.data) settle(id, { status: 'failed', error: res.error ?? 'No answer' });
      else if (res.data.response === null || res.data.synthetic) settle(id, { status: 'empty' });
      else settle(id, { status: 'answered', response: res.data.response });
    },
    [sessionId, settle]
  );

  const historyOf = (list: SideExchange[]) =>
    list
      .filter(x => x.status === 'answered')
      .map(x => ({ question: x.question, response: x.response ?? '' }));

  return {
    exchanges,
    pending: exchanges.some(x => x.status === 'pending'),
    ask(question: string) {
      if (inFlight.current) return;
      void run(question, historyOf(exchanges));
    },
    stop() {
      const id = cancel();
      if (id) settle(id, { status: 'stopped' });
    },
    retry(x: SideExchange) {
      if (inFlight.current) return;
      const rest = exchanges.filter(e => e.id !== x.id);
      setExchanges(rest);
      void run(x.question, historyOf(rest));
    },
    clear() {
      cancel();
      setExchanges([]);
    },
  };
}

export type SideQuestions = ReturnType<typeof useSideQuestions>;
