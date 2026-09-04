import { ToolActivity } from '../../../hooks/useIPC';
import Markdown from '../../Markdown';

/** Provisional assistant turn shown while the SDK streams the reply. Mirrors the
 *  real assistant-turn markup (`cl-turn--claude`) so the live text appears inline
 *  in the reading column, exactly where the final message will render once the
 *  turn closes and the transcript refetches. Plain text + a blinking caret keeps
 *  the typing feel without mid-stream markdown reflow. While a tool call's input
 *  is being generated or the tool runs (`tool`), no text streams — the caret
 *  gives way to a chip naming what is happening (with the elapsed time once the
 *  SDK reports `tool_progress` heartbeats).
 *
 *  That chip prints the call's own `description` when there is one (`thought`):
 *  "Show recent commits and changed files · Bash 3s" is what the model said it
 *  was doing, where `Using Bash` was the most generic true statement available.
 *  It arrives one message into the call — `ToolActivity` is emitted at
 *  `content_block_start`, before the input has streamed — so the chip opens on
 *  the tool name and gains the sentence a moment later; the fallback is not a
 *  degraded state but the honest text for a call that carries no note (every
 *  Read/Edit/Write, and most tools other than Bash).
 *
 *  Deliberately NOT behind the narration toggle (`cl-thoughts-hidden`): that
 *  preference hides the paced commentary line, a surface this app added, while
 *  this is a chip that already existed saying the best true thing it can. And
 *  the live chat has no pill to turn it back on from. */
export function LiveTurn({
  text,
  tool,
  thought,
  turnNumber,
}: {
  text: string;
  tool?: ToolActivity | null;
  /** The running call's own note, '' when it carries none. */
  thought?: string;
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
              <span className={`cl-live-tool${thought ? ' is-note' : ''}`}>
                <span className="dot" aria-hidden />
                {thought ? (
                  <>
                    <b>{thought}</b>
                    <span className="s">
                      · {tool.toolName}
                      {tool.elapsedSeconds != null && ` ${Math.round(tool.elapsedSeconds)}s`}
                    </span>
                  </>
                ) : (
                  <>
                    Using <b>{tool.toolName}</b>
                    {tool.elapsedSeconds != null && (
                      <span className="s">· {Math.round(tool.elapsedSeconds)}s</span>
                    )}
                  </>
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
