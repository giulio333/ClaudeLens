import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useProjectDir } from '../../../hooks/useIPC';
import type { ProjectDirEntry } from '../../../types';
import { FileKindIcon } from './FileKindIcon';
import type { FileMark, SessionMarks } from './session-marks';

/** The word a mark prints. `new` and not `created`: it is read beside a name. */
const MARK_WORD: Record<FileMark, string> = { read: 'read', edited: 'edited', created: 'new' };
const MARK_LABEL: Record<FileMark, string> = {
  read: 'read in this session',
  edited: 'edited in this session',
  created: 'created in this session',
};

function Chevron() {
  return (
    <svg className="tri" width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** What the session did, as a word beside the name. A folder carries the
 *  strongest mark below it, quieter: it says "look inside", not "this". */
function Mark({ mark, folder }: { mark: FileMark | undefined; folder?: boolean }) {
  if (!mark) return null;
  return (
    <span
      className={`cl-ftree-mark is-${mark}${folder ? ' is-folder' : ''}`}
      title={folder ? `something here was ${MARK_WORD[mark]}` : MARK_LABEL[mark]}
    >
      {MARK_WORD[mark]}
    </span>
  );
}

type TreeProps = {
  root: string;
  marks?: SessionMarks;
  selected: string | null;
  onSelect: (rel: string) => void;
  expanded: ReadonlySet<string>;
  onToggle: (rel: string) => void;
};

function Row({ entry, ...tree }: TreeProps & { entry: ProjectDirEntry }) {
  if (entry.kind === 'file') {
    const selected = tree.selected === entry.rel;
    return (
      <button
        type="button"
        data-tree-row=""
        className={`cl-ftree-row is-file${selected ? ' is-selected' : ''}`}
        aria-current={selected ? 'true' : undefined}
        onClick={() => tree.onSelect(entry.rel)}
      >
        <FileKindIcon ext={entry.ext} />
        <span className="name">{entry.name}</span>
        <Mark mark={tree.marks?.files.get(entry.rel)} />
      </button>
    );
  }
  const open = tree.expanded.has(entry.rel);
  return (
    <>
      <button
        type="button"
        data-tree-row=""
        data-dir={entry.rel}
        className="cl-ftree-row is-dir"
        aria-expanded={open}
        onClick={() => tree.onToggle(entry.rel)}
      >
        <span className="lead" aria-hidden>
          <Chevron />
        </span>
        <span className="name">{entry.name}</span>
        <Mark mark={tree.marks?.dirs.get(entry.rel)} folder />
      </button>
      {open && (
        <div className="cl-ftree-children">
          <Level {...tree} rel={entry.rel} />
        </div>
      )}
    </>
  );
}

/** One directory's entries, read when it is first opened. */
function Level({ rel, ...tree }: TreeProps & { rel: string }) {
  const { data, isPending, error } = useProjectDir(tree.root, rel);
  if (isPending) return <div className="cl-ftree-note">Loading…</div>;
  if (error || !data) {
    return (
      <div className="cl-ftree-note is-error">
        {error instanceof Error ? error.message : 'Could not read this folder'}
      </div>
    );
  }
  if (data.entries.length === 0) return <div className="cl-ftree-note">empty</div>;
  return (
    <>
      {data.entries.map(entry => (
        <Row key={entry.rel} {...tree} entry={entry} />
      ))}
      {data.truncated && (
        <div className="cl-ftree-note">Listing cut at {data.entries.length} entries</div>
      )}
    </>
  );
}

/** ↑↓ walk the rows on screen, → opens a folder, ← closes it. Over the DOM
 *  rather than a flattened model: each folder is its own query, and the rows
 *  on screen are already the visible order. */
function onTreeKey(e: KeyboardEvent<HTMLDivElement>, onToggle: (rel: string) => void) {
  const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-tree-row]')];
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = rows[at < 0 ? 0 : at + (e.key === 'ArrowDown' ? 1 : -1)];
    next?.focus();
    return;
  }
  const row = rows[at];
  const dir = row?.dataset.dir;
  if (dir === undefined) return;
  const open = row.getAttribute('aria-expanded') === 'true';
  if ((e.key === 'ArrowRight' && !open) || (e.key === 'ArrowLeft' && open)) {
    e.preventDefault();
    onToggle(dir);
  }
}

/**
 * The project tree, read one folder at a time as the reader opens it. Names
 * and little else: a chevron for a folder, a language's logo where a file has
 * one, a hairline down each open folder — the Plugins tree's guide. `.git`,
 * the build and dependency dirs and the OS's own litter are left out (see
 * `electron/modules/project-files.ts`). With `marks`, what a session read,
 * edited or created is a word beside the name, and beside every folder above.
 */
export function FileTree({
  root,
  marks,
  selected,
  onSelect,
}: {
  root: string;
  marks?: SessionMarks;
  selected: string | null;
  onSelect: (rel: string) => void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = (rel: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  return (
    <div className="cl-ftree" aria-label="Project files" onKeyDown={e => onTreeKey(e, onToggle)}>
      <Level
        root={root}
        marks={marks}
        selected={selected}
        onSelect={onSelect}
        expanded={expanded}
        onToggle={onToggle}
        rel=""
      />
    </div>
  );
}
