import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { FileKindIcon } from './FileKindIcon';
import { fileName } from '../chat/file-view';
import { fileExt } from '../chat/utils';
import { FileTree, type FileTreePreview } from './FileTree';
import { RefreshFilesButton } from './ProjectFilesSection';
import type { FileMark, SessionMarks } from './session-marks';

const MARK_WORD: Record<FileMark, string> = { read: 'read', edited: 'edited', created: 'new' };

/** The files the session touched, flat and by path — the short answer to
 *  "what did this session work on", without opening a folder. */
function TouchedList({
  marks,
  openFile,
  onOpen,
}: {
  marks: SessionMarks;
  openFile: string | null;
  onOpen: (rel: string) => void;
}) {
  const rows = [...marks.files.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (rows.length === 0) {
    return <div className="cl-files-rail-empty">This session has not touched a project file.</div>;
  }
  return (
    <div className="cl-files-touched">
      {rows.map(([rel, mark]) => {
        const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
        const selected = rel === openFile;
        return (
          <button
            key={rel}
            type="button"
            className={`cl-files-touched-row${selected ? ' is-selected' : ''}`}
            aria-current={selected ? 'true' : undefined}
            title={rel}
            onClick={() => onOpen(rel)}
          >
            <FileKindIcon ext={fileExt(rel)} />
            <span className="text">
              <span className="name">{fileName(rel)}</span>
              {dir && <span className="dir">{dir}</span>}
            </span>
            <span className={`cl-ftree-mark is-${mark}`}>{MARK_WORD[mark]}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The project's files inside Mission Control's rail, where the Playbook opens:
 * the tree with what this session read, edited or created marked on it, or —
 * one click away — only those files. A click opens the file in the frame's wide
 * overlay, over the session, since the rail is too narrow to read a file in.
 * Escape closes the panel while focus is inside it, as the Playbook does; so
 * does the folder toggle in the rail's head, which is why the panel has no ✕ —
 * and the rail's title reads FILES while it is open, so the panel has no title
 * of its own either: its one row is what it shows and the refresh.
 */
export function FilesRailPanel({
  id,
  root,
  marks,
  openFile,
  onOpen,
  onClose,
  preview,
}: {
  id: string;
  root: string;
  marks: SessionMarks;
  /** The file the overlay shows, marked in the list it was opened from. */
  openFile: string | null;
  onOpen: (rel: string) => void;
  onClose: (restoreFocus?: boolean) => void;
  /** Fixed folders for the "What's new" popup, which also keeps the panel from
   *  taking the focus and Escape, both the popup's own there. */
  preview?: FileTreePreview;
}) {
  const [mode, setMode] = useState<'tree' | 'touched'>('tree');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!preview) ref.current?.focus();
  }, [preview]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || preview) return;
    e.stopPropagation();
    onClose(true);
  };
  const touched = marks.files.size;

  return (
    <div
      ref={ref}
      id={id}
      className="cl-files-rail"
      role="region"
      aria-label="Project files"
      tabIndex={-1}
      onKeyDown={onKey}
    >
      <div className="cl-files-rail-head">
        <div className="cl-files-rail-modes" role="group" aria-label="Show">
          <button type="button" aria-pressed={mode === 'tree'} onClick={() => setMode('tree')}>
            All
          </button>
          <button
            type="button"
            aria-pressed={mode === 'touched'}
            onClick={() => setMode('touched')}
          >
            This session{touched > 0 && <span className="ct"> {touched}</span>}
          </button>
        </div>
        <span style={{ flex: 1 }} />
        {!preview && <RefreshFilesButton root={root} />}
      </div>
      <div className="cl-files-rail-body">
        {mode === 'tree' ? (
          <FileTree
            root={root}
            marks={marks}
            selected={openFile}
            onSelect={onOpen}
            preview={preview}
          />
        ) : (
          <TouchedList marks={marks} openFile={openFile} onOpen={onOpen} />
        )}
      </div>
    </div>
  );
}
