import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  MAX_NOTES_BYTES,
  readSessionNotes,
  resetNotesWrites,
  writeSessionNotes,
} from '../electron/modules/notes-store';

const SESSION = '11111111-2222-4333-8444-555555555555';
let dir: string;
let root: string;

beforeEach(async () => {
  resetNotesWrites();
  dir = await mkdtemp(join(tmpdir(), 'notes-test-'));
  root = join(dir, 'notes');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('session notes store', () => {
  it('reads a session without notes as empty, without creating anything', async () => {
    expect(await readSessionNotes(root, SESSION)).toBe('');
    await expect(readdir(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writes one Markdown file per session and reads it back', async () => {
    const text = 'A thought\n- [ ] first\n- [x] second\n';
    await writeSessionNotes(root, SESSION, text);
    expect(await readFile(join(root, `${SESSION}.md`), 'utf8')).toBe(text);
    expect(await readSessionNotes(root, SESSION)).toBe(text);
    expect(await readSessionNotes(root, 'other-session')).toBe('');
  });

  it('removes the file when the notes are emptied', async () => {
    await writeSessionNotes(root, SESSION, 'keep me\n');
    await writeSessionNotes(root, SESSION, '  \n');
    expect(await readdir(root)).toEqual([]);
  });

  it('keeps the last of several quick writes and leaves no temp file', async () => {
    await Promise.all(['one\n', 'two\n', 'three\n'].map(t => writeSessionNotes(root, SESSION, t)));
    expect(await readSessionNotes(root, SESSION)).toBe('three\n');
    expect(await readdir(root)).toEqual([`${SESSION}.md`]);
  });

  it('refuses a session id that could leave the notes directory', async () => {
    for (const bad of ['../escape', 'a/b', '', 'x'.repeat(129), 42]) {
      expect(() => writeSessionNotes(root, bad, 'x')).toThrow('Invalid session id.');
      await expect(readSessionNotes(root, bad)).rejects.toThrow('Invalid session id.');
    }
  });

  it('refuses oversized or binary text', () => {
    expect(() => writeSessionNotes(root, SESSION, 'x'.repeat(MAX_NOTES_BYTES + 1))).toThrow(
      'Notes are too long.'
    );
    expect(() => writeSessionNotes(root, SESSION, 'a\0b')).toThrow('Invalid notes text.');
  });

  it('refuses a notes file that is a symbolic link', async () => {
    await mkdir(root, { recursive: true });
    const target = join(dir, 'elsewhere.md');
    await writeFile(target, 'outside\n');
    await symlink(target, join(root, `${SESSION}.md`));
    await expect(readSessionNotes(root, SESSION)).rejects.toThrow(/symbolic links/);
    await expect(writeSessionNotes(root, SESSION, 'over\n')).rejects.toThrow(/symbolic links/);
    expect(await readFile(target, 'utf8')).toBe('outside\n');
  });
});
