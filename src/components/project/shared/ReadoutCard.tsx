import type { CSSProperties, ReactNode } from 'react';
import { READOUT_SURFACE } from './readout';

/**
 * The hover-readout anatomy: a mono eyebrow, a row of headline figures, and
 * the composition behind them as label · value · fill rows.
 *
 * Extracted from Mission Control's `VitalsPopover`, which invented it to
 * recover the figures the feed redesign had folded away. The project hero band
 * needs exactly the same move for its token figure — `totalTokens` sums cache
 * reads at full weight, so the composition is what makes the headline honest —
 * and a second copy of the idiom would be two cards that drift apart.
 *
 * Pointer-transparent by design: these hold no controls, so trapping the cursor
 * would only keep the card up after the pointer has left the number it belongs
 * to.
 */

export function ReadoutShell({
  title,
  meta,
  style,
  children,
}: {
  title: string;
  meta?: string;
  /** Positioning — the surface itself is fixed, where it hangs is the host's. */
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div role="tooltip" className="cl-vitals-pop" style={{ ...READOUT_SURFACE, ...style }}>
      <div className="font-mono flex items-baseline" style={{ gap: 8 }}>
        <span style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--cl-ink-4)' }}>
          {title}
        </span>
        <span style={{ flex: 1 }} />
        {meta && (
          <span style={{ fontSize: 9, letterSpacing: '0.06em', color: 'var(--cl-ink-4)' }}>
            {meta}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** A flat fill rule — the same gauge idiom as the rail's 2px context line. */
export function ReadoutFill({
  pct,
  color,
  height = 4,
}: {
  pct: number;
  color: string;
  height?: number;
}) {
  return (
    <span
      style={{
        flex: 1,
        height,
        borderRadius: 999,
        background: 'var(--cl-line-soft)',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          display: 'block',
          // A part that exists but rounds to nothing still gets a sliver: the
          // reader should see there IS a fresh-input segment, not infer it.
          width: pct > 0 ? `max(2px, ${Math.min(100, pct)}%)` : 0,
          height: '100%',
          background: color,
          transition: 'width 0.3s ease',
        }}
      />
    </span>
  );
}

/** One of the headline figures (USED / LEFT / TOTAL, BILLED / SAVED / …). */
export function ReadoutCell({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        className="font-mono truncate"
        style={{ fontSize: 8.5, letterSpacing: '0.16em', color: 'var(--cl-ink-4)' }}
      >
        {label}
      </div>
      <div
        className="font-mono"
        style={{
          marginTop: 3,
          fontSize: 13,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          color: color ?? 'var(--cl-ink)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** A composition row: what the headline number is made of. */
export function ReadoutPart({
  label,
  value,
  share,
  color,
}: {
  label: string;
  value: string;
  share: number;
  color: string;
}) {
  return (
    <div className="font-mono flex items-center" style={{ gap: 9, marginTop: 6 }}>
      <span style={{ width: 74, fontSize: 9.5, color: 'var(--cl-ink-3)' }}>{label}</span>
      <span
        style={{
          width: 42,
          textAlign: 'right',
          fontSize: 10,
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--cl-ink-2)',
        }}
      >
        {value}
      </span>
      <ReadoutFill pct={share} color={color} />
    </div>
  );
}

export function ReadoutRule() {
  return <div style={{ height: 1, background: 'var(--cl-line)', margin: '13px 0 3px' }} />;
}
