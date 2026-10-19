import { useContext, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { FileIcon } from './fileIcons';
import { SheetModal } from './CommandBlock';
import { resolveLang } from './code-lang';
import {
  changeRows,
  changeStat,
  fileName,
  foldChanges,
  highlightRows,
  markPairs,
  shortDir,
} from './file-view';
import type { FileRow } from './file-view';
import { fileCategoryTint, fileExt } from './utils';
import { DiffsOpenContext } from './diffs-open';
import { FilePageHead } from '../files/FileViewer';
import type { FileChangeSource, TouchedFile } from './utils';

/** Rows drawn before a change folds. A created file is its whole content, so
 *  it folds early; an edit's hunks are short by nature and fold only when a
 *  shell rewrite runs long (the corpus tail reaches 298 lines a hunk). */
const WRITE_CLAMP = 12;
const EDIT_CLAMP = 60;

/**
 * The files a turn changed, at its foot, in MIN density.
 *
 * MIN hides tool bodies, and before this the only trace of an edit was an icon
 * chip with the file name on hover — no verb, no size, no way to see the change
 * without switching the whole conversation to FULL. Each changed file is now
 * the diff itself, the way Claude Code prints it in the terminal: one line
 * saying what happened to the file and how many lines moved, the numbered
 * hunks under it, folded until opened. It is drawn on the page, in the page's own
 * light or dark palette, not as a window inside the turn: it is part of what
 * the turn said, not a tool card beside it. The header folds it, a control
 * opens it full-screen.
 *
 * Reads are not changes. They keep the icon chips: a turn that read twelve
 * files to edit one should show the one, and the twelve should not stand in
 * front of it. Files changed the same way in one folder fold into one row
 * (`foldChanges`), which opens into theirs.
 */
export function FileChangesStrip({ files }: { files: TouchedFile[] }) {
  const changed = files.filter(f => f.action !== 'read');
  const read = files.filter(f => f.action === 'read');
  if (files.length === 0) return null;
  return (
    <>
      {changed.length > 0 && (
        <div className="cl-file-changes">
          {foldChanges(changed).map(e =>
            e.kind === 'file' ? (
              <FileChange key={e.file.path} file={e.file} />
            ) : (
              <FolderChange key={`${e.action}:${e.files[0].path}`} files={e.files} />
            )
          )}
        </div>
      )}
      <FileChipCluster files={read} />
    </>
  );
}

const VERB: Record<TouchedFile['action'], string> = {
  edited: 'Updated',
  created: 'Created',
  deleted: 'Deleted',
  read: 'Read',
};

/** Open or folded: the pill's switch sets every row at once; a click on one
 *  moves only that one, until the switch is flipped again. */
function useSwitchedOpen(): [boolean, (next: (o: boolean) => boolean) => void] {
  const allOpen = useContext(DiffsOpenContext);
  // A click here is a local choice; a flip of the switch is the newer intent
  // and drops it (state reset during render, keyed on the last switch value).
  const [seen, setSeen] = useState(allOpen);
  const [local, setLocal] = useState<boolean | null>(null);
  if (seen !== allOpen) {
    setSeen(allOpen);
    setLocal(null);
  }
  const open = local ?? allOpen;
  return [open, next => setLocal(next(open))];
}

/** Files changed the same way in one folder: the verb, how many, the folder
 *  once and the lines summed; open, the files under it without their folder. */
function FolderChange({ files }: { files: TouchedFile[] }) {
  const [open, setOpen] = useSwitchedOpen();
  const { action, ext } = files[0];
  const oneExt = files.every(f => f.ext === ext);
  const stat = changeStat(files.flatMap(f => f.sources));
  // ×N only when it is true of every file: one touched twice among ten is
  // that file's to say, on its own row.
  const times = files[0].sources.length;
  const sameTimes = times > 1 && files.every(f => f.sources.length === times);
  const dir = shortDir(files[0].path);
  return (
    <div
      className={`cl-file-change cl-file-change--folder is-${action}${open ? ' is-open' : ''}`}
      style={{ '--ft': fileCategoryTint(oneExt ? ext : '') } as CSSProperties}
    >
      <div className="cl-file-change-head">
        <button
          type="button"
          className="cl-file-change-toggle"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          title={files.map(f => fileName(f.path)).join('\n')}
        >
          <span className="cl-file-change-caret" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
          <span className="cl-file-change-verb">{VERB[action]}</span>
          <span className="cl-file-change-icon" aria-hidden>
            <FileIcon ext={oneExt ? ext : ''} />
          </span>
          <span className="cl-file-change-path">
            <b>{files.length} files</b>
            {dir !== '/' && <span className="cl-file-change-dir">{dir}</span>}
          </span>
          {sameTimes && <span className="cl-file-change-times">×{times}</span>}
          {(stat.added > 0 || stat.removed > 0) && (
            <span className="cl-file-change-stat">
              {stat.added > 0 && <span className="is-add">+{stat.added}</span>}
              {stat.removed > 0 && <span className="is-del">−{stat.removed}</span>}
            </span>
          )}
        </button>
      </div>
      {open && (
        <div className="cl-file-change-members">
          {files.map(f => (
            <FileChange key={f.path} file={f} inFolder />
          ))}
        </div>
      )}
    </div>
  );
}

function FileChange({ file, inFolder = false }: { file: TouchedFile; inFolder?: boolean }) {
  const [open, setOpen] = useSwitchedOpen();
  const [full, setFull] = useState(false);
  const stat = changeStat(file.sources);
  const dir = shortDir(file.path);
  // A Bash change with no hunks still has a body: the note that says so.
  const hasBody = file.sources.some(s => s.kind === 'bash' || changeRows(s) !== null);
  return (
    <div
      className={`cl-file-change is-${file.action}${open ? ' is-open' : ''}`}
      style={{ '--ft': fileCategoryTint(file.ext) } as CSSProperties}
    >
      <div className="cl-file-change-head">
        <button
          type="button"
          className="cl-file-change-toggle"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          disabled={!hasBody}
          title={file.path}
        >
          <span className="cl-file-change-caret" aria-hidden>
            {open && hasBody ? '▾' : '▸'}
          </span>
          {!inFolder && <span className="cl-file-change-verb">{VERB[file.action]}</span>}
          <span className="cl-file-change-icon" aria-hidden>
            <FileIcon ext={file.ext} />
          </span>
          <span className="cl-file-change-path">
            <b>{fileName(file.path)}</b>
            {!inFolder && dir !== '/' && <span className="cl-file-change-dir">{dir}</span>}
          </span>
          {file.sources.length > 1 && (
            <span className="cl-file-change-times">×{file.sources.length}</span>
          )}
          {(stat.added > 0 || stat.removed > 0) && (
            <span className="cl-file-change-stat">
              {stat.added > 0 && <span className="is-add">+{stat.added}</span>}
              {stat.removed > 0 && <span className="is-del">−{stat.removed}</span>}
            </span>
          )}
        </button>
        {hasBody && (
          <button
            type="button"
            className="cl-file-change-full"
            onClick={() => setFull(true)}
            title="Open full screen"
            aria-label="Open full screen"
          >
            <ExpandGlyph />
          </button>
        )}
      </div>
      {open && hasBody && <FileChangeDiffs file={file} />}
      {full && (
        <SheetModal onClose={() => setFull(false)}>
          <div className="cl-file-change cl-file-change--full is-open">
            <div className="cl-file-change-head">
              <span className="cl-file-change-toggle is-static">
                <span className="cl-file-change-verb">{VERB[file.action]}</span>
                <span className="cl-file-change-path">{file.path}</span>
              </span>
              <button
                type="button"
                className="cl-file-change-full"
                onClick={() => setFull(false)}
                aria-label="Close"
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>
            <FileChangeDiffs file={file} clamp={false} />
          </div>
        </SheetModal>
      )}
    </div>
  );
}

/** The file's change as a page of its own — what a CHANGES row of Mission
 *  Control opens: the head every file page has (`FilePageHead`), with what
 *  happened and how many lines moved where a file page has its controls, and
 *  every diff under it, unclamped. The frame supplies the crumb and the close. */
export function FileChangePage({
  file,
  onOpenFile,
}: {
  file: TouchedFile;
  /** The file as it is on disk now, in the Files viewer. Unset for a file
   *  that is gone or that the host cannot open. */
  onOpenFile?: () => void;
}) {
  const stat = changeStat(file.sources);
  const sep = Math.max(file.path.lastIndexOf('/'), file.path.lastIndexOf('\\'));
  return (
    <div className={`cl-fview cl-file-change cl-file-change--page is-${file.action}`}>
      <FilePageHead path={file.path} dir={sep > 0 ? file.path.slice(0, sep) : file.path}>
        <span className="cl-file-change-verb">{VERB[file.action]}</span>
        {file.sources.length > 1 && (
          <span className="cl-file-change-times">×{file.sources.length}</span>
        )}
        {(stat.added > 0 || stat.removed > 0) && (
          <span className="cl-file-change-stat">
            {stat.added > 0 && <span className="is-add">+{stat.added}</span>}
            {stat.removed > 0 && <span className="is-del">−{stat.removed}</span>}
          </span>
        )}
        {onOpenFile && (
          <button type="button" className="cl-file-change-open" onClick={onOpenFile}>
            Open file
          </button>
        )}
      </FilePageHead>
      <div className="cl-fview-body">
        <div className="cl-file-change-scroll">
          <FileChangeDiffs file={file} clamp={false} />
        </div>
      </div>
    </div>
  );
}

/** The diffs of every call that touched the file, in order — the body of the
 *  strip's row, and what a CHANGES row of Mission Control opens as a page. */
export function FileChangeDiffs({ file, clamp = true }: { file: TouchedFile; clamp?: boolean }) {
  const language = resolveLang(fileExt(file.path));
  return (
    <div className="cl-file-change-body">
      {file.sources.map((s, i) => (
        <ChangeDiff
          key={i}
          source={s}
          language={language}
          clamp={
            !clamp
              ? undefined
              : s.kind === 'tool' && s.group.use.name === 'Write'
                ? WRITE_CLAMP
                : EDIT_CLAMP
          }
        />
      ))}
    </div>
  );
}

/** One call's rows. A Bash change Claude Code capped has none, and says so
 *  rather than drawing nothing — which would read as "nothing changed". */
function ChangeDiff({
  source,
  language,
  clamp,
}: {
  source: FileChangeSource;
  language: string | null;
  clamp?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => {
    const r = changeRows(source);
    return r && markPairs(r);
  }, [source]);
  const clamped = !!clamp && !expanded && !!rows && rows.length > clamp;
  const shown = useMemo(
    () => (rows && clamped ? rows.slice(0, clamp) : rows),
    [rows, clamped, clamp]
  );
  const html = useMemo(() => (shown ? highlightRows(shown, language) : []), [shown, language]);
  if (rows === null) {
    if (source.kind === 'bash') {
      return <div className="cl-file-change-note">no diff was recorded for this change</div>;
    }
    return null;
  }
  if (rows.length === 0) return <div className="cl-file-change-note">empty</div>;
  const digits = Math.max(2, ...rows.map(r => String(r.line ?? '').length));
  return (
    <div className="cl-diff" style={{ '--gutter': `${digits}ch` } as CSSProperties}>
      {shown!.map((row, i) => (
        <DiffLine key={i} row={row} html={html[i]} />
      ))}
      {!!clamp && rows.length > clamp && (
        <button type="button" className="cl-diff-more" onClick={() => setExpanded(e => !e)}>
          {clamped ? `Show all ${rows.length} lines` : 'Collapse'}
        </button>
      )}
    </div>
  );
}

function DiffLine({ row, html }: { row: FileRow; html: string | null }) {
  return (
    <>
      {row.gap && (
        <div className="cl-diff-gap" aria-hidden>
          <span className="cl-diff-gap-mark">⋯</span>
          {row.skipped ? (
            <span className="cl-diff-gap-text">
              {row.skipped} {row.skipped === 1 ? 'line' : 'lines'} unchanged
            </span>
          ) : null}
        </div>
      )}
      <div className={`cl-diff-row is-${row.kind}`}>
        <span className="cl-diff-ln" aria-hidden>
          {row.line ?? ''}
        </span>
        <span className="cl-diff-sign" aria-hidden>
          {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ''}
        </span>
        <span className="cl-diff-cell">
          {/* The mark is a layer under the code, same font and metrics, with
              its own text invisible: hljs owns the code's HTML and a span
              spliced into it would land inside a token. */}
          {row.mark && (
            <span className="cl-diff-mark-layer" aria-hidden>
              {row.text.slice(0, row.mark[0])}
              <mark>{row.text.slice(row.mark[0], row.mark[1]) || ' '}</mark>
              {row.text.slice(row.mark[1])}
            </span>
          )}
          {html ? (
            <code className="cl-diff-code hljs" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <code className="cl-diff-code hljs">{row.text || ' '}</code>
          )}
        </span>
      </div>
    </>
  );
}

function ExpandGlyph() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

/** Row of file chips: one icon per file read, tinted by file kind, with the
 *  file name on hover. */
export function FileChipCluster({ files, max = 10 }: { files: TouchedFile[]; max?: number }) {
  if (files.length === 0) return null;
  const shown = files.slice(0, max);
  const overflow = files.length - shown.length;
  return (
    <div className="cl-turn-files">
      {shown.map((f, i) => {
        const name = fileName(f.path);
        return (
          <span
            key={i}
            className="cl-file-chip"
            style={{ '--ft': fileCategoryTint(f.ext) } as CSSProperties}
            data-file={name}
            aria-label={name}
          >
            <FileIcon ext={f.ext} />
            {f.ext && <span className="cl-file-chip-ext">{f.ext}</span>}
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          className="cl-file-chip cl-file-chip--more"
          data-file={files
            .slice(max)
            .map(f => fileName(f.path))
            .join('\n')}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
