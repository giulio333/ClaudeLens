import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TrashGlyph } from '../chat/icons';
import { PinIcon } from '../shared/SearchPopover';

// Every per-row action of a session lives behind one "…" trigger. They used to
// be three labelled buttons floating on the row's dotted leader — a filled
// cluster that appeared on hover, needed its own opaque backdrop to stay legible
// over the tinted row (which read as a grey block in dark mode), and grew by one
// button for every action we wanted to add. The kebab is a single 24px glyph in
// the flow of the row: nothing overlays anything, and the menu can hold as many
// actions as the session deserves.

export function SessionRowMenu({
  title,
  pinned,
  /** Keeps the trigger visible while the tag picker it opened is still up. */
  pickerOpen,
  onOpenChat,
  onAddTag,
  onTogglePin,
  onDelete,
}: {
  title: string;
  pinned: boolean;
  pickerOpen: boolean;
  onOpenChat: () => void;
  onAddTag: (anchor: DOMRect) => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The trigger's rect, measured when the menu opens (`null` = closed). It both
  // places the popover and anchors the tag picker the "Add tag" item opens, so
  // the picker hangs off the button the user actually clicked.
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const open = anchorRect !== null;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      // The trigger is excluded so a second click on it closes the menu instead
      // of closing and immediately reopening it.
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setAnchorRect(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setAnchorRect(null);
      btnRef.current?.focus();
    }
    // The menu is fixed-positioned: scrolling the list would leave it hanging
    // over an unrelated row.
    function onScroll() {
      setAnchorRect(null);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setAnchorRect(null);
    fn();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`cl-srow-menu${open || pickerOpen ? ' is-open' : ''}`}
        aria-label={`Actions for ${title}`}
        aria-haspopup="true"
        aria-expanded={open}
        title="More actions"
        // The row itself is a button: without these the trigger would also open
        // the session behind its own menu.
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          e.stopPropagation();
          setAnchorRect(prev => (prev ? null : rect));
        }}
        onKeyDown={e => e.stopPropagation()}
      >
        <DotsGlyph />
      </button>
      {anchorRect && (
        <SessionActionsMenu
          menuRef={menuRef}
          anchorRect={anchorRect}
          title={title}
          pinned={pinned}
          onOpenChat={run(onOpenChat)}
          onAddTag={run(() => onAddTag(anchorRect))}
          onTogglePin={run(onTogglePin)}
          onDelete={run(onDelete)}
        />
      )}
    </>
  );
}

function SessionActionsMenu({
  menuRef,
  anchorRect,
  title,
  pinned,
  onOpenChat,
  onAddTag,
  onTogglePin,
  onDelete,
}: {
  menuRef: React.RefObject<HTMLDivElement | null>;
  anchorRect: DOMRect;
  title: string;
  pinned: boolean;
  onOpenChat: () => void;
  onAddTag: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  // Placed after the first paint so the flip-up decision is taken on the menu's
  // real height, not on a guess that goes stale when items change.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { offsetHeight: h, offsetWidth: w } = el;
    // Right-aligned to the trigger, flipped above it when the row sits too low
    // for the menu to fit below.
    const left = Math.max(8, Math.min(anchorRect.right - w, window.innerWidth - w - 8));
    const below = anchorRect.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, anchorRect.top - h - 6) : below;
    setPos({ top, left });
  }, [anchorRect, menuRef]);

  return createPortal(
    <div
      ref={menuRef}
      className="cl-menu"
      aria-label="Session actions"
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        zIndex: 1000,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="cl-menu-head" title={title}>
        {title}
      </div>
      <button
        type="button"
        className="cl-menu-item"
        title="Open as an in-app chat — runs through the Agent SDK, billed to SDK credits (separate from your subscription)"
        onClick={onOpenChat}
      >
        <span className="ic">
          <ChatGlyph />
        </span>
        Open in chat
      </button>
      <button type="button" className="cl-menu-item" onClick={onAddTag}>
        <span className="ic">
          <TagGlyph />
        </span>
        Add tag…
      </button>
      <button type="button" className="cl-menu-item" onClick={onTogglePin}>
        <span className="ic">
          <PinIcon filled={pinned} />
        </span>
        {pinned ? 'Unpin session' : 'Pin session'}
      </button>
      <button
        type="button"
        className="cl-menu-item danger"
        onClick={onDelete}
        title="Delete this session and its artifacts"
      >
        <span className="ic">
          <TrashGlyph />
        </span>
        Delete session…
      </button>
    </div>,
    document.body
  );
}

function DotsGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="3" cy="8" r="1.35" />
      <circle cx="8" cy="8" r="1.35" />
      <circle cx="13" cy="8" r="1.35" />
    </svg>
  );
}

function ChatGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.2 4.2A1.7 1.7 0 0 1 3.9 2.5h8.2a1.7 1.7 0 0 1 1.7 1.7v5a1.7 1.7 0 0 1-1.7 1.7H6.6L3.2 13.5v-2.6h-.3a.6.6 0 0 1-.7-.6z" />
    </svg>
  );
}

function TagGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 2.5h4.6l6.4 6.4-4.6 4.6-6.4-6.4z" />
      <circle cx="5.4" cy="5.4" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
