import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelSessionInsight, runSessionInsight } from '../../../hooks/useIPC';
import type { InsightKind, InsightResult } from '../../../../electron/shared/ai-settings';

export type NotesAiOutcome =
  | { kind: 'done'; result: InsightResult }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' };

/** One Notes AI run at a time for this panel. Closing the panel or leaving
 *  Mission Control unmounts it, which cancels the run in the main and drops its
 *  answer. Switching to another session tab does not: the tab stays mounted and
 *  hidden, and the answer still lands in the notes of the session that asked.
 *  The run starts on a click, never in an effect, so StrictMode's double effect
 *  cannot start it twice. */
export function useNotesAi(sessionId: string) {
  const [running, setRunning] = useState<InsightKind | null>(null);
  const live = useRef(true);
  const cancelled = useRef(false);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      cancelSessionInsight(sessionId).catch(() => {});
    };
  }, [sessionId]);

  const run = useCallback(
    async (kind: InsightKind): Promise<NotesAiOutcome> => {
      cancelled.current = false;
      setRunning(kind);
      try {
        const result = await runSessionInsight(sessionId, kind);
        return live.current && !cancelled.current
          ? { kind: 'done', result }
          : { kind: 'cancelled' };
      } catch (e) {
        if (!live.current || cancelled.current) return { kind: 'cancelled' };
        return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
      } finally {
        if (live.current) setRunning(null);
      }
    },
    [sessionId]
  );

  const cancel = useCallback(() => {
    cancelled.current = true;
    cancelSessionInsight(sessionId).catch(() => {});
  }, [sessionId]);

  return { running, run, cancel };
}
