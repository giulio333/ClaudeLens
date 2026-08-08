import { describe, expect, it } from 'vitest';
import { readFile } from 'fs/promises';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

// A stray control character in a source file is invisible in an editor and
// silently hostile to tooling. A raw U+0000 is the worst of them: ripgrep drops
// the whole file from its results WITHOUT saying so (VS Code's search and the
// Grep tool both run on ripgrep), and once one lands in the first 8000 bytes git
// classifies the file as binary and `diff`, `blame` and GitHub review go blank.
//
// This has already happened once: `session-reader.ts` carried a literal NUL as
// the separator of a cache key, so `rg` silently omitted the module that defines
// the app's whole SDK read path — while `session-read-cache.ts`, three lines of
// comment away, warned about exactly that failure.
//
// The check is textual on purpose. ESLint works on the AST, where the offending
// byte is just an ordinary character inside a string literal and no rule fires.

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..');

const SOURCE_GLOBS = ['electron/**/*.ts', 'src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}'];

/** Control bytes a source file may legitimately contain. */
const ALLOWED = new Set([0x09, 0x0a, 0x0d]); // tab, LF, CR

interface Offence {
  file: string;
  line: number;
  column: number;
  byte: number;
}

/** Every disallowed control byte in `buf`, located for a human. */
function controlBytes(file: string, buf: Buffer): Offence[] {
  const found: Offence[] = [];
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte === 0x0a) {
      line++;
      lineStart = i + 1;
      continue;
    }
    if (byte >= 0x20 || ALLOWED.has(byte)) continue;
    found.push({ file, line, column: i - lineStart + 1, byte });
  }
  return found;
}

describe('source files', () => {
  it('contain no raw control characters', async () => {
    const files = (
      await Promise.all(SOURCE_GLOBS.map(pattern => glob(pattern, { cwd: ROOT, absolute: true })))
    ).flat();
    // Guard the guard: a broken glob would make this test pass by checking nothing.
    expect(files.length).toBeGreaterThan(50);

    const offences: Offence[] = [];
    for (const file of files) {
      offences.push(...controlBytes(relative(ROOT, file), await readFile(file)));
    }

    expect(
      offences.map(
        o => `${o.file}:${o.line}:${o.column} — U+${o.byte.toString(16).padStart(4, '0')}`
      )
    ).toEqual([]);
  });
});
