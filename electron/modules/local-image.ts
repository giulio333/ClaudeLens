// The image a message links by path — `![seg](/private/tmp/…/seg.png)` — read
// for the renderer, which cannot read it itself.
//
// The renderer runs sandboxed on `file://` under `img-src 'self' data:`, so a
// markdown image pointing at the filesystem is a broken glyph: resolved
// against the app's origin, never against the disk. Turning the path into a
// `data:` URI in the main process is the one route the CSP already allows —
// and it makes this handler a "read any file and hand its bytes to the
// renderer" primitive, which the app never had. So it is fenced three ways:
//
//   - containment: the canonical path (symlinks resolved, see `canonicalize`)
//     has to sit under one of the allowed bases — the home, the system temp
//     dir, `/tmp`, and the project root when the caller knows it. The temp
//     dirs are not a nicety: Claude Code's scratchpad, where Claude writes the
//     images it renders for the user, is `/private/tmp/claude-<uid>/…`;
//   - the bytes have to BE an image: the type comes from the magic number,
//     never from the extension, so `![x](/Users/me/.ssh/id_rsa)` in a
//     transcript is refused rather than shipped to the renderer as a
//     "png" that fails to decode. No SVG: it is XML that can carry script,
//     and an `<img>` is not the only place a data URI can end up;
//   - a byte cap, since the answer crosses IPC as one string.
//
// A miss is a distinct answer, not an error: scratchpad files are cleaned up,
// and a transcript read months later links images that are gone. The
// renderer says so instead of drawing the browser's broken-image icon.

import { promises as fsp } from 'fs';
import { isAbsolute, sep } from 'path';
import { canonicalize } from '../utils';

export type LocalImageAnswer =
  | { status: 'ok'; dataUri: string; bytes: number }
  | { status: 'missing' }
  | { status: 'refused'; reason: string };

/** Above this the answer is refused: a data URI this size is a renderer stall. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** The magic numbers of the raster types an `<img>` can draw, and nothing else. */
function sniffMediaType(head: Buffer): string | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    head.length >= 6 &&
    (head.subarray(0, 6).equals(GIF87) || head.subarray(0, 6).equals(GIF89))
  ) {
    return 'image/gif';
  }
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('ascii') === 'RIFF' &&
    head.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d) return 'image/bmp';
  return null;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF87 = Buffer.from('GIF87a', 'ascii');
const GIF89 = Buffer.from('GIF89a', 'ascii');

function isUnder(resolved: string, base: string): boolean {
  const b = canonicalize(base);
  return resolved === b || resolved.startsWith(b + sep);
}

/**
 * Read `filePath` as a `data:` URI when it is an image under one of `bases`.
 *
 * `bases` are canonicalized here too: on macOS the home and the temp dir are
 * both behind symlinks (`/tmp` → `/private/tmp`, `/var` → `/private/var`), so
 * a path that is legitimately inside them only matches once both sides are
 * real.
 */
export async function readLocalImage(
  filePath: string,
  bases: readonly string[]
): Promise<LocalImageAnswer> {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
    return { status: 'refused', reason: 'not an absolute path' };
  }
  const resolved = canonicalize(filePath);
  if (!bases.some(base => isUnder(resolved, base))) {
    return { status: 'refused', reason: 'outside the readable directories' };
  }

  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(resolved, 'r');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'missing' };
    return { status: 'refused', reason: code ?? 'unreadable' };
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return { status: 'refused', reason: 'not a file' };
    if (stat.size > MAX_IMAGE_BYTES) {
      return { status: 'refused', reason: `larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB` };
    }
    const head = Buffer.alloc(12);
    const { bytesRead } = await handle.read(head, 0, 12, 0);
    const mediaType = sniffMediaType(head.subarray(0, bytesRead));
    if (!mediaType) return { status: 'refused', reason: 'not a raster image' };
    const bytes = await handle.readFile();
    return {
      status: 'ok',
      dataUri: `data:${mediaType};base64,${bytes.toString('base64')}`,
      bytes: bytes.length,
    };
  } finally {
    await handle.close();
  }
}
