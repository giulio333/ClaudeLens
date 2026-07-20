import { afterEach, describe, expect, it } from 'vitest';
import { resolveClaudeCommand, findClaudeOnWindowsPath } from '../electron/modules/terminal-manager';

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
    // Force the shim branch (inject a .cmd resolution) so the test is independent
    // of whatever `claude` happens to be on the runner's real PATH.
    const resolved = resolveClaudeCommand(['--resume', 'abc'], () => ({
      path: 'C:\\npm\\claude.cmd',
      direct: false,
    }));
    expect(resolved.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(resolved.args).toEqual(['/c', 'claude', '--resume', 'abc']);
  });

  it('falls back to cmd.exe when ComSpec is unset on Windows', () => {
    setPlatform('win32');
    delete process.env.ComSpec;
    // Force the .cmd branch (no directly-launchable claude.exe on PATH).
    expect(resolveClaudeCommand([], () => null).command).toBe('cmd.exe');
  });

  it('launches the native claude.exe directly on Windows so the pid matches the registry', () => {
    setPlatform('win32');
    // A native install resolves claude to a real PE image: node-pty must spawn it
    // directly (pid == CLI pid == session-registry key), not wrap it in cmd.exe.
    const find = () => ({ path: 'C:\\Users\\me\\.local\\bin\\claude.exe', direct: true });
    expect(resolveClaudeCommand(['--resume', 'abc'], find)).toEqual({
      command: 'C:\\Users\\me\\.local\\bin\\claude.exe',
      args: ['--resume', 'abc'],
    });
  });

  it('wraps a .cmd shim in cmd.exe even when found on PATH (not a PE image)', () => {
    setPlatform('win32');
    process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';
    const find = () => ({ path: 'C:\\npm\\claude.cmd', direct: false });
    expect(resolveClaudeCommand(['--resume', 'abc'], find)).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/c', 'claude', '--resume', 'abc'],
    });
  });
});

describe('findClaudeOnWindowsPath', () => {
  // PATHEXT extensions are conventionally upper-case (`.EXE`), so the built
  // candidate is `claude.EXE`; the real Windows filesystem is case-insensitive
  // and resolves it to the on-disk `claude.exe`. The mock mirrors that.
  const ciExists = (present: string[]) => {
    const lower = new Set(present.map(p => p.toLowerCase()));
    return (p: string) => lower.has(p.toLowerCase());
  };

  it('resolves claude.exe as directly launchable, honoring PATH+PATHEXT order', () => {
    const env = { PATH: 'C:\\a;C:\\b', PATHEXT: '.COM;.EXE;.BAT;.CMD' } as NodeJS.ProcessEnv;
    const res = findClaudeOnWindowsPath(env, ciExists(['C:\\b\\claude.exe']));
    expect(res?.direct).toBe(true);
    expect(res?.path.toLowerCase()).toBe('c:\\b\\claude.exe');
  });

  it('flags a .cmd shim as needing a wrapper', () => {
    const env = { PATH: 'C:\\a', PATHEXT: '.EXE;.CMD' } as NodeJS.ProcessEnv;
    const res = findClaudeOnWindowsPath(env, ciExists(['C:\\a\\claude.cmd']));
    expect(res?.direct).toBe(false);
    expect(res?.path.toLowerCase()).toBe('c:\\a\\claude.cmd');
  });

  it('prefers an earlier PATH dir even when a later dir has a direct exe', () => {
    // where.exe semantics: PATH-dir order dominates, extension order breaks ties
    // within a dir. A .cmd in the first dir wins over a .exe in the second.
    const env = { PATH: 'C:\\a;C:\\b', PATHEXT: '.EXE;.CMD' } as NodeJS.ProcessEnv;
    const res = findClaudeOnWindowsPath(env, ciExists(['C:\\a\\claude.cmd', 'C:\\b\\claude.exe']));
    expect(res?.path.toLowerCase()).toBe('c:\\a\\claude.cmd');
    expect(res?.direct).toBe(false);
  });

  it('returns null when claude is not on PATH', () => {
    const env = { PATH: 'C:\\a', PATHEXT: '.EXE' } as NodeJS.ProcessEnv;
    expect(findClaudeOnWindowsPath(env, () => false)).toBeNull();
  });
});
