import { afterEach, describe, expect, it } from 'vitest';
import { resolveClaudeCommand } from '../electron/modules/terminal-manager';

// resolveClaudeCommand branches on process.platform; stub it so both branches are
// exercised on any runner (the integration test then proves the real spawn works
// on the actual OS — see terminal-spawn.integration.test.ts).
const realPlatform = process.platform;
const realComSpec = process.env.ComSpec;

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

afterEach(() => {
  setPlatform(realPlatform);
  if (realComSpec === undefined) delete process.env.ComSpec;
  else process.env.ComSpec = realComSpec;
});

describe('resolveClaudeCommand', () => {
  it('runs the bare binary on POSIX', () => {
    setPlatform('darwin');
    expect(resolveClaudeCommand()).toEqual({ command: 'claude', args: [] });
    expect(resolveClaudeCommand(['--resume', 'abc'])).toEqual({
      command: 'claude',
      args: ['--resume', 'abc'],
    });
  });

  it('wraps the claude.cmd shim in cmd.exe on Windows (regression for #110)', () => {
    setPlatform('win32');
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';
    // node-pty/CreateProcess cannot launch claude.cmd directly: it must go through
    // cmd.exe, never named as the bare `.cmd` (which fails with "File not found").
    const resolved = resolveClaudeCommand(['--resume', 'abc']);
    expect(resolved.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(resolved.args).toEqual(['/c', 'claude', '--resume', 'abc']);
  });

  it('falls back to cmd.exe when ComSpec is unset on Windows', () => {
    setPlatform('win32');
    delete process.env.ComSpec;
    expect(resolveClaudeCommand().command).toBe('cmd.exe');
  });
});
