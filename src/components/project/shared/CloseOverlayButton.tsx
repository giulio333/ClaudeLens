/**
 * Dismisses a detail panel from the frame that hosts it.
 *
 * The panels (tool, skill, agent, team, sub-agent transcript) used to draw a
 * "Back to chat" of their own, which landed one line under the top bar's own
 * "← Back": two arrows, two different destinations, stacked. Now the frame owns
 * the way out — this ✕, the clickable session crumb in the top bar, and Esc —
 * and the panels render `chromeless`.
 *
 * Shaped like the column toggles it sits next to (32px circle, glass border) so
 * the control row reads as one set.
 */
export function CloseOverlayButton({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      title={`${label} (Esc)`}
      aria-label={label}
      className="inline-flex items-center justify-center transition-colors shrink-0"
      style={{
        width: 32,
        height: 32,
        borderRadius: 999,
        border: '1px solid var(--cl-glass-border)',
        background: 'var(--cl-glass-bg-strong)',
        WebkitBackdropFilter: 'blur(12px) saturate(1.5)',
        backdropFilter: 'blur(12px) saturate(1.5)',
        color: 'var(--cl-ink-3)',
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <line x1="3" y1="3" x2="11" y2="11" />
        <line x1="11" y1="3" x2="3" y2="11" />
      </svg>
    </button>
  );
}
