// The reader behind `images:read`, which hands the renderer a file's bytes as
// a `data:` URI — a primitive the app never had, so the claims here are the
// fences: where it will read, what it will read, and what it says otherwise.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readLocalImage, MAX_IMAGE_BYTES } from '../electron/modules/local-image';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('rest-of-the-png'),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jfif')]);

let inside: string;
let outside: string;

beforeEach(() => {
  inside = mkdtempSync(join(tmpdir(), 'cl-img-in-'));
  outside = mkdtempSync(join(tmpdir(), 'cl-img-out-'));
});

afterEach(() => {
  rmSync(inside, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('readLocalImage', () => {
  it('answers a png under an allowed base as a data URI typed by its bytes', async () => {
    // Named `.txt` on purpose: the type comes from the magic number, never
    // from the extension.
    const file = join(inside, 'shot.txt');
    writeFileSync(file, PNG);
    const answer = await readLocalImage(file, [inside]);
    expect(answer).toEqual({
      status: 'ok',
      dataUri: `data:image/png;base64,${PNG.toString('base64')}`,
      bytes: PNG.length,
    });
  });

  it('types a jpeg by its bytes too', async () => {
    const file = join(inside, 'a.png');
    writeFileSync(file, JPEG);
    const answer = await readLocalImage(file, [inside]);
    expect(answer.status).toBe('ok');
    expect((answer as { dataUri: string }).dataUri.startsWith('data:image/jpeg;base64,')).toBe(
      true
    );
  });

  it('refuses a file that is not a raster image, whatever it is called', async () => {
    const file = join(inside, 'id_rsa.png');
    writeFileSync(file, '-----BEGIN OPENSSH PRIVATE KEY-----');
    expect(await readLocalImage(file, [inside])).toEqual({
      status: 'refused',
      reason: 'not a raster image',
    });
  });

  it('refuses an svg: XML that can carry script is not a picture here', async () => {
    const file = join(inside, 'a.svg');
    writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
    expect((await readLocalImage(file, [inside])).status).toBe('refused');
  });

  it('refuses a path outside every base, and one that only looks inside', async () => {
    const file = join(outside, 'shot.png');
    writeFileSync(file, PNG);
    expect(await readLocalImage(file, [inside])).toEqual({
      status: 'refused',
      reason: 'outside the readable directories',
    });
    // A symlink planted inside pointing out: the canonical path is what counts.
    const link = join(inside, 'link.png');
    symlinkSync(file, link);
    expect((await readLocalImage(link, [inside])).status).toBe('refused');
    // And a lexical escape.
    expect((await readLocalImage(join(inside, '..', 'x.png'), [inside])).status).toBe('refused');
  });

  it('refuses a relative path', async () => {
    expect((await readLocalImage('shot.png', [inside])).status).toBe('refused');
  });

  it('says a file that is gone is missing, which is not a refusal', async () => {
    expect(await readLocalImage(join(inside, 'gone.png'), [inside])).toEqual({ status: 'missing' });
    // A file where a directory was expected on the way — same answer.
    writeFileSync(join(inside, 'f'), 'x');
    expect(await readLocalImage(join(inside, 'f', 'gone.png'), [inside])).toEqual({
      status: 'missing',
    });
  });

  it('refuses a directory', async () => {
    mkdirSync(join(inside, 'd.png'));
    expect((await readLocalImage(join(inside, 'd.png'), [inside])).status).toBe('refused');
  });

  it('refuses a file over the byte cap without reading it', async () => {
    const file = join(inside, 'huge.png');
    // A sparse file: the size is what is checked, before any bytes are read.
    writeFileSync(file, PNG);
    const { truncateSync } = await import('node:fs');
    truncateSync(file, MAX_IMAGE_BYTES + 1);
    const answer = await readLocalImage(file, [inside]);
    expect(answer.status).toBe('refused');
    expect((answer as { reason: string }).reason).toMatch(/larger than/);
  });

  it('matches a base given through a symlink to the real directory', async () => {
    // macOS: `/tmp` → `/private/tmp`, `/var` → `/private/var`. A base named
    // one way and a file named the other still meet.
    const file = join(inside, 'shot.png');
    writeFileSync(file, PNG);
    const alias = join(outside, 'alias');
    symlinkSync(inside, alias);
    expect((await readLocalImage(join(alias, 'shot.png'), [inside])).status).toBe('ok');
    expect((await readLocalImage(file, [alias])).status).toBe('ok');
  });
});
