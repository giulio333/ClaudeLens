import { useMemo, useState } from 'react';
import type { BashEditDiff, BashEditFile } from '../../../types';

/** Lines drawn before the block folds. The corpus median is 11 lines a hunk and
 *  the tail reaches 298 — enough that a single `sed` could otherwise push the
 *  whole conversation off screen. */
const DIFF_CLAMP = 24;

/**
 * What a shell command changed on disk, under the terminal window that ran it.
 *
 * An edit made from Bash — `sed -i`, a heredoc, a one-line script — produces no
 * `Edit` tool call, so before this the transcript showed the command and its
 * stdout and nothing about the file it rewrote (#265). Claude Code records the
 * hunks on the result row; this draws them.
 *
 * It lives inside `.cl-term`, so it inherits that shell's own palette: the diff
 * is part of the run, not a card beside it.
 */
export function BashEditDiffView({ diff }: { diff: BashEditDiff }) {
  const [full, setFull] = useState(false);

  const rows = useMemo(() => diff.files.flatMap(fileRows), [diff.files]);
  const clamped = !full && rows.length > DIFF_CLAMP;
  const shown = clamped ? rows.slice(0, DIFF_CLAMP) : rows;

  const changed = diff.changedFiles.length || diff.files.length;

  return (
    <div className="cl-term-diff">
      <div className="cl-term-diff-head">
        <span className="cl-term-diff-title">
          {changed} {changed === 1 ? 'file' : 'files'} changed
        </span>
        {diff.moreFiles > 0 && (
          <span className="cl-term-diff-more">{diff.moreFiles} not shown</span>
        )}
      </div>

      {diff.unavailable ? (
        // Not the same claim as an empty diff: the command changed files and
        // Claude Code could not say which lines.
        <div className="cl-term-diff-note">no diff was recorded for this run</div>
      ) : (
        <div className="cl-term-diff-body">
          {shown.map(row => (
            <div key={row.key} className={`cl-term-diff-row is-${row.kind}`}>
              {row.text}
            </div>
          ))}
        </div>
      )}

      {rows.length > DIFF_CLAMP && (
        <button type="button" className="cl-term-link" onClick={() => setFull(f => !f)}>
          {clamped ? `Show all ${rows.length} diff lines` : 'Collapse diff'}
        </button>
      )}
    </div>
  );
}

type DiffRow = { key: string; kind: 'path' | 'hunk' | 'add' | 'del' | 'ctx'; text: string };

/** One file as flat rows: its path, then each hunk's header and lines. Flat so
 *  the clamp counts what is actually on screen rather than whole files. */
function fileRows(file: BashEditFile): DiffRow[] {
  const stat = file.created ? ' · new file' : file.deleted ? ' · deleted' : '';
  const rows: DiffRow[] = [
    { key: `${file.filePath}:path`, kind: 'path', text: `${file.filePath}${stat}` },
  ];
  for (const [h, hunk] of file.hunks.entries()) {
    rows.push({
      key: `${file.filePath}:${h}`,
      kind: 'hunk',
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    });
    for (const [l, line] of hunk.lines.entries()) {
      rows.push({ key: `${file.filePath}:${h}:${l}`, kind: lineKind(line), text: line });
    }
  }
  return rows;
}

function lineKind(line: string): DiffRow['kind'] {
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'ctx';
}
