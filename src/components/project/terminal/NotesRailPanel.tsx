import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ClipboardEvent, KeyboardEvent, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { saveSessionNotes, useAiSettings, useSessionNotes } from '../../../hooks/useIPC';
import type { InsightKind, InsightResult } from '../../../../electron/shared/ai-settings';
import {
  backspaceAtStart,
  enterAt,
  lineShortcut,
  newBlock,
  notesTally,
  parseNotes,
  pasteAt,
  serializeNotes,
  type Edit,
  type NoteBlock,
  type NoteKind,
} from './session-notes';
import './session-notes.css';
import { htmlToNoteBlocks } from './session-notes-paste';
import { IS_MAC } from './view-keys';
import { appendInsight, insightMeta } from './notes-ai';
import { NotesAiMenu } from './NotesAiMenu';
import { useNotesAi, type NotesAiOutcome } from './use-notes-ai';

const TOGGLE_KEY = IS_MAC ? '⌘⇧L' : 'Ctrl+Shift+L';

const ICON = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/** What a line can be, in the order the toolbar offers it. */
const KINDS: { kind: NoteKind; label: string; icon: ReactNode }[] = [
  {
    kind: 'text',
    label: 'Text',
    icon: (
      <svg {...ICON}>
        <path d="M5 7h14M5 12h14M5 17h9" />
      </svg>
    ),
  },
  {
    kind: 'check',
    label: 'To-do',
    icon: (
      <svg {...ICON}>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </svg>
    ),
  },
  {
    kind: 'bullet',
    label: 'List',
    icon: (
      <svg {...ICON}>
        <circle cx="5.5" cy="7" r="1" fill="currentColor" />
        <circle cx="5.5" cy="12" r="1" fill="currentColor" />
        <circle cx="5.5" cy="17" r="1" fill="currentColor" />
        <path d="M10 7h10M10 12h10M10 17h10" />
      </svg>
    ),
  },
];

const SAVE_DELAY_MS = 400;

type PanelProps = {
  id: string;
  sessionId: string;
  onClose: (restoreFocus?: boolean) => void;
  onUse: (text: string) => Promise<void>;
  useHint: string;
  /** Fixed notes for a preview of the panel (the "What's new" popup): nothing
   *  is read or written, so a demo never touches the reader's own notes. */
  preview?: string;
  /** With `preview`: stands in for the model, so the popup can show a run
   *  end to end — the AI button, the running state, the lines it adds. */
  previewAi?: (kind: InsightKind) => Promise<InsightResult>;
};

/** The session's scratchpad, in the rail's body. While it is open its own
 *  state is the truth — seeded once from disk, never overwritten by a read —
 *  and every change goes straight into the query cache, so the rail badge
 *  follows as you type; the file is written after a short pause and on close. */
export function NotesRailPanel(props: PanelProps) {
  const query = useSessionNotes(props.preview === undefined ? props.sessionId : null);
  if (props.preview !== undefined) return <NotesSheet {...props} initial={props.preview} />;
  if (query.data === undefined) {
    return (
      <div id={props.id} role="region" aria-label="Session notes" className="cl-notes">
        <p className="cl-notes-msg">
          {query.isError ? `Couldn't read the notes: ${query.error.message}` : 'Loading…'}
        </p>
      </div>
    );
  }
  return <NotesSheet {...props} initial={query.data} />;
}

function seed(md: string): NoteBlock[] {
  const parsed = md ? parseNotes(md) : [];
  // An empty sheet still offers one line to type in.
  return parsed.length > 0 ? parsed : [newBlock()];
}

function NotesSheet({
  id,
  sessionId,
  onClose,
  onUse,
  useHint,
  preview,
  previewAi,
  initial,
}: PanelProps & { initial: string }) {
  const [blocks, setBlocks] = useState(() => seed(initial));
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // What one click can take back: a cleared sheet, or what a Notes AI run added.
  const [undo, setUndo] = useState<{ blocks: NoteBlock[]; label: string; meta?: string } | null>(
    null
  );
  const [aiStatus, setAiStatus] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  // The sheet as of the last commit, for a run's answer that arrives later.
  const latest = useRef(blocks);
  const ai = useNotesAi(sessionId);
  const aiSettings = useAiSettings();
  const [demoRunning, setDemoRunning] = useState<InsightKind | null>(null);
  const aiOn = preview === undefined ? aiSettings.data?.enabled === true : previewAi !== undefined;
  const { save, flush: flushSave } = useDebouncedSave(sessionId, setSaveError);
  const client = useQueryClient();
  const last = blocks[blocks.length - 1];
  // A preview opens in a dialog that owns the focus.
  const focusReq = useRef<{ id: string; pos: number } | null>(
    preview === undefined ? { id: last.id, pos: last.text.length } : null
  );
  const lines = useRef(new Map<string, HTMLTextAreaElement>());
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const req = focusReq.current;
    if (!req) return;
    const el = lines.current.get(req.id);
    if (!el) return;
    focusReq.current = null;
    el.focus();
    el.setSelectionRange(req.pos, req.pos);
  });

  function commit(next: NoteBlock[], focus?: Edit['focus']) {
    if (focus) focusReq.current = focus;
    setUndo(null);
    setAiStatus(null);
    setBlocks(next);
    // A run's answer lands on the newest sheet, not on the one it was asked from.
    latest.current = next;
    if (preview !== undefined) return;
    const text = serializeNotes(next);
    client.setQueryData(['notes', sessionId], text);
    save(text);
  }
  const apply = (edit: Edit | null) => edit && commit(edit.blocks, edit.focus);

  function update(i: number, patch: Partial<NoteBlock>, focus?: Edit['focus']) {
    const next = blocks.slice();
    next[i] = { ...next[i], ...patch };
    commit(next, focus);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>, i: number) {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const b = blocks[i];
    const caret = el.selectionStart;
    const collapsed = caret === el.selectionEnd;
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      update(
        i,
        { type: b.type === 'check' ? 'text' : 'check', done: false },
        { id: b.id, pos: caret }
      );
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      apply(enterAt(blocks, i, caret));
    } else if (e.key === 'Backspace' && collapsed && caret === 0) {
      const edit = backspaceAtStart(blocks, i);
      if (edit) e.preventDefault();
      apply(edit);
    } else if (e.key === 'ArrowUp' && collapsed && caret === 0 && i > 0) {
      e.preventDefault();
      focusLine(blocks[i - 1], blocks[i - 1].text.length);
    } else if (
      e.key === 'ArrowDown' &&
      collapsed &&
      caret === b.text.length &&
      i < blocks.length - 1
    ) {
      e.preventDefault();
      focusLine(blocks[i + 1], 0);
    } else if (e.key === 'Escape') {
      // The note's Esc only: the frame's window listener would also close an
      // overlay open beside the rail.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  function focusLine(b: NoteBlock, pos: number) {
    const el = lines.current.get(b.id);
    el?.focus();
    el?.setSelectionRange(pos, pos);
  }

  function onChange(i: number, value: string) {
    const b = blocks[i];
    const shortcut = b.type === 'check' ? null : lineShortcut(value);
    if (shortcut && shortcut.type !== b.type)
      update(
        i,
        { type: shortcut.type, done: shortcut.done, text: shortcut.rest },
        { id: b.id, pos: 0 }
      );
    else update(i, { text: value.replace(/\n/g, ' ') });
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>, i: number) {
    // A rendered list copied from the Lens keeps its shape only in the HTML.
    const structured = htmlToNoteBlocks(e.clipboardData.getData('text/html'));
    const pasted = e.clipboardData.getData('text/plain');
    if (!structured && !pasted.includes('\n')) return;
    e.preventDefault();
    const el = e.currentTarget;
    apply(pasteAt(blocks, i, el.selectionStart, el.selectionEnd, structured ?? pasted));
  }

  /** The kind buttons act on the line being edited — the last one when
   *  nothing has been focused yet — and leave the caret where it was. */
  function setKind(kind: NoteKind) {
    const found = blocks.findIndex(b => b.id === focusedId);
    const i = found >= 0 ? found : blocks.length - 1;
    const b = blocks[i];
    const pos = lines.current.get(b.id)?.selectionStart ?? b.text.length;
    update(i, { type: kind, done: false }, { id: b.id, pos });
  }

  /** Empty the sheet at once; the old one stays a click away until the next edit. */
  function clearAll() {
    const empty = newBlock();
    const before = blocks;
    commit([empty], { id: empty.id, pos: 0 });
    setUndo({ blocks: before, label: 'Notes cleared' });
  }

  function restore() {
    if (!undo) return;
    const last = undo.blocks[undo.blocks.length - 1];
    commit(undo.blocks, { id: last.id, pos: last.text.length });
  }

  async function demoRun(
    answer: (kind: InsightKind) => Promise<InsightResult>,
    kind: InsightKind
  ): Promise<NotesAiOutcome> {
    setDemoRunning(kind);
    try {
      return { kind: 'done', result: await answer(kind) };
    } finally {
      setDemoRunning(null);
    }
  }

  async function runAi(kind: InsightKind) {
    setAiStatus(null);
    const outcome = previewAi ? await demoRun(previewAi, kind) : await ai.run(kind);
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'error') {
      setAiStatus({ tone: 'error', text: outcome.message });
      return;
    }
    const { result } = outcome;
    if (result.lines.length === 0) {
      setAiStatus({ tone: 'info', text: 'Nothing to add' });
      return;
    }
    const before = latest.current;
    const next = appendInsight(before, kind, result.lines, new Date());
    // No focus request: the answer can land while the user types elsewhere.
    commit(next);
    setUndo({
      blocks: before,
      label: kind === 'summary' ? 'Summary added' : 'To-dos added',
      meta: insightMeta(result),
    });
  }

  function clearDone() {
    const kept = blocks.filter(b => !(b.type === 'check' && b.done));
    commit(kept.length > 0 ? kept : [newBlock()]);
  }

  const serialized = serializeNotes(blocks);
  const tally = notesTally(serialized);
  const empty = serialized === '';
  const current = blocks.find(b => b.id === focusedId) ?? blocks[blocks.length - 1];

  return (
    <div
      ref={panel}
      id={id}
      role="region"
      aria-label="Session notes"
      className="cl-notes"
      onBlur={e => {
        // Leaving the panel for anything but its own trigger saves now.
        if (!panel.current?.contains(e.relatedTarget as Node | null)) flushSave();
      }}
    >
      <div className="cl-notes-tools">
        <div className="cl-notes-kinds" role="group" aria-label="Line type">
          {KINDS.map(k => (
            <button
              key={k.kind}
              type="button"
              className="cl-notes-kind"
              aria-label={k.label}
              aria-pressed={current.type === k.kind}
              title={k.kind === 'check' ? `${k.label} (${TOGGLE_KEY})` : k.label}
              onMouseDown={e => e.preventDefault()}
              onClick={() => setKind(k.kind)}
            >
              {k.icon}
            </button>
          ))}
        </div>
        {tally.total > 0 && (
          <span className="cl-notes-progress" data-all={tally.done === tally.total || undefined}>
            {tally.done}/{tally.total} done
          </span>
        )}
        <span className="cl-notes-spacer" />
        {aiOn && (
          <NotesAiMenu
            running={demoRunning ?? ai.running}
            onRun={kind => void runAi(kind)}
            onCancel={ai.cancel}
          />
        )}
        {tally.done > 0 && (
          <button
            type="button"
            className="cl-notes-tool"
            title="Remove the to-dos that are done"
            onClick={clearDone}
          >
            Clear done
          </button>
        )}
        {!empty && (
          <button
            type="button"
            className="cl-notes-tool cl-notes-trash"
            aria-label="Clear all notes"
            title="Clear all notes"
            onClick={clearAll}
          >
            <svg {...ICON}>
              <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" />
            </svg>
          </button>
        )}
      </div>

      <div className="cl-notes-sheet">
        {blocks.map((b, i) => (
          <NoteLine
            key={b.id}
            block={b}
            placeholder={blocks.length === 1 && i === 0 ? 'Notes for this session…' : ''}
            register={el => {
              if (el) lines.current.set(b.id, el);
              else lines.current.delete(b.id);
            }}
            onFocus={() => setFocusedId(b.id)}
            onChange={value => onChange(i, value)}
            onKeyDown={e => onKey(e, i)}
            onPaste={e => onPaste(e, i)}
            onToggle={() => update(i, { done: !b.done })}
            onUse={() => void onUse(b.text.trim())}
            useHint={useHint}
          />
        ))}
      </div>

      <div className="cl-notes-foot">
        {saveError ? (
          <span className="cl-notes-error" role="alert">
            Not saved: {saveError}
          </span>
        ) : aiStatus?.tone === 'error' ? (
          <span className="cl-notes-error" role="alert">
            AI: {aiStatus.text}
          </span>
        ) : aiStatus ? (
          <span role="status">{aiStatus.text}</span>
        ) : undo ? (
          <>
            <span className="cl-notes-undo" role="status">
              {undo.label}
              <button type="button" onClick={restore}>
                Undo
              </button>
            </span>
            {undo.meta && <span className="cl-notes-ai-meta">{undo.meta}</span>}
          </>
        ) : (
          <>
            <span>
              <kbd>[]</kbd> to-do · <kbd>-</kbd> list
            </span>
            <span>Only you see these</span>
          </>
        )}
      </div>
    </div>
  );
}

function NoteLine({
  block,
  placeholder,
  register,
  onFocus,
  onChange,
  onKeyDown,
  onPaste,
  onToggle,
  onUse,
  useHint,
}: {
  block: NoteBlock;
  placeholder: string;
  register: (el: HTMLTextAreaElement | null) => void;
  onFocus: () => void;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onToggle: () => void;
  onUse: () => void;
  useHint: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Grow with the text: a line that wraps shows all of itself, no inner scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [block.text]);
  const check = block.type === 'check';
  return (
    <div
      className="cl-notes-line"
      data-type={block.type}
      data-done={(check && block.done) || undefined}
    >
      {check ? (
        <button
          type="button"
          className="cl-notes-box"
          role="checkbox"
          aria-checked={block.done}
          aria-label={block.text || 'To-do'}
          onClick={onToggle}
        />
      ) : (
        <span className="cl-notes-gutter" aria-hidden>
          {block.type === 'bullet' ? '•' : ''}
        </span>
      )}
      <textarea
        ref={el => {
          ref.current = el;
          register(el);
        }}
        rows={1}
        value={block.text}
        placeholder={check ? 'To-do' : placeholder}
        aria-label={check ? 'To-do' : 'Note'}
        spellCheck
        onFocus={onFocus}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      {block.text.trim() && (
        <button type="button" className="cl-notes-use" title={useHint} onClick={onUse}>
          → prompt
        </button>
      )}
    </div>
  );
}

/** Write after a pause, and at once on flush or unmount — a closed panel, a
 *  switched session or a parked tab never drops the last keystrokes. */
function useDebouncedSave(sessionId: string, onError: (message: string | null) => void) {
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const text = pending.current;
    if (text === null) return;
    pending.current = null;
    saveSessionNotes(sessionId, text).then(
      () => onError(null),
      (error: unknown) => onError(error instanceof Error ? error.message : String(error))
    );
  }, [sessionId, onError]);

  useEffect(() => flush, [flush]);

  const save = useCallback(
    (text: string) => {
      pending.current = text;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush]
  );
  return { save, flush };
}
