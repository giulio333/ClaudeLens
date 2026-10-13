// The settings page's building blocks, shared by its tabs.
import type { ReactNode } from 'react';

/** One editable preference: what it is on the left, its control on the right.
 *  No dotted leader — a leader reads a value off, and this row sets one. */
export function PrefRow({
  label,
  hint,
  off,
  children,
}: {
  label: string;
  hint?: string;
  /** The preference has no effect right now (its parent switch is off). */
  off?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`set-pref${off ? ' is-off' : ''}`}>
      <div className="txt">
        <div className="lbl">{label}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** On/off the way the design system draws one: a glass button whose accent tint
 *  is the on state, with the state spelled out so the tint is never the only
 *  signal. Still a `switch` to assistive tech. */
export function OnOff({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`cl-btn cl-btn--icon set-onoff${checked ? ' is-pinned' : ''}`}
    >
      {checked && (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      <span>{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

/** A group of rows: a mono label over a rule, then the content — no card. On
 *  the Settings panel the rule is ink; inside the project's ledger, where the
 *  domain above already drew the ink rule, it steps down to a hairline. A block
 *  with no label (`bare`: a tab that is one list) still opens with the rule. */
export function Block({
  label,
  note,
  grid,
  count,
  wide,
  children,
}: {
  label?: string;
  /** A short qualifier on the right of the label, where a count would sit. */
  note?: string;
  grid?: boolean;
  count?: number;
  /** Span every column when the blocks around it are laid out side by side. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`set-block${label ? '' : ' bare'}${wide ? ' wide' : ''}`}>
      {label && (
        <div className="set-block-head">
          <span className="lbl">{label}</span>
          {count != null ? (
            <span className="ct">{count}</span>
          ) : (
            note && <span className="ct">{note}</span>
          )}
        </div>
      )}
      <div className={grid ? 'set-rows' : undefined}>{children}</div>
    </section>
  );
}
