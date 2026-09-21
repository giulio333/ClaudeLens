import { useContext, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { FileIcon } from './fileIcons';
import { SheetModal } from './CommandBlock';
import { resolveLang } from './code-lang';
import { changeRows, changeStat, fileName, highlightRows, markPairs, shortDir } from './file-view';
import type { FileRow } from './file-view';
import { fileCategoryTint, fileExt } from './utils';
import { DiffsOpenContext } from './diffs-open';
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
 * hunks under it, open by default. It is drawn on the page, in the page's own
 * light or dark palette, not as a window inside the turn: it is part of what
 * the turn said, not a tool card beside it. The header folds it, a control
 * opens it full-screen.
 *
 * Reads are not changes. They keep the icon chips: a turn that read twelve
 * files to edit one should show the one, and the twelve should not stand in
 * front of it.
 */
export function FileChangesStrip({ files }: { files: TouchedFile[] }) {
  const changed = files.filter(f => f.action !== 'read');
  const read = files.filter(f => f.action === 'read');
  if (files.length === 0) return null;
  return (
    <>
      {changed.length > 0 && (
        <div className="cl-file-changes">
          {changed.map(f => (
            <FileChange key={f.path} file={f} />
          ))}
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

function FileChange({ file }: { file: TouchedFile }) {
  // The pill's switch sets every diff at once; a click on this one moves only
  // this one, until the switch is flipped again.
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
  const setOpen = (next: (o: boolean) => boolean) => setLocal(next(open));
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
          <span className="cl-file-change-verb">{VERB[file.action]}</span>
          <span className="cl-file-change-icon" aria-hidden>
            <FileIcon ext={file.ext} />
          </span>
          <span className="cl-file-change-path">
            <b>{fileName(file.path)}</b>
            {dir !== '/' && <span className="cl-file-change-dir">{dir}</span>}
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
 *  Control opens: the strip's header with the whole path, every diff under it,
 *  unclamped. The frame around it supplies the crumb and the close. */
export function FileChangePage({ file }: { file: TouchedFile }) {
  const stat = changeStat(file.sources);
  return (
    <div className="cl-file-change cl-file-change--page is-open">
      <div className="cl-file-change-head">
        <span className="cl-file-change-toggle is-static">
          <span className="cl-file-change-verb">{VERB[file.action]}</span>
          <span className="cl-file-change-icon" aria-hidden>
            <FileIcon ext={file.ext} />
          </span>
          <span className="cl-file-change-path">
            <b>{fileName(file.path)}</b>
            <span className="cl-file-change-dir">{file.path}</span>
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
        </span>
      </div>
      <FileChangeDiffs file={file} clamp={false} />
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
