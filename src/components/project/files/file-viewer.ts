import { isMarkdownPath, splitLines } from '../chat/file-view';

/**
 * How the explorer shows a file, from its extension. Only the raster images an
 * `<img>` draws are pictures (read through `images:read`, which sniffs the
 * bytes anyway); SVG and HTML are source, never rendered — they are markup
 * that can carry script. A PDF and the office and media formats are not worth
 * a read that can only answer `binary`: they open in their own app. Anything
 * else is read as text, and the read itself says when it is not.
 */
export type ViewerKind = 'image' | 'markdown' | 'text' | 'external';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
const EXTERNAL_EXTS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'zip',
  'gz',
  'tgz',
  'dmg',
  'mp3',
  'mp4',
  'mov',
  'wav',
  'sqlite',
  'db',
]);

export function viewerKind(path: string): ViewerKind {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (EXTERNAL_EXTS.has(ext)) return 'external';
  if (isMarkdownPath(path)) return 'markdown';
  return 'text';
}

/** Past this many lines a file is drawn without syntax colour. Measured, not
 *  guessed: hljs takes ~110 ms over this repo's 22k-line `index.css`, so the
 *  1 MB read cap is the real bound and this only catches a generated file of
 *  short lines. It was 5000, and a project's own stylesheet came out grey. */
export const HIGHLIGHT_MAX_LINES = 40_000;

/** Lines as a reader counts them: a trailing newline does not open one more. */
export function lineCount(text: string): number {
  return splitLines(text).length;
}

/** `rel` under `root`, absolute, for the reads that take a path (`images:read`). */
export function joinRoot(root: string, rel: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root.replace(/[/\\]+$/, '')}${sep}${sep === '\\' ? rel.replace(/\//g, '\\') : rel}`;
}

/** `1.2 MB`, `840 B` — the size a too-large or binary file is described by. */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
