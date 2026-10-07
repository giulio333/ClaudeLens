import { QuestionGlyph } from '../shared/QuestionGlyph';
import type { ChipTone } from './terminal-instances';

/**
 * A session's state as the tabs, the parked badge and its rows draw it: a dot
 * whose colour is the state, except when Claude is waiting for an answer —
 * that one is a `?`, the state the user has to act on, and a pulsing dot read
 * like any other status.
 */
export function ToneDot({ tone }: { tone: ChipTone }) {
  return (
    <span className="cl-parked-dot" data-tone={tone} aria-hidden>
      {tone === 'waiting' && <QuestionGlyph />}
    </span>
  );
}
