import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execClaude, spawnClaude, ExecClaudeError } from '../electron/modules/claude-cli';

const E2E = process.env.CLAUDE_E2E === '1';

// ── Unit (POSIX): un finto `claude` nel PATH pilota i percorsi success/failure
// in modo deterministico. Su Windows lo shim sh non funziona: lì la copertura
// arriva dal blocco E2E sotto, che gira nel job CI `terminal-integration`.
describe.skipIf(process.platform === 'win32')('claude-cli (fake CLI on PATH)', () => {
  let binDir: string;

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), 'cl-cli-'));
    const script = [
      '#!/bin/sh',
      'if [ "$1" = "fail" ]; then echo boom >&2; exit 3; fi',
      'echo "hello $1"',
    ].join('\n');
    writeFileSync(join(binDir, 'claude'), script, 'utf-8');
    chmodSync(join(binDir, 'claude'), 0o755);
  });

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  it('execClaude risolve con lo stdout a exit 0', async () => {
    const { stdout } = await execClaude(['world'], { env: { PATH: binDir } });
    expect(stdout.trim()).toBe('hello world');
  });

  it('execClaude rigetta con exitCode e stderr su exit non-zero', async () => {
    const e = (await execClaude(['fail'], { env: { PATH: binDir } }).catch(
      err => err
    )) as ExecClaudeError;
    expect(e).toBeInstanceOf(Error);
    expect(e.exitCode).toBe(3);
    expect(e.stderr).toContain('boom');
  });

  it('execClaude rigetta con code ENOENT quando la CLI manca dal PATH', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'cl-empty-'));
    try {
      const e = (await execClaude(['x'], { env: { PATH: empty } }).catch(
        err => err
      )) as ExecClaudeError;
      expect(e.code).toBe('ENOENT');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

// ── E2E (matrix win/linux/mac, vera CLI installata — vedi ci.yml
// `terminal-integration`): su Windows prova che cross-spawn risolve
// `claude.cmd`, il cuore di #60. `--version` non richiede auth.
describe.skipIf(!E2E)('claude-cli (real claude CLI)', () => {
  it('execClaude esegue `claude --version`', async () => {
    const { stdout } = await execClaude(['--version']);
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  }, 35_000);

  it('spawnClaude streama stdout ed esce 0', async () => {
    const proc = spawnClaude(['--version']);
    let out = '';
    proc.stdout?.on('data', (c: Buffer) => {
      out += c.toString();
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      proc.on('error', reject);
      proc.on('close', resolve);
    });
    expect(code).toBe(0);
    expect(out).toMatch(/\d+\.\d+\.\d+/);
  }, 35_000);
});
