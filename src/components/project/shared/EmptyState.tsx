/** A dressed-up `.cl-empty`: a small inline glyph plus a title and an optional
 *  second line, for the empty states worth more than a line of grey mono text
 *  (a list with nothing in it yet, not a filtered-to-nothing state — those
 *  stay on the plain `.cl-empty` one-liner, since a glyph would overstate a
 *  transient "no matches"). Stroke `currentColor`, no new hues — see root
 *  CLAUDE.md. */
export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: 'orbit' | 'note';
}) {
  return (
    <div className="cl-emptystate">
      <EmptyGlyph kind={icon ?? 'note'} />
      <div className="cl-emptystate-title">{title}</div>
      {hint && <div className="cl-emptystate-hint">{hint}</div>}
    </div>
  );
}

function EmptyGlyph({ kind }: { kind: 'orbit' | 'note' }) {
  if (kind === 'orbit') {
    return (
      <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden>
        <circle cx="15" cy="15" r="2.4" fill="currentColor" />
        <ellipse
          cx="15"
          cy="15"
          rx="13"
          ry="7"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeDasharray="2 3"
        />
        <circle cx="27.3" cy="15" r="1.6" fill="currentColor" opacity="0.6" />
      </svg>
    );
  }
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden>
      <rect x="6" y="4" width="18" height="22" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 11h10M10 15.5h10M10 20h6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
