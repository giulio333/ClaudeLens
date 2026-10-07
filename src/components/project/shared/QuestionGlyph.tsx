/** The `?` a session waiting for an answer wears — on its tab (`ToneDot`) and
 *  above the Lens's pill (`WaitingLine`). Strokes `currentColor`, sized by its
 *  container. */
export function QuestionGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.9 6a2.2 2.2 0 0 1 4.25.75c0 1.5-2.15 1.9-2.15 3" />
      <path d="M8 12.6h.01" />
    </svg>
  );
}
