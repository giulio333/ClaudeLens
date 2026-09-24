import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CloseIcon, SheetModal } from './CommandBlock';
import { FileIcon } from './fileIcons';
import { resolveLang } from './code-lang';
import { fileName, highlightRows } from './file-view';
import type { FileRow } from './file-view';
import { coverageLabel, readRows, spanLabel } from './context-files';
import type { ContextFile, ContextRead } from './context-files';

/**
 * Everything the session did with one file it read — what a click on a name in
 * the context rail opens. The hover peek shows the last read; this shows them
 * all: each read with its turn and the lines it printed, the selected one's
 * command and rows, the lines covered in all, and the jump to that read's turn.
 *
 * On paper, in the page's own palette and theme — the same ground the diffs
 * under each turn are drawn on — not in the dark editor window: it is a panel
 * of this app about a file, not a tool's output window.
 */
export function ContextFileSheet({
  file,
  turnOf,
  onJump,
  onClose,
}: {
  file: ContextFile;
  turnOf: (idx: number) => number | null;
  onJump: (turn: number) => void;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // The last read is where the peek left the reader, so it opens on that one.
  const [selected, setSelected] = useState(file.reads.length - 1);
  const read = file.reads[selected];
  const turn = turnOf(read.idx);
  const coverage = coverageLabel(file.reads);
  const count = file.reads.length;

  // Focus goes to the sheet itself, not to a row: a row focused on open wears
  // the keyboard ring for a window the mouse opened.
  useEffect(() => sheetRef.current?.focus(), []);

  return (
    <SheetModal onClose={onClose} glass>
      <div
        ref={sheetRef}
        className="cl-ctx-sheet"
        role="document"
        tabIndex={-1}
        aria-label={`${fileName(file.path)}, ${count === 1 ? 'one read' : `${count} reads`}`}
      >
        <div className="cl-ctx-sheet-bar">
          <FileIcon ext={file.ext} />
          <b className="cl-ctx-sheet-name">{fileName(file.path)}</b>
          <span className="cl-ctx-sheet-path">{file.path}</span>
          <CopyPath path={file.path} />
          <button type="button" className="cl-ctx-sheet-btn" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="cl-ctx-sheet-main">
          <div className="cl-ctx-sheet-reads">
            <span className="cl-ctx-sheet-head">{count === 1 ? '1 read' : `${count} reads`}</span>
            {file.reads.map((r, i) => (
              <ReadRow
                key={i}
                read={r}
                turn={turnOf(r.idx)}
                on={i === selected}
                onSelect={() => setSelected(i)}
              />
            ))}
          </div>
          <div className="cl-ctx-sheet-pane">
            <ReadHead read={read} turn={turn} />
            <div className="cl-ctx-sheet-body">
              <ReadLines read={read} ext={file.ext} />
            </div>
          </div>
        </div>

        <div className="cl-ctx-sheet-foot">
          <span>
            {coverage ? `${coverage} read in all` : 'no read said which lines it printed'}
          </span>
          {turn !== null && (
            <button
              type="button"
              className="cl-ctx-jump"
              onClick={() => {
                onJump(turn);
                onClose();
              }}
            >
              Jump to turn {turn}
            </button>
          )}
        </div>
      </div>
    </SheetModal>
  );
}

/** How a read happened, for its row and its pane: `Read`, or the command. */
const howRead = (read: ContextRead) =>
  read.via === 'Read' ? 'Read' : String(read.group.use.input.command ?? '');

function ReadRow({
  read,
  turn,
  on,
  onSelect,
}: {
  read: ContextRead;
  turn: number | null;
  on: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`cl-ctx-read${on ? ' is-on' : ''}`}
      aria-pressed={on}
      onClick={onSelect}
    >
      <span className="t">{turn === null ? 'turn —' : `turn ${turn}`}</span>
      <span className="s">{spanLabel(read.span) ?? 'lines not stated'}</span>
      <code className="v">{howRead(read)}</code>
    </button>
  );
}

/** The selected read, said whole: where, which lines, and the command in full
 *  — once, above its rows, instead of wrapping inside its row in the list. */
function ReadHead({ read, turn }: { read: ContextRead; turn: number | null }) {
  const span = spanLabel(read.span);
  const parts = [turn === null ? null : `Turn ${turn}`, span].filter(Boolean);
  return (
    <div className="cl-ctx-sheet-cmd">
      <span className="where">{parts.join(' · ')}</span>
      {read.via === 'shell' && <code>{howRead(read)}</code>}
      {!read.exact && (
        <span className="note">Output of the whole command, not just this file.</span>
      )}
    </div>
  );
}

/** A read's rows on paper, numbered where the read said which lines they are,
 *  highlighted with the palette the page's diffs use. Shared with the peek. */
export function ReadLines({ read, ext, max }: { read: ContextRead; ext: string; max?: number }) {
  const rows = useMemo(() => {
    const all = readRows(read);
    return max === undefined ? all : all.slice(0, max);
  }, [read, max]);
  const html = useMemo(() => highlightRows(rows, resolveLang(ext)), [rows, ext]);
  const digits = Math.max(2, ...rows.map(r => String(r.line ?? '').length));
  if (rows.length === 0) {
    const images = read.group.result?.images?.length ?? 0;
    return <div className="cl-ctx-code-note">{images > 0 ? 'an image' : 'no text recorded'}</div>;
  }
  return (
    <div className="cl-ctx-code" style={{ '--gutter': `${digits}ch` } as CSSProperties}>
      {rows.map((row, i) => (
        <CodeRow key={i} row={row} html={html[i]} />
      ))}
    </div>
  );
}

/** Plain text on paper in the same rows and palette as a read — a command,
 *  say, numbered from 1. Used by the background shell's sheet. */
export function PaperCode({ text, lang }: { text: string; lang: string | null }) {
  const rows = useMemo(
    (): FileRow[] => text.split('\n').map((t, i) => ({ kind: 'ctx', text: t, line: i + 1 })),
    [text]
  );
  const html = useMemo(() => highlightRows(rows, lang), [rows, lang]);
  const digits = Math.max(2, String(rows.length).length);
  return (
    <div className="cl-ctx-code" style={{ '--gutter': `${digits}ch` } as CSSProperties}>
      {rows.map((row, i) => (
        <CodeRow key={i} row={row} html={html[i]} />
      ))}
    </div>
  );
}

function CodeRow({ row, html }: { row: FileRow; html: string | null }) {
  return (
    <div className="cl-ctx-code-row">
      <span className="ln" aria-hidden>
        {row.line ?? ''}
      </span>
      {html ? (
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <code className="hljs">{row.text || ' '}</code>
      )}
    </div>
  );
}

function CopyPath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`cl-ctx-sheet-btn${copied ? ' is-done' : ''}`}
      aria-label={copied ? 'Copied' : 'Copy path'}
      onClick={() => {
        void navigator.clipboard.writeText(path).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {copied ? (
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        ) : (
          <>
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
          </>
        )}
      </svg>
    </button>
  );
}
