import { createPortal } from 'react-dom';
import { HighlightColor, HIGHLIGHT_COLORS } from './highlights';
import type { ToolbarState } from './useHighlightLayer';

// Floating swatch bar shown on text selection (create) or on clicking an existing
// highlight (edit + remove). Portaled to <body> and positioned in fixed-viewport
// coordinates supplied by useHighlightLayer.
export function HighlightToolbar({
  toolbar,
  onPick,
  onRemove,
}: {
  toolbar: ToolbarState;
  onPick: (color: HighlightColor) => void;
  onRemove: () => void;
}) {
  if (!toolbar) return null;
  // Clamp into the viewport; the bar sits just above the selection/click.
  const left = Math.min(Math.max(toolbar.at.left, 90), window.innerWidth - 90);
  const top = Math.max(toolbar.at.top - 46, 8);
  return createPortal(
    <div
      data-hl-toolbar
      className="cl-hl-toolbar"
      style={{ left, top }}
      // Keep the native selection alive until the user picks a color.
      onMouseDown={e => e.preventDefault()}
    >
      <div className="cl-hl-swatches">
        {HIGHLIGHT_COLORS.map(c => (
          <button
            key={c.key}
            type="button"
            className={`cl-hl-swatch${toolbar.kind === 'edit' && toolbar.color === c.key ? ' is-active' : ''}`}
            style={{ ['--hl' as string]: c.css }}
            title={c.label}
            aria-label={`Highlight ${c.label}`}
            onClick={() => onPick(c.key)}
          />
        ))}
      </div>
      {toolbar.kind === 'edit' && (
        <>
          <span className="cl-hl-divider" aria-hidden />
          <button
            type="button"
            className="cl-hl-remove"
            title="Remove highlight"
            aria-label="Remove highlight"
            onClick={onRemove}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
            </svg>
          </button>
        </>
      )}
    </div>,
    document.body
  );
}
