import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SessionTag } from '../../../hooks/useSessionTags';

type AnchorRect = Pick<DOMRect, 'top' | 'left' | 'bottom' | 'right' | 'width' | 'height'>;

export function TagPicker({
  anchorRect,
  allTags,
  selected,
  onToggle,
  onClose,
}: {
  anchorRect: AnchorRect;
  allTags: SessionTag[];
  selected: string[];
  onToggle: (name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      const popover = document.getElementById('cl-tag-picker-root');
      if (popover && !popover.contains(target)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const normalized = query.trim().toLowerCase().replace(/\s+/g, '-');
  const matches = useMemo(
    () => allTags.filter(t => !query || t.name.includes(normalized)),
    [allTags, query, normalized]
  );
  const exact = allTags.find(t => t.name === normalized);
  const canCreate = normalized.length > 0 && !exact;

  const top = anchorRect.bottom + 6;
  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 268));

  return createPortal(
    <div
      id="cl-tag-picker-root"
      className="cl-tag-picker"
      style={{ position: 'fixed', top, left, zIndex: 1000 }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="cl-tag-picker-input">
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Find or create a tag…"
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && canCreate) {
              e.preventDefault();
              onToggle(normalized);
              setQuery('');
            } else if (e.key === 'Enter' && matches.length === 1) {
              e.preventDefault();
              onToggle(matches[0].name);
              setQuery('');
            }
          }}
        />
      </div>
      <div className="cl-tag-picker-list">
        {matches.length === 0 && !canCreate && (
          <div className="cl-tag-picker-empty">No tags yet — type to create one.</div>
        )}
        {matches.map(t => {
          const isSelected = selected.includes(t.name);
          return (
            <button
              key={t.name}
              type="button"
              className={`cl-tag-picker-row${isSelected ? ' on' : ''}`}
              aria-pressed={isSelected}
              onClick={() => onToggle(t.name)}
            >
              <span className="check" aria-hidden>
                {isSelected && <CheckGlyph />}
              </span>
              <span className="hash" aria-hidden>
                #
              </span>
              <span className="name">{t.name}</span>
            </button>
          );
        })}
        {canCreate && (
          <button
            type="button"
            className="cl-tag-picker-row create"
            onClick={() => {
              onToggle(normalized);
              setQuery('');
            }}
          >
            <span className="check" aria-hidden>
              +
            </span>
            <span className="name">
              Create <strong>#{normalized}</strong>
            </span>
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}
