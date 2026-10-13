import { useEffect, useRef, useState } from 'react';
import type { InsightKind } from '../../../../electron/shared/ai-settings';

const ACTIONS: { kind: InsightKind; label: string; hint: string }[] = [
  { kind: 'summary', label: 'Summary', hint: 'Bullet points on what this session did' },
  { kind: 'todos', label: 'To-dos', hint: 'The tasks it raised, done ones checked' },
];

/** The Notes toolbar's AI button: a menu of actions, then a running state with Cancel. */
export function NotesAiMenu({
  running,
  onRun,
  onCancel,
}: {
  running: InsightKind | null;
  onRun: (kind: InsightKind) => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (running) {
    return (
      <span className="cl-notes-ai-run" role="status">
        Writing {running === 'summary' ? 'a summary' : 'to-dos'}…
        <button type="button" className="cl-notes-tool" onClick={onCancel}>
          Cancel
        </button>
      </span>
    );
  }

  return (
    <div className="cl-notes-ai" ref={root}>
      <button
        type="button"
        className="cl-notes-tool"
        aria-label="Write with AI"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Write a summary or to-dos from this session"
        onMouseDown={e => e.preventDefault()}
        onClick={() => setOpen(o => !o)}
      >
        <svg
          width={15}
          height={15}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.5 10.2 12.6 4.5 10.8 10.2 9Z" />
        </svg>
        AI
      </button>
      {open && (
        <div
          className="cl-notes-ai-menu"
          role="menu"
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          {ACTIONS.map(a => (
            <button
              key={a.kind}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onRun(a.kind);
              }}
            >
              <span className="lbl">{a.label}</span>
              <span className="hint">{a.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
