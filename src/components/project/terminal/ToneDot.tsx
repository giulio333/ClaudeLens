import { QuestionGlyph } from '../shared/QuestionGlyph';
import type { ChipTone } from './terminal-instances';

/**
 * A session's state as the tabs, the parked badge and its rows draw it: a dot
 * whose colour is the state. Waiting on the user is the accent dot, pulsing —
 * and a `?` only when Claude asks a question (`asksQuestion`): a tool's
 * approval or a dialog is not one, and the mark must not say it is.
 *
 * `unseen` rings the dot: a turn ended while the session was off screen.
 * `motion` plays once, for a change newer than the strip drawing it
 * (`tab-attention.ts`): the orb settling into the dot, or the wait arriving.
 */
export function ToneDot({
  tone,
  question = false,
  unseen = false,
  motion = null,
}: {
  tone: ChipTone;
  question?: boolean;
  unseen?: boolean;
  motion?: 'settle' | 'ask' | null;
}) {
  const asks = tone === 'waiting' && question;
  return (
    <span
      className="cl-parked-dot"
      data-tone={tone}
      data-question={asks || undefined}
      data-unseen={unseen || undefined}
      data-motion={motion ?? undefined}
      aria-hidden
    >
      {asks && <QuestionGlyph />}
    </span>
  );
}
