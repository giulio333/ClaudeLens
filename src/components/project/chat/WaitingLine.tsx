import { QuestionGlyph } from '../shared/QuestionGlyph';

/** What the registry says while the session waits on the user. */
export interface SessionWaiting {
  /** The registry's `waitingFor` (`dialog open`, `permission prompt`, …). */
  reason: string | null;
  /** Shows the terminal holding the question; unset when no terminal of this
   *  pane runs the session — opening one would resume it a second time. */
  onOpenTerminal?: () => void;
}

/**
 * "Claude is waiting for you", above the Lens's control pill.
 *
 * The transcript cannot say it: Claude Code writes a question's `tool_use` row
 * together with its answer — measured, the row of an `AskUserQuestion` reached
 * the file 35s after it was asked, a third of a second after the reply — so
 * while the session waits the Lens has nothing to draw and reads as idle. The
 * registry is the one source that knows, and it knows only that the session
 * waits and a generic reason, never the question; this line says exactly that
 * and leads to the terminal where the question is. Once answered, the line
 * goes and the question's own card arrives with the answer on it.
 *
 * It takes the narration's slot (`ThoughtLine`): a session waiting on the user
 * is narrating nothing.
 */
export function WaitingLine({ waiting }: { waiting: SessionWaiting }) {
  const { reason, onOpenTerminal } = waiting;
  return (
    <div className="cl-waiting" role="status">
      <span className="cl-waiting-ic" aria-hidden>
        <QuestionGlyph />
      </span>
      <span className="cl-waiting-text">
        {onOpenTerminal
          ? 'Claude is waiting for you'
          : 'Claude is waiting for you in another terminal'}
      </span>
      {reason && <span className="cl-waiting-reason">{reason}</span>}
      {onOpenTerminal && (
        <button type="button" className="cl-waiting-open" onClick={onOpenTerminal}>
          Open terminal →
        </button>
      )}
    </div>
  );
}
