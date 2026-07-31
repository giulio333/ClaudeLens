import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TagChip } from './TagChip';
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
        <span aria-hidden>#</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Type to filter or create…"
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
              onClick={() => onToggle(t.name)}
            >
              <TagChip name={t.name} tone={isSelected ? 'on' : 'muted'} />
              <span className="status">{isSelected ? '✓' : ''}</span>
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
            <span className="create-label">Create</span>
            <TagChip name={normalized} tone="soft" />
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
