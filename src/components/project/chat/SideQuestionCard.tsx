import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import Markdown from '../../Markdown';
import type { SideExchange, SideQuestions } from './useSideQuestions';

function ExchangeView({
  x,
  onStop,
  onRetry,
}: {
  x: SideExchange;
  onStop: () => void;
  onRetry: () => void;
}) {
  return (
    <article className="cl-btw-exchange" aria-busy={x.status === 'pending'}>
      <p className="cl-btw-question">{x.question}</p>
      <div className="cl-btw-answer">
        <span className="cl-btw-answer-mark" aria-hidden="true" />
        {x.status === 'pending' && (
          <p className="cl-btw-reading" role="status">
            Reading the session
            <span className="cl-btw-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <button type="button" className="cl-btw-link" onClick={onStop}>
              Stop
            </button>
          </p>
        )}
        {x.status === 'answered' && <Markdown className="cl-btw-md">{x.response ?? ''}</Markdown>}
        {x.status === 'empty' && (
          <p className="cl-btw-note">
            No answer came back. Try again, or ask in the conversation itself.
          </p>
        )}
        {x.status === 'stopped' && <p className="cl-btw-note">Stopped.</p>}
        {x.status === 'failed' && (
          <p className="cl-btw-error" role="alert">
            {x.error}{' '}
            <button type="button" className="cl-btw-link" onClick={onRetry}>
              Try again
            </button>
          </p>
        )}
      </div>
    </article>
  );
}

/**
 * The side questions (`/btw`) asked in the SDK chat, in a card above the
 * composer: each one answered from the session's context and never added to
 * the conversation — the transcript under it does not move. Asked by typing
 * `/btw …` in the composer, which is also how a follow-up is asked; the card
 * only reads them back. ✕, or Escape in the card or the composer, closes it and
 * forgets the thread, cancelling a question still out.
 */
export function SideQuestionCard({ thread }: { thread: SideQuestions }) {
  // The card's own body scrolls to the newest exchange — set directly, since
  // `scrollIntoView` would also scroll the chat around it.
  const body = useRef<HTMLDivElement>(null);
  const last = thread.exchanges[thread.exchanges.length - 1];
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [thread.exchanges.length, last?.status]);
  if (thread.exchanges.length === 0) return null;

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    thread.clear();
  };

  return (
    <section className="cl-btw-card" aria-label="Side questions" onKeyDown={onKey}>
      <header className="cl-btw-head">
        <span className="cl-btw-label">btw</span>
        <span className="cl-btw-caption">not added to the conversation · no tools</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="cl-btw-close"
          aria-label="Close side questions"
          title="Close and forget these side questions"
          onClick={thread.clear}
        >
          ×
        </button>
      </header>
      <div className="cl-btw-body" ref={body}>
        {thread.exchanges.map(x => (
          <ExchangeView key={x.id} x={x} onStop={thread.stop} onRetry={() => thread.retry(x)} />
        ))}
      </div>
      <footer className="cl-btw-hint">/btw again to follow up</footer>
    </section>
  );
}
