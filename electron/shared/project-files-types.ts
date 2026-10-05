// The project file explorer's answers — one definition shared by the main
// process (`electron/modules/project-files.ts`) and the renderer, which
// re-exports them from `src/types.ts`.

/** One entry of a directory listing. `rel` is relative to the project root,
 *  `/`-separated, and is what the next `listDir`/`readText` call sends back. */
export interface ProjectDirEntry {
  name: string;
  rel: string;
  kind: 'dir' | 'file';
  /** Lower-case extension without the dot, `''` for none or a directory. */
  ext: string;
  /** Bytes, files only. */
  size?: number;
}

export interface ProjectDirListing {
  entries: ProjectDirEntry[];
  /** The directory held more entries than a listing carries. */
  truncated: boolean;
}

/**
 * A file read for the explorer. Every outcome but `ok` is an answer, not an
 * error: a binary or an oversized file is something the viewer says and offers
 * to open elsewhere, and a file deleted since the listing is just gone.
 */
export type ProjectFileAnswer =
  | { status: 'ok'; text: string; bytes: number }
  | { status: 'missing' }
  | { status: 'binary'; bytes: number }
  | { status: 'too-large'; bytes: number }
  | { status: 'refused'; reason: string };
