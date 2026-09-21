import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import Markdown from '../../Markdown';
import { ToolGroup, isMemoryFile, fileExt, TOOL_TINT } from './utils';
import { resolveLang } from './code-lang';
import { CopyButton, IconButton, ExpandIcon, CloseIcon, SheetModal } from './CommandBlock';
import {
  contentRows,
  diffStat,
  fileName,
  highlightRows,
  isMarkdownPath,
  hunkRows,
  lineDiff,
  lineRange,
  numberedRows,
  shortDir,
  writeOutcome,
} from './file-view';
import type { FileRow } from './file-view';

type FileKind = 'Read' | 'Write' | 'Edit';

/** Rows drawn before the window asks to be unfolded — a clamp and not a nested
 *  scroller, for the terminal's reason: a scrollbar inside a transcript that
 *  already scrolls swallows the wheel. Per kind, because the kinds are not the
 *  same news: an edit or a new file is what the turn did, a read is what it
 *  looked at on the way — the most frequent call and the least informative, so
 *  a turn of six reads must not be six tall dark slabs. */
const ROW_CLAMP: Record<FileKind, number> = { Read: 12, Write: 24, Edit: 24 };

const NO_ROWS: FileRow[] = [];

/** One line of the file, with the fragment `highlightRows` cut for it — the
 *  file is highlighted whole and split, never row by row, so a docstring that
 *  spans rows stays a string on every one of them. */
function Line({ row, html }: { row: FileRow; html: string | null }) {
  return (
    <div className={`cl-file-row is-${row.kind}`}>
      <span className="cl-file-ln" aria-hidden>
        {row.line ?? (row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : '')}
      </span>
      {html ? (
        <code className="cl-file-code hljs" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <code className="cl-file-code hljs">{row.text || ' '}</code>
      )}
    </div>
  );
}

type Sheet = {
  kind: FileKind;
  path: string;
  /** `null` when the result is not a file's rows (an image read, a marker). */
  rows: FileRow[] | null;
  /** Printed as it is when `rows` is null, or under them on an error. */
  note: string;
  /** Where the file sits, short enough for a title bar. The whole path is
   *  `path`: the fullscreen window prints it, and the bar copies it. */
  dir: string;
  /** `lines 436–497`, `replace all` — what the call asked for, beside the dir. */
  flag?: string;
  state: 'ok' | 'error' | 'pending';
  status: string;
  copyText: string;
  copyLabel: string;
};

type Body = Pick<Sheet, 'rows' | 'note' | 'status' | 'copyText' | 'copyLabel' | 'flag'>;

const lines = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;

function readBody(state: Sheet['state'], resultText: string): Body {
  // Pending: an empty file, so the body says it is still running. Error: no
  // rows at all, so the message prints as it is.
  const rows = state === 'ok' ? numberedRows(resultText) : state === 'pending' ? [] : null;
  const range = rows ? lineRange(rows) : null;
  return {
    rows,
    note: rows ? '' : resultText,
    flag: range ? `lines ${range}` : undefined,
    status: rows ? lines(rows.length) : 'read',
    copyText: rows ? rows.map(r => r.text).join('\n') : resultText,
    copyLabel: 'Copy content',
  };
}

function writeBody(
  state: Sheet['state'],
  input: Record<string, unknown>,
  resultText: string
): Body {
  const content = typeof input.content === 'string' ? input.content : '';
  const rows = contentRows(content);
  const verb = state === 'ok' ? writeOutcome(resultText) : 'write';
  return {
    rows,
    note: state === 'error' ? resultText : '',
    status: `${verb} · ${lines(rows.length)}`,
    copyText: content,
    copyLabel: 'Copy content',
  };
}

function editBody(
  state: Sheet['state'],
  input: Record<string, unknown>,
  result: ToolGroup['result'],
  resultText: string
): Body {
  const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
  const newStr = typeof input.new_string === 'string' ? input.new_string : '';
  // The result row's hunks carry the line numbers the input never states;
  // the diff of the two strings is what is left on a live turn, where the
  // stream does not return them.
  const rows = result?.patch?.length ? hunkRows(result.patch) : lineDiff(oldStr, newStr);
  const { added, removed } = diffStat(rows);
  return {
    rows,
    note: state === 'error' ? resultText : '',
    flag: input.replace_all === true ? 'replace all' : undefined,
    status: `${state === 'ok' ? 'updated' : 'edit'} · −${removed} +${added}`,
    copyText: newStr,
    copyLabel: 'Copy new text',
  };
}

/** What the window says, derived once from the tool call and its result. */
function buildSheet(
  kind: FileKind,
  input: Record<string, unknown>,
  result: ToolGroup['result']
): Sheet {
  const path = typeof input.file_path === 'string' ? input.file_path : '';
  const state: Sheet['state'] = !result ? 'pending' : result.isError ? 'error' : 'ok';
  const resultText = result?.content ?? '';
  const body =
    kind === 'Read'
      ? readBody(state, resultText)
      : kind === 'Write'
        ? writeBody(state, input, resultText)
        : editBody(state, input, result, resultText);
  const status = state === 'pending' ? 'running' : state === 'error' ? 'error' : body.status;
  return { kind, path, dir: path ? shortDir(path) : '', state, ...body, status };
}

/** The window: title bar (lights + tool verb + file name + where it sits), the
 *  file's rows with a gutter, a status strip. Same object inline and, with
 *  `full`, as the fullscreen panel. */
function EditorWindow({
  sheet,
  language,
  memory,
  clamped,
  onToggleClamp,
  onExpand,
  onClose,
  full,
  preview,
}: {
  sheet: Sheet;
  language: string | null;
  memory: boolean;
  clamped: boolean;
  onToggleClamp?: () => void;
  onExpand?: () => void;
  onClose?: () => void;
  full?: boolean;
  /** Present only when the file is markdown: `on` draws the document instead of
   *  its source. Undefined for every other file, which has no second reading. */
  preview?: { on: boolean; onToggle: () => void };
}) {
  const rows = sheet.rows ?? NO_ROWS;
  const shown = useMemo(
    () => (clamped ? rows.slice(0, ROW_CLAMP[sheet.kind]) : rows),
    [rows, clamped, sheet.kind]
  );
  // Only the rows on screen: hljs scans forward, so the clamped prefix gets
  // the same fragments the whole file would, and a 2000-line write folded to
  // 24 rows does not pay for 2000.
  const html = useMemo(() => highlightRows(shown, language), [shown, language]);
  const tint = memory ? 'var(--cl-violet)' : (TOOL_TINT[sheet.kind] ?? 'var(--cl-ink-3)');
  const [copied, setCopied] = useState(false);
  // The bar says where the file sits, shortened; fullscreen has the width to
  // say it whole. Either way a click copies the real path, because a path you
  // can read but not take is half a path.
  const meta = [full ? sheet.path : sheet.dir, sheet.flag].filter(Boolean).join(' · ');
  // Gutter wide enough for the largest number it has to hold.
  const digits = Math.max(2, ...rows.map(r => String(r.line ?? '').length));

  return (
    <div
      className={`cl-term cl-term--file${full ? ' is-full' : ''}${sheet.state === 'error' ? ' is-error' : ''}`}
      style={{ '--tint': tint, '--gutter': `${digits}ch` } as CSSProperties}
    >
      <div className="cl-term-bar">
        <span className="cl-term-lights" aria-hidden>
          <i className="r" />
          <i className="y" />
          <i className="g" />
        </span>
        <span className="cl-term-title">
          <span className="cl-term-kind">{sheet.kind}</span>
          {memory && <span className="cl-term-kind is-memory">memory</span>}
          <b>{sheet.path ? fileName(sheet.path) : '(no file)'}</b>
          {meta && <span className="sep">—</span>}
          {meta && sheet.path && (
            <button
              type="button"
              className={`meta${copied ? ' is-copied' : ''}`}
              title={copied ? 'Copied' : `${sheet.path} — click to copy`}
              onClick={() => {
                void navigator.clipboard.writeText(sheet.path).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {meta}
            </button>
          )}
          {meta && !sheet.path && <span className="meta">{meta}</span>}
        </span>
        <span className="cl-term-actions">
          {preview && (
            <button
              type="button"
              className="cl-term-mode"
              onClick={preview.onToggle}
              title={preview.on ? 'Show the markdown source' : 'Render the markdown'}
            >
              {preview.on ? 'Source' : 'Preview'}
            </button>
          )}
          {sheet.copyText && <CopyButton text={sheet.copyText} label={sheet.copyLabel} />}
          {onExpand && (
            <IconButton label="Open fullscreen" onClick={onExpand}>
              <ExpandIcon />
            </IconButton>
          )}
          {onClose && (
            <IconButton label="Close fullscreen" onClick={onClose}>
              <CloseIcon />
            </IconButton>
          )}
        </span>
      </div>

      <div
        className={`cl-term-body cl-file-body${preview?.on ? ' is-preview' : ''}${
          clamped ? ' is-clamped' : ''
        }`}
      >
        {preview?.on ? (
          <div className="cl-file-preview">
            <Markdown>{sheet.copyText}</Markdown>
          </div>
        ) : (
          shown.map((row, i) => <Line key={i} row={row} html={html[i]} />)
        )}
        {sheet.rows && sheet.rows.length === 0 && sheet.state !== 'error' && (
          <div className="cl-term-note">
            {sheet.state === 'pending' ? 'still running — no result recorded yet' : 'empty file'}
          </div>
        )}
        {sheet.note && (
          <div className="cl-term-out">
            <code>{sheet.note}</code>
          </div>
        )}
      </div>

      <div className="cl-term-foot">
        <span className={`cl-term-state is-${sheet.state}`}>
          <i aria-hidden />
          {sheet.status}
        </span>
        <span className="cl-term-foot-actions">
          {onToggleClamp && (
            <button type="button" className="cl-term-link" onClick={onToggleClamp}>
              {clamped ? (preview?.on ? 'Show all' : `Show all ${rows.length} lines`) : 'Collapse'}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

/** A file tool call — `Read`, `Write`, `Edit` — drawn as the editor window it
 *  was: the file's own rows with their line numbers for a read, the diff for an
 *  edit (removed lines, then the lines that replaced them), the new content for
 *  a write. The result's "The file … has been updated successfully." is the
 *  status strip, not a block of its own; an error prints under the rows, the
 *  way stderr prints under a command. */
export function FileSheet({
  name,
  input,
  result,
}: {
  name: string;
  input: Record<string, unknown>;
  result: ToolGroup['result'];
}) {
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState(false);

  const kind: FileKind = name === 'Read' || name === 'Write' ? name : 'Edit';
  const sheet = useMemo(() => buildSheet(kind, input, result), [kind, input, result]);
  const language = resolveLang(fileExt(sheet.path));
  const memory = isMemoryFile(input);
  const total = sheet.rows?.length ?? 0;
  const clamp = ROW_CLAMP[kind];
  const clamped = !expanded && total > clamp;

  // A markdown file has a second reading: the document it is. A write of one is
  // the document the turn produced, so that is the one that opens; a read is a
  // slice of a file, numbered where it started, so its rows stay and the
  // document is one click away. An edit is a diff and has no second reading.
  const markdown = kind !== 'Edit' && sheet.state === 'ok' && isMarkdownPath(sheet.path);
  const [asDocument, setAsDocument] = useState(kind === 'Write');
  const preview =
    markdown && sheet.copyText
      ? { on: asDocument, onToggle: () => setAsDocument(d => !d) }
      : undefined;

  return (
    <>
      <EditorWindow
        sheet={sheet}
        language={language}
        memory={memory}
        clamped={clamped}
        onToggleClamp={total > clamp ? () => setExpanded(e => !e) : undefined}
        onExpand={total > 0 || sheet.note ? () => setFull(true) : undefined}
        preview={preview}
      />
      {full && (
        <SheetModal onClose={() => setFull(false)}>
          <EditorWindow
            sheet={sheet}
            language={language}
            memory={memory}
            clamped={false}
            onClose={() => setFull(false)}
            full
            preview={preview}
          />
        </SheetModal>
      )}
    </>
  );
}
