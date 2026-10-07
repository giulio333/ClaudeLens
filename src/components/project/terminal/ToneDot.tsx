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
      {tone === 'waiting' && (
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5.9 6a2.2 2.2 0 0 1 4.25.75c0 1.5-2.15 1.9-2.15 3" />
          <path d="M8 12.6h.01" />
        </svg>
      )}
    </span>
  );
}
