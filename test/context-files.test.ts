// The files a session read — what the Lens context rail draws.
//
// Two sources and two kinds of claim. A `Read` names its file and prints the
// lines it read, so path and span are facts. A shell command names files only
// in its text, and that is where most reading happens, so it is parsed — and
// the claims worth pinning are the refusals: a command that wrote, a construct
// we cannot follow, a directory, must name no file rather than a wrong one.

import { describe, it, expect } from 'vitest';
import {
  contextFiles,
  coverageLabel,
  groupContextFiles,
  nearestTurn,
  numberedSpan,
  readRows,
  shellReads,
  spanLabel,
} from '../src/components/project/chat/context-files';
import { buildProcessedMessages } from '../src/components/project/chat/utils';
import type { ChatContentBlock, ChatMessage } from '../src/types';

const CWD = '/w/acme';

type Use = Extract<ChatContentBlock, { type: 'tool_use' }>;
type Result = Extract<ChatContentBlock, { type: 'tool_result' }>;

const use = (id: string, name: string, input: Record<string, unknown>): Use => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const result = (toolUseId: string, content: string, extra: Partial<Result> = {}): Result => ({
  type: 'tool_result',
  toolUseId,
  content,
  isError: false,
  ...extra,
});

/** One assistant turn per call, each with its result — `n` turns in all. */
function transcript(calls: [Use, Result | null][]): ChatMessage[] {
  return calls.flatMap(([u, r], i): ChatMessage[] => [
    {
      uuid: `a${i}`,
      role: 'assistant',
      timestamp: `2026-09-22T10:00:${String(i).padStart(2, '0')}.000Z`,
      content: [{ type: 'text', text: `step ${i}` }, u],
    },
    ...(r
      ? [
          {
            uuid: `u${i}`,
            role: 'user' as const,
            timestamp: `2026-09-22T10:00:${String(i).padStart(2, '0')}.500Z`,
            content: [r],
          },
        ]
      : []),
  ]);
}

const paths = (cmd: string, cwd: string | null = CWD) => shellReads(cmd, cwd).map(r => r.path);

describe('shellReads — what a command read', () => {
  it('reads the span of a sed -n range, relative to the cwd', () => {
    expect(shellReads("sed -n '120,180p' src/a.ts", CWD)).toEqual([
      { path: '/w/acme/src/a.ts', span: { start: 120, end: 180 }, exact: true },
    ]);
    expect(shellReads('sed -n 7p src/a.ts', CWD)[0].span).toEqual({ start: 7, end: 7 });
    expect(shellReads("sed -n '30,$p' src/a.ts", CWD)[0].span).toEqual({ start: 30, end: null });
  });

  it('reads cat as the whole file and head as its first lines', () => {
    expect(shellReads('cat package.json', CWD)).toEqual([
      { path: '/w/acme/package.json', span: { start: 1, end: null }, exact: true },
    ]);
    expect(shellReads('head -n 40 src/a.ts', CWD)[0].span).toEqual({ start: 1, end: 40 });
    expect(shellReads('head -25 src/a.ts', CWD)[0].span).toEqual({ start: 1, end: 25 });
    expect(shellReads('head src/a.ts', CWD)[0].span).toEqual({ start: 1, end: 10 });
    expect(shellReads('tail -n +300 src/a.ts', CWD)[0].span).toEqual({ start: 300, end: null });
    expect(shellReads('tail -n 20 src/a.ts', CWD)[0].span).toBeNull();
  });

  it('counts a grep on named files, with no span, and skips a recursive one', () => {
    expect(shellReads('grep -n "touchedFiles" src/a.ts src/b.ts', CWD)).toEqual([
      { path: '/w/acme/src/a.ts', span: null, exact: false },
      { path: '/w/acme/src/b.ts', span: null, exact: false },
    ]);
    expect(paths('grep -rn touchedFiles src/')).toEqual([]);
    // -l and -c print names and counts, not the file.
    expect(paths('grep -l x src/a.ts')).toEqual([]);
    expect(paths('grep -c x src/a.ts')).toEqual([]);
    // -e takes the pattern, so every positional is a file.
    expect(paths('grep -n -e foo src/a.ts')).toEqual(['/w/acme/src/a.ts']);
  });

  it('reads no span through a pipe: the model saw what the pipe let through', () => {
    expect(shellReads("sed -n '760,1000p' src/a.ts | grep -n cl-turn", CWD)).toEqual([
      { path: '/w/acme/src/a.ts', span: null, exact: false },
    ]);
  });

  it('is exact only when the output is that one read, a cd aside', () => {
    expect(shellReads("cd src && sed -n '1,9p' a.ts", CWD)[0].exact).toBe(true);
    // Another statement printed into the same output.
    const compound = shellReads("wc -l src/a.ts; echo ===; sed -n '1,60p' src/a.ts", CWD);
    expect(compound).toEqual([
      { path: '/w/acme/src/a.ts', span: { start: 1, end: 60 }, exact: false },
    ]);
  });

  it('follows a cd, and only the first stage of a pipe', () => {
    expect(paths("cd electron && sed -n '1,20p' main.ts | head -5")).toEqual([
      '/w/acme/electron/main.ts',
    ]);
    expect(paths('cd /elsewhere && cat x.md')).toEqual(['/elsewhere/x.md']);
    expect(paths('cat a.ts; cat ../b.ts')).toEqual(['/w/acme/a.ts', '/w/b.ts']);
  });

  it('drops redirections with their target, and keeps the file read', () => {
    expect(paths("sed -n '1,5p' src/a.ts 2>/dev/null")).toEqual(['/w/acme/src/a.ts']);
    expect(paths('cat src/a.ts 2>&1')).toEqual(['/w/acme/src/a.ts']);
    expect(paths('cat src/a.ts &>/dev/null')).toEqual(['/w/acme/src/a.ts']);
  });

  it('keeps quoted paths whole', () => {
    expect(paths('cat "docs/My Notes.md"')).toEqual(['/w/acme/docs/My Notes.md']);
  });

  it('names nothing it cannot follow rather than a wrong file', () => {
    expect(paths('cat $DIR/a.ts')).toEqual([]);
    expect(paths('cat src/*.ts')).toEqual([]);
    expect(paths('cat $(git ls-files)')).toEqual([]);
    expect(paths("cat <<'EOF' > out.md\nhello\nEOF")).toEqual([]);
    // A relative path with no cwd to resolve against.
    expect(paths('cat a.ts', null)).toEqual([]);
    expect(paths('cd $X && cat a.ts')).toEqual([]);
    // `cd -` is the previous directory, not a folder named `-`.
    expect(paths('cd - && cat a.ts')).toEqual([]);
  });

  it('ignores sed that edits or rewrites, and every other command', () => {
    expect(paths("sed -i '' 's/a/b/' src/a.ts")).toEqual([]);
    expect(paths("sed 's/a/b/' src/a.ts")).toEqual([]);
    expect(paths('npm test')).toEqual([]);
    expect(paths('wc -l src/a.ts')).toEqual([]);
  });

  it('reads a range on one file only — on two, sed prints one stream', () => {
    const reads = shellReads("sed -n '1,5p' a.ts b.ts", CWD);
    expect(reads.map(r => r.span)).toEqual([null, null]);
  });
});

describe('shellReads — the home a ~ stands for', () => {
  const IN_HOME = '/Users/me/acme';

  it('expands a leading ~ to the home the project sits in', () => {
    expect(paths('cat ~/notes.md', IN_HOME)).toEqual(['/Users/me/notes.md']);
    expect(paths('cat ~/notes.md', '/home/me/acme')).toEqual(['/home/me/notes.md']);
    expect(paths('grep -n x ~/a.h b.h', IN_HOME)).toEqual(['/Users/me/a.h', '/Users/me/acme/b.h']);
  });

  it('follows a cd into the home, and the read after it is still exact', () => {
    expect(shellReads("cd ~/lib && sed -n '1,9p' a.h", IN_HOME)).toEqual([
      { path: '/Users/me/lib/a.h', span: { start: 1, end: 9 }, exact: true },
    ]);
    expect(paths('cd ~; cat notes.md', IN_HOME)).toEqual(['/Users/me/notes.md']);
    // A bare cd goes home too.
    expect(paths('cd && cat notes.md', IN_HOME)).toEqual(['/Users/me/notes.md']);
  });

  it('expands no other ~ — quoted or escaped it is a name, as to the shell', () => {
    expect(paths('cat "~/notes.md"', IN_HOME)).toEqual(['/Users/me/acme/~/notes.md']);
    expect(paths('cat \\~/notes.md', IN_HOME)).toEqual(['/Users/me/acme/~/notes.md']);
    // Another user's home and the directory stack: nothing we can know.
    expect(paths('cat ~bob/notes.md', IN_HOME)).toEqual([]);
    expect(paths('cat ~+/notes.md', IN_HOME)).toEqual([]);
  });

  it('names nothing when the path shows no home — never a ~ folder in the cwd', () => {
    expect(paths('cat ~/notes.md')).toEqual([]);
    expect(paths('cd ~/lib && cat a.h')).toEqual([]);
    expect(paths('cd && cat a.h')).toEqual([]);
    // A real folder of macOS, not anyone's home.
    expect(paths('cat ~/notes.md', '/Users/Shared/acme')).toEqual([]);
  });
});

describe('contextFiles — the session, read', () => {
  it('lists each file once, in first-read order, with every read', () => {
    const processed = buildProcessedMessages(
      transcript([
        [
          use('r1', 'Read', { file_path: '/w/acme/src/a.ts' }),
          result('r1', '    10\tconst a = 1;\n    11\texport {};\n'),
        ],
        [use('b1', 'Bash', { command: 'cat README.md' }), result('b1', '# Acme\n')],
        [use('r2', 'Read', { file_path: '/w/acme/src/a.ts' }), result('r2', '     1\timport x;\n')],
      ])
    );
    const files = contextFiles(processed, CWD);
    expect(files.map(f => f.path)).toEqual(['/w/acme/src/a.ts', '/w/acme/README.md']);
    const [a, readme] = files;
    expect(a.reads.map(r => [r.idx, r.via, r.span, r.exact])).toEqual([
      [0, 'Read', { start: 10, end: 11 }, true],
      [2, 'Read', { start: 1, end: 1 }, true],
    ]);
    expect(readme.reads[0].via).toBe('shell');
    expect(a.ext).toBe('ts');
  });

  it('leaves out what never reached the model: an error, a missing result', () => {
    const processed = buildProcessedMessages(
      transcript([
        [
          use('r1', 'Read', { file_path: '/w/acme/gone.ts' }),
          result('r1', 'File does not exist.', { isError: true }),
        ],
        [use('r2', 'Read', { file_path: '/w/acme/pending.ts' }), null],
      ])
    );
    expect(contextFiles(processed, CWD)).toEqual([]);
  });

  it('reads nothing from a shell command Claude Code recorded as a write', () => {
    const processed = buildProcessedMessages(
      transcript([
        [
          use('b1', 'Bash', { command: 'cat src/a.ts && sed -i s/a/b/ src/a.ts' }),
          result('b1', '', {
            bashEditDiff: { files: [], changedFiles: ['/w/acme/src/a.ts'], moreFiles: 0 },
          }),
        ],
      ])
    );
    expect(contextFiles(processed, CWD)).toEqual([]);
  });

  it('keeps an image read, with no span to show', () => {
    const processed = buildProcessedMessages(
      transcript([
        [
          use('r1', 'Read', { file_path: '/w/acme/shot.png' }),
          result('r1', '', { images: [{ mediaType: 'image/png', data: 'AAAA' }] }),
        ],
      ])
    );
    const [shot] = contextFiles(processed, CWD);
    expect(shot.reads[0].span).toBeNull();
    expect(readRows(shot.reads[0])).toEqual([]);
  });
});

describe('readRows — what the peek draws', () => {
  it('numbers a shell read from where its command said it started', () => {
    const processed = buildProcessedMessages(
      transcript([
        [
          use('b1', 'Bash', { command: "sed -n '40,41p' src/a.ts" }),
          result('b1', 'const a = 1;\nexport {};\n'),
        ],
      ])
    );
    const [file] = contextFiles(processed, CWD);
    expect(readRows(file.reads[0])).toEqual([
      { kind: 'ctx', text: 'const a = 1;', line: 40 },
      { kind: 'ctx', text: 'export {};', line: 41 },
    ]);
  });

  it('leaves a compound command unnumbered: its output is not the file', () => {
    const processed = buildProcessedMessages(
      transcript([
        [
          use('b1', 'Bash', { command: "wc -l src/a.ts; sed -n '40,41p' src/a.ts" }),
          result('b1', '  90 src/a.ts\nconst a = 1;\nexport {};\n'),
        ],
      ])
    );
    const [file] = contextFiles(processed, CWD);
    expect(file.reads[0].exact).toBe(false);
    expect(readRows(file.reads[0]).every(r => r.line === undefined)).toBe(true);
  });

  it('leaves unnumbered what it cannot number', () => {
    const processed = buildProcessedMessages(
      transcript([
        [use('b1', 'Bash', { command: 'grep -n x src/a.ts' }), result('b1', '12:x = 1\n')],
      ])
    );
    const [file] = contextFiles(processed, CWD);
    expect(readRows(file.reads[0])).toEqual([{ kind: 'ctx', text: '12:x = 1' }]);
  });
});

describe('groupContextFiles', () => {
  it('groups by folder in first-read order, labelled inside the project', () => {
    const files = [
      '/w/acme/src/components/chat/a.ts',
      '/w/acme/package.json',
      '/w/acme/src/components/chat/b.ts',
      '/tmp/scratch/notes.md',
    ].map(path => ({ path, ext: '', reads: [] }));
    const groups = groupContextFiles(files, CWD);
    expect(groups.map(g => [g.label, g.files.length])).toEqual([
      ['…/components/chat', 2],
      ['acme', 1],
      ['…/tmp/scratch', 1],
    ]);
    expect(groups[0].title).toBe('src/components/chat');
  });
});

describe('small pieces', () => {
  it('spanLabel says what the numbers say, and nothing when there are none', () => {
    expect(spanLabel({ start: 12, end: 40 })).toBe('lines 12–40');
    expect(spanLabel({ start: 7, end: 7 })).toBe('line 7');
    expect(spanLabel({ start: 1, end: null })).toBe('whole file');
    expect(spanLabel({ start: 30, end: null })).toBe('from line 30');
    expect(spanLabel(null)).toBeNull();
  });

  it('coverageLabel merges every read into the lines seen', () => {
    const read = (span: { start: number; end: number | null } | null) =>
      ({ span }) as Parameters<typeof coverageLabel>[0][number];
    expect(coverageLabel([read({ start: 1, end: 60 }), read({ start: 40, end: 80 })])).toBe(
      'lines 1–80'
    );
    expect(coverageLabel([read({ start: 385, end: 460 }), read({ start: 1, end: 60 })])).toBe(
      'lines 1–60, 385–460'
    );
    // Adjacent ranges are one range.
    expect(coverageLabel([read({ start: 1, end: 10 }), read({ start: 11, end: 20 })])).toBe(
      'lines 1–20'
    );
    expect(coverageLabel([read({ start: 7, end: 7 })])).toBe('line 7');
    expect(coverageLabel([read({ start: 1, end: null }), read({ start: 30, end: 40 })])).toBe(
      'whole file'
    );
    expect(coverageLabel([read({ start: 50, end: null }), read({ start: 1, end: 5 })])).toBe(
      'lines 1–5, 50–end'
    );
    expect(coverageLabel([read(null)])).toBeNull();
  });

  it('numberedSpan is the first and last number a Read printed', () => {
    expect(numberedSpan('   436→a\n   437→b\n')).toEqual({ start: 436, end: 437 });
    expect(numberedSpan('(no content)')).toBeNull();
  });

  it('nearestTurn finds the rendered turn a folded read belongs to', () => {
    expect(nearestTurn([1, 3, 7], 5)).toBe(3);
    expect(nearestTurn([1, 3, 7], 7)).toBe(7);
    expect(nearestTurn([3, 7], 2)).toBeNull();
  });
});
