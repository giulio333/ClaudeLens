import type { BackgroundShell } from './background-shells';

/** A background shell's state as a glyph: a spinner while it runs, then a
 *  ring with a check, a mark or a square. Shared by the pill and the sheet. */
export function StateIcon({
  state,
  size = 14,
}: {
  state: BackgroundShell['state'];
  size?: number;
}) {
  if (state === 'running') {
    return (
      <svg
        className="cl-bgshell-spin"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="var(--cl-line)" strokeWidth="2.4" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="var(--cl-accent)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  const color =
    state === 'done' ? 'var(--cl-ok)' : state === 'failed' ? 'var(--cl-danger)' : 'var(--cl-ink-3)';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="9" />
      {state === 'done' && <path d="M8 12.5l2.6 2.6L16 9.5" />}
      {state === 'failed' && (
        <>
          <path d="M12 7.5v5.5" />
          <path d="M12 16.5v.01" />
        </>
      )}
      {state === 'stopped' && <rect x="9" y="9" width="6" height="6" rx="1" />}
    </svg>
  );
}
