import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { homeRelativePath } from '../shared/projectName';
import { FileTree } from './FileTree';
import { FileViewer } from './FileViewer';

/** Re-reads every folder and file of `root` the explorer has shown. Nothing
 *  watches a project's source tree, so this is how a reader asks for now. */
export function RefreshFilesButton({ root }: { root: string }) {
  const qc = useQueryClient();
  return (
    <button
      type="button"
      className="cl-files-refresh"
      title="Read the folder again"
      aria-label="Refresh files"
      onClick={() => {
        void qc.invalidateQueries({ queryKey: ['files:dir', root] });
        void qc.invalidateQueries({ queryKey: ['files:text', root] });
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
        aria-hidden="true"
      >
        <path d="M20 11a8 8 0 1 0-2.3 5.7" />
        <path d="M20 4v7h-7" />
      </svg>
    </button>
  );
}

/**
 * The project's files, read-only: the tree on the left, the selected file on
 * the right, drawn by what it is (see `FileViewer`). The Plugins page's split,
 * under the project hero like every other section.
 */
export function ProjectFilesSection({ project }: { project: { hash: string; realPath: string } }) {
  const root = project.realPath;
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <section className="cl-section cl-files-section">
      <div className="cl-files-split">
        <aside className="cl-files-tree">
          <div className="cl-files-tree-head">
            <span className="cl-files-tree-path" title={root}>
              {homeRelativePath(root)}
            </span>
            <RefreshFilesButton root={root} />
          </div>
          <FileTree key={root} root={root} selected={selected} onSelect={setSelected} />
        </aside>
        <div className="cl-files-pane">
          {selected ? (
            <FileViewer key={selected} root={root} rel={selected} />
          ) : (
            <div className="cl-files-empty">Pick a file to read it.</div>
          )}
        </div>
      </div>
    </section>
  );
}
