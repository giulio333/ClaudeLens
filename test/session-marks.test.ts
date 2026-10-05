// What the explorer marks as touched by a session, and how it draws a file.
// The marks' claims: a path is placed relative to the project root or not at
// all — never on the wrong file — the strongest thing done to a file wins, a
// folder carries the strongest mark below it, and only calls that wrote count
// toward the re-read key.

import { describe, expect, it } from 'vitest';
import { relToRoot, sessionMarks } from '../src/components/project/files/session-marks';
import {
  fmtBytes,
  joinRoot,
  lineCount,
  viewerKind,
} from '../src/components/project/files/file-viewer';
import { touchedFiles } from '../src/components/project/chat/utils';
import type { ToolGroup } from '../src/components/project/chat/utils';

const ROOT = '/w/acme';

function call(id: string, name: string, input: Record<string, unknown>, content = ''): ToolGroup {
  return {
    use: { type: 'tool_use', id, name, input },
    result: { type: 'tool_result', toolUseId: id, content, isError: false },
  } as ToolGroup;
}

describe('relToRoot', () => {
  it('places an absolute path under the root and a relative one as written', () => {
    expect(relToRoot('/w/acme/src/a.ts', ROOT)).toBe('src/a.ts');
    expect(relToRoot('src/./a.ts', ROOT)).toBe('src/a.ts');
    expect(relToRoot('/w/acme/src/a.ts', '/w/acme/')).toBe('src/a.ts');
  });

  it('refuses what is outside the root, a sibling with the same prefix, or a climb', () => {
    expect(relToRoot('/w/other/a.ts', ROOT)).toBeNull();
    expect(relToRoot('/w/acme-old/a.ts', ROOT)).toBeNull();
    expect(relToRoot('../x.ts', ROOT)).toBeNull();
    expect(relToRoot('/w/acme', ROOT)).toBeNull();
  });

  it('reads a Windows path with either separator', () => {
    expect(relToRoot('C:\\w\\acme\\src\\a.ts', 'C:\\w\\acme')).toBe('src/a.ts');
  });
});

describe('sessionMarks', () => {
  const touched = () =>
    touchedFiles([
      call('1', 'Read', { file_path: '/w/acme/README.md' }),
      call('2', 'Read', { file_path: '/w/acme/src/lib/a.ts' }),
      call('3', 'Edit', { file_path: '/w/acme/src/lib/a.ts', old_string: 'a', new_string: 'b' }),
      call('4', 'Edit', { file_path: '/w/acme/src/lib/a.ts', old_string: 'b', new_string: 'c' }),
      call(
        '5',
        'Write',
        { file_path: '/w/acme/src/new.ts', content: 'x' },
        'File created successfully at: /w/acme/src/new.ts'
      ),
      call('6', 'Read', { file_path: '/elsewhere/notes.md' }),
    ]);

  it('marks each file with the strongest thing done to it, under the root only', () => {
    const { files } = sessionMarks(touched(), ROOT);
    expect(Object.fromEntries(files)).toEqual({
      'README.md': 'read',
      'src/lib/a.ts': 'edited',
      'src/new.ts': 'created',
    });
  });

  it('carries the strongest mark below each folder up to it', () => {
    const { dirs } = sessionMarks(touched(), ROOT);
    expect(Object.fromEntries(dirs)).toEqual({ src: 'created', 'src/lib': 'edited' });
  });

  it('marks the files shell commands read, and lets an edit of the same file win', () => {
    const { files, dirs } = sessionMarks(touched(), ROOT, [
      '/w/acme/docs/guide.md',
      '/w/acme/src/lib/a.ts',
      '/elsewhere/x.md',
    ]);
    expect(files.get('docs/guide.md')).toBe('read');
    expect(files.get('src/lib/a.ts')).toBe('edited');
    expect(dirs.get('docs')).toBe('read');
    expect(files.has('x.md')).toBe(false);
  });

  it('drops a file the session deleted, but still marks its folder', () => {
    const marks = sessionMarks(
      touchedFiles([
        {
          use: { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'rm old.ts' } },
          result: {
            type: 'tool_result',
            toolUseId: 'b',
            content: '',
            isError: false,
            bashEditDiff: {
              files: [{ filePath: '/w/acme/src/old.ts', deleted: true, hunks: [] }],
              changedFiles: ['/w/acme/src/old.ts'],
            },
          },
        } as unknown as ToolGroup,
      ]),
      ROOT,
      ['/w/acme/src/old.ts']
    );
    expect(marks.files.has('src/old.ts')).toBe(false);
    expect(marks.dirs.get('src')).toBe('edited');
  });

  it('counts only the calls that wrote a file', () => {
    const { writes } = sessionMarks(touched(), ROOT);
    expect(Object.fromEntries(writes)).toEqual({ 'src/lib/a.ts': 2, 'src/new.ts': 1 });
  });
});

describe('viewerKind', () => {
  it('draws only raster images as pictures, and markdown as a document', () => {
    expect(viewerKind('a/logo.PNG')).toBe('image');
    expect(viewerKind('icon.svg')).toBe('text');
    expect(viewerKind('index.html')).toBe('text');
    expect(viewerKind('docs/README.md')).toBe('markdown');
    expect(viewerKind('spec.pdf')).toBe('external');
    expect(viewerKind('Makefile')).toBe('text');
    expect(viewerKind('.env.example')).toBe('text');
  });
});

describe('lineCount', () => {
  it('counts lines as a reader does: a trailing newline opens none', () => {
    expect(lineCount('one\ntwo\n')).toBe(2);
    expect(lineCount('one\ntwo')).toBe(2);
    expect(lineCount('')).toBe(0);
  });
});

describe('joinRoot and fmtBytes', () => {
  it('joins with the root separator', () => {
    expect(joinRoot('/w/acme/', 'src/a.ts')).toBe('/w/acme/src/a.ts');
    expect(joinRoot('C:\\w\\acme', 'src/a.ts')).toBe('C:\\w\\acme\\src\\a.ts');
  });

  it('prints a size the way a reader says it', () => {
    expect(fmtBytes(840)).toBe('840 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
    expect(fmtBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
