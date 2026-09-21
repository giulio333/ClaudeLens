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

/** A diff: two rows, one added, one removed. */
export function DiffGlyph() {
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
      <path d="M12 4v6M9 7h6M4 13h16M9 18h6" />
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

/** Find-in-transcript trigger and the two step arrows. The magnifier is the
 *  same 24-grid stroke figure as the rest of this file — the top bar's lens is
 *  a different drawing for a different search (projects and sessions, not this
 *  transcript), and borrowing it would have said they were the same thing. */
export function FindGlyph() {
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
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.4-4.4" />
    </svg>
  );
}

export function FindStepGlyph({ up }: { up: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={up ? undefined : { transform: 'rotate(180deg)' }}
    >
      <path d="M7 14l5-5 5 5" />
    </svg>
  );
}
