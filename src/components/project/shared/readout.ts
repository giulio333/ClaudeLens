/**
 * Non-component half of the readout card (see `ReadoutCard.tsx`) — kept in its
 * own file for the `react-refresh/only-export-components` rule, which CI runs
 * as an error.
 */
import type { CSSProperties } from 'react';

/** Accent ramp for a part-of-whole. Same hue, three weights — mixing against
 *  `--cl-paper` (not white) so the ramp flips correctly in the dark theme. */
export const READOUT_RAMP = {
  soft: 'color-mix(in oklch, var(--cl-accent) 32%, var(--cl-paper))',
  mid: 'color-mix(in oklch, var(--cl-accent) 62%, var(--cl-paper))',
  full: 'var(--cl-accent)',
};

/** The card's own surface. Callers add the positioning, which differs per host:
 *  Mission Control pins it across the rail, the project band anchors it under
 *  the figure it explains. */
export const READOUT_SURFACE: CSSProperties = {
  zIndex: 30,
  pointerEvents: 'none',
  padding: '13px 15px 15px',
  borderRadius: 10,
  background: 'var(--cl-paper)',
  border: '1px solid var(--cl-line)',
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.14)',
};
