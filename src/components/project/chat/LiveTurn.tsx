import { ToolActivity } from '../../../hooks/useIPC';
import Markdown from '../../Markdown';

/** Provisional assistant turn shown while the SDK streams the reply. Mirrors the
 *  real assistant-turn markup (`cl-turn--claude`) so the live text appears inline
 *  in the reading column, exactly where the final message will render once the
 *  turn closes and the transcript refetches. Plain text + a blinking caret keeps
 *  the typing feel without mid-stream markdown reflow. While a tool call's input
 *  is being generated or the tool runs (`tool`), no text streams — the caret
 *  gives way to a "Using X…" chip (with the elapsed time once the SDK reports
 *  `tool_progress` heartbeats). */
export function LiveTurn({
  text,
  tool,
  turnNumber,
}: {
  text: string;
  tool?: ToolActivity | null;
  turnNumber: number;
}) {
  return (
    <article className="cl-turn cl-turn--claude cl-turn--live" aria-live="polite">
      <aside className="cl-turn-rail">
        <span className="cl-turn-orb">C</span>
        <span className="cl-turn-index">{String(turnNumber).padStart(2, '0')}</span>
        <span className="cl-turn-spine" aria-hidden />
      </aside>
      <section className="cl-turn-body">
        <header className="cl-turn-head">
          <span className="cl-turn-who">Claude</span>
          <span className="cl-turn-sep">·</span>
          <time>{tool ? 'working…' : text ? 'responding…' : 'thinking…'}</time>
        </header>
        <div className="cl-turn-content">
          <div className="cl-message-text cl-message-text--assistant cl-live-text">
            {text && <Markdown>{text}</Markdown>}
            {tool ? (
              <span className="cl-live-tool">
                <span className="dot" aria-hidden />
                Using <b>{tool.toolName}</b>
                {tool.elapsedSeconds != null && (
                  <span className="s">· {Math.round(tool.elapsedSeconds)}s</span>
                )}
              </span>
            ) : (
              <span className="cl-live-caret" aria-hidden />
            )}
          </div>
        </div>
      </section>
    </article>
  );
}
