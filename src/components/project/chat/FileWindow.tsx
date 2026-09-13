import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import hljs from 'highlight.js/lib/common';
import { ToolGroup, isMemoryFile, fileExt, TOOL_TINT } from './utils';
import { resolveLang } from './code-lang';
import { CopyButton, IconButton, ExpandIcon, CloseIcon, SheetModal } from './CommandBlock';
import {
  contentRows,
  diffStat,
  fileName,
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

function highlightLine(text: string, language: string | null): string | null {
  if (!language || !text) return null;
  try {
    return hljs.highlight(text, { language }).value;
  } catch {
    return null;
  }
}

/** One line of the file. Highlighted on its own, like the terminal highlights
 *  each prompt row: a multi-line construct loses its state across rows, which
 *  is the price of rows that can be clamped, tinted and numbered one by one. */
function Line({ row, language }: { row: FileRow; language: string | null }) {
  const html = useMemo(() => highlightLine(row.text, language), [row.text, language]);
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
  meta: string;
  state: 'ok' | 'error' | 'pending';
  status: string;
  copyText: string;
  copyLabel: string;
};

type Body = Pick<Sheet, 'rows' | 'note' | 'status' | 'copyText' | 'copyLabel'> & { flag?: string };

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

function editBody(state: Sheet['state'], input: Record<string, unknown>, resultText: string): Body {
  const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
  const newStr = typeof input.new_string === 'string' ? input.new_string : '';
  const rows = lineDiff(oldStr, newStr);
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
        : editBody(state, input, resultText);
  const status = state === 'pending' ? 'running' : state === 'error' ? 'error' : body.status;
  const meta = [path ? shortDir(path) : '', body.flag].filter(Boolean).join(' · ');
  return { kind, path, meta, state, ...body, status };
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
}: {
  sheet: Sheet;
  language: string | null;
  memory: boolean;
  clamped: boolean;
  onToggleClamp?: () => void;
  onExpand?: () => void;
  onClose?: () => void;
  full?: boolean;
}) {
  const rows = sheet.rows ?? [];
  const shown = clamped ? rows.slice(0, ROW_CLAMP[sheet.kind]) : rows;
  const tint = memory ? 'var(--cl-violet)' : (TOOL_TINT[sheet.kind] ?? 'var(--cl-ink-3)');
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
          <b title={sheet.path}>{sheet.path ? fileName(sheet.path) : '(no file)'}</b>
          {sheet.meta && <span className="sep">—</span>}
          {sheet.meta && <span className="meta">{sheet.meta}</span>}
        </span>
        <span className="cl-term-actions">
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

      <div className={`cl-term-body cl-file-body${clamped ? ' is-clamped' : ''}`}>
        {shown.map((row, i) => (
          <Line key={i} row={row} language={language} />
        ))}
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
              {clamped ? `Show all ${rows.length} lines` : 'Collapse'}
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

  return (
    <>
      <EditorWindow
        sheet={sheet}
        language={language}
        memory={memory}
        clamped={clamped}
        onToggleClamp={total > clamp ? () => setExpanded(e => !e) : undefined}
        onExpand={total > 0 || sheet.note ? () => setFull(true) : undefined}
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
          />
        </SheetModal>
      )}
    </>
  );
}
