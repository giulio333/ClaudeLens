// The pure half of `ImageFigure.tsx`, kept apart so that file exports only
// components (fast refresh, `--max-warnings 0`) — same split as
// `vault-link-engine` / `VaultLinks`.
import type { ChatImage } from '../types';

/** The `data:` URI of an image the transcript carries inline. */
export function imageDataUri(image: ChatImage): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

/** Where an `<img src>` in markdown points: inline data, a file on disk, or
 *  somewhere the renderer draws as it is (`http`, which the CSP blocks anyway). */
export function localImagePath(src: string, root: string | null): string | null {
  if (src.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(src).pathname);
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
  if (src.startsWith('/')) return src;
  // `~/x.png` cannot be resolved here — the home is the main process' to know
  // — but it is a path, and the reader expands nothing; send it as a root-
  // relative name so it is refused with a reason rather than drawn broken.
  if (root && !src.startsWith('~')) return `${root.replace(/\/$/, '')}/${src}`;
  return null;
}
