// Small inline SVG glyphs used across the chat surface (control pill, dock
// sheets). Stroke uses `currentColor` so they follow the surrounding text color.

export function TrashGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}

export function ChevronUpGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

/** Caret on the agent dock — points up when collapsed (the sheet opens upward),
 *  flips down once the sheet is open. */
export function DockCaretGlyph({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

export function LocateGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2v9" />
      <path d="M4.5 7.5 8 11l3.5-3.5" />
      <path d="M3 13h10" />
    </svg>
  );
}

/** The narration toggle in the control pill: a line of speech, struck through
 *  when the line is off. Not a lightbulb and not a thought bubble — the app
 *  renders real `thinking` blocks elsewhere and these are something else: what
 *  Claude said each action was for. */
export function NarrateGlyph({ on }: { on: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 3.5h11M2.5 7h7.5M2.5 10.5h5" />
      {!on && <path d="M13.5 4.5 3.5 12" strokeWidth="1.3" />}
    </svg>
  );
}
