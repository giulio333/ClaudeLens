import { execFile, execFileSync } from 'child_process';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  WINDOWS_CLAUDE_DIRS,
  WINDOWS_MARK_FN,
  buildRemoteCommand,
  buildWindowsScript,
  createExitMarkerScanner,
  createLaunchMarkerScanner,
  remoteExitCode,
  windowsCommandArgs,
  windowsCommandString,
  windowsDirExpr,
  type RemoteScriptOptions,
} from '../electron/modules/remote-ssh';
import { REMOTE_EXIT, remoteDirProblem, remoteHostProblem } from '../electron/shared/remote-host';

// The Windows half of #242: the same gate as the POSIX script, in PowerShell,
// sent base64-encoded. The pure half runs everywhere. The script itself runs
// through a real `pwsh` when there is one — GitHub's Ubuntu runners ship it,
// and CLAUDELENS_PWSH points at a portable one elsewhere — against a stub
// `claude` under a temp USERPROFILE. It was also run against Windows PowerShell
// 5.1 over OpenSSH on a real Windows 11 host, which is where the exit-marker
// requirement came from: with a tty, Win32-OpenSSH reports every exit as 0.

function findPwsh(): string | null {
  if (process.env.CLAUDELENS_PWSH) return process.env.CLAUDELENS_PWSH;
  try {
    return execFileSync('which', ['pwsh'], { encoding: 'utf-8' }).trim() || null;
  } catch {
    return null;
  }
}
const PWSH = findPwsh();

const MARKER = (code: number) => `\x1b]7771;claudelens-exit=${code}\x07`;

describe('the Windows command', () => {
  it('is PowerShell running the script base64-encoded, so no shell parses it', () => {
    const script = buildWindowsScript({ mode: 'claude', dir: '~', minVersion: '2.1.280' });
    const command = windowsCommandString(script);
    expect(
      command.startsWith('powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand ')
    ).toBe(true);
    const payload = command.split(' ').pop()!;
    expect(payload).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(Buffer.from(payload, 'base64').toString('utf16le')).toBe(script);
  });

  it('is chosen by the host system, and the POSIX one stays sh', () => {
    const opts: RemoteScriptOptions = { mode: 'claude', dir: '~', minVersion: '2.1.280' };
    expect(buildRemoteCommand('windows', opts).startsWith('powershell ')).toBe(true);
    expect(buildRemoteCommand('posix', opts).startsWith("sh -c '")).toBe(true);
  });

  it('looks for claude where the Windows installers put it', () => {
    const script = buildWindowsScript({ mode: 'update' });
    for (const dir of WINDOWS_CLAUDE_DIRS) expect(script).toContain(dir);
    expect(WINDOWS_CLAUDE_DIRS[0]).toBe('"$env:USERPROFILE\\.local\\bin"');
  });

  it('carries the folder as a single-quoted literal, whatever it holds', () => {
    expect(windowsDirExpr('~')).toBe('$env:USERPROFILE');
    expect(windowsDirExpr('~\\src\\app')).toBe("(Join-Path $env:USERPROFILE 'src\\app')");
    expect(windowsDirExpr('~/src')).toBe("(Join-Path $env:USERPROFILE 'src')");
    // A quote is doubled; `$(…)` stays text inside single quotes.
    expect(windowsDirExpr("C:\\Users\\O'Brien")).toBe("'C:\\Users\\O''Brien'");
    expect(windowsDirExpr('C:\\a$(calc)')).toBe("'C:\\a$(calc)'");
  });

  it('refuses a minimum version it could not compare', () => {
    expect(() => buildWindowsScript({ mode: 'claude', dir: '~', minVersion: '2.1' })).toThrow();
  });
});

describe('the Windows folder rules', () => {
  it.each([['~'], ['~\\src'], ['~/src'], ['C:\\src\\app'], ['d:/work'], ["C:\\Users\\O'Brien"]])(
    'accepts %j',
    dir => {
      expect(remoteDirProblem(dir, 'windows')).toBeNull();
    }
  );

  it.each([
    ['src\\app'],
    ['C:'],
    ['\\\\server\\share'],
    ['C:\\a"b'],
    ['C:\\a|b'],
    ['C:\\a\u2019b'],
    ['C:\\a\nb'],
    ['/usr/src'],
  ])('refuses %j', dir => {
    expect(remoteDirProblem(dir, 'windows')).not.toBeNull();
  });

  it('judges a saved default folder by the host system', () => {
    const host = { name: 'Win', target: 'win-box', defaultDir: 'C:\\src' };
    expect(remoteHostProblem({ ...host, os: 'windows' })).toBeNull();
    expect(remoteHostProblem({ ...host, os: 'posix' })).toMatch(/absolute/);
    expect(remoteHostProblem({ ...host, os: 'amiga' as never })).toMatch(/system/);
  });
});

describe('the exit marker', () => {
  it('is read back even when a chunk boundary splits it', () => {
    const scan = createExitMarkerScanner();
    const marker = MARKER(REMOTE_EXIT.outdated);
    scan.feed('ClaudeLens: too old\r\n' + marker.slice(0, 9));
    expect(scan.code()).toBeNull();
    scan.feed(marker.slice(9) + '\x1b[?25h');
    expect(scan.code()).toBe(REMOTE_EXIT.outdated);
  });

  it('is not invented from output that only looks like it', () => {
    const scan = createExitMarkerScanner();
    scan.feed('claudelens-exit=190 printed as text\r\n\x1b]0;title\x07');
    expect(scan.code()).toBeNull();
  });

  it('replaces the 0 a tty-bound Windows ssh reports, and nothing else', () => {
    expect(remoteExitCode(0, REMOTE_EXIT.outdated)).toBe(REMOTE_EXIT.outdated);
    expect(remoteExitCode(0, null)).toBe(0);
    // ssh's own failure, or a code it did carry, is never overwritten.
    expect(remoteExitCode(255, REMOTE_EXIT.outdated)).toBe(255);
    expect(remoteExitCode(REMOTE_EXIT.noDir, REMOTE_EXIT.noDir)).toBe(REMOTE_EXIT.noDir);
  });
});

// A cold pwsh start on a CI runner can take seconds; the default 5s is not enough.
describe.skipIf(!PWSH)('the Windows script, run by PowerShell', { timeout: 40_000 }, () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'remote-win-home-'));
    await mkdir(join(home, '.local', 'bin'), { recursive: true });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  // An executable `claude` PowerShell resolves as an Application, as it would
  // claude.exe: answers --version with `version`, `update` with UPDATED, and
  // anything else with where it runs, exiting 7.
  async function stubClaude(version: string | null, updateExit = 0) {
    const file = join(home, '.local', 'bin', 'claude');
    const versionLine = version === null ? ':' : `echo "${version}"`;
    await writeFile(
      file,
      [
        '#!/bin/sh',
        `if [ "$1" = "--version" ]; then ${versionLine}; exit 0; fi`,
        `if [ "$1" = "update" ]; then echo UPDATED; exit ${updateExit}; fi`,
        'echo "RAN pwd=$(pwd)"',
        'echo "PID=$$"',
        'exit 7',
      ].join('\n')
    );
    await chmod(file, 0o755);
  }

  function run(opts: Partial<RemoteScriptOptions>) {
    return runScript(
      buildWindowsScript({
        mode: 'claude',
        dir: '~',
        minVersion: '2.1.280',
        // `\` is not a separator off Windows; the default list is asserted above.
        claudeDirs: ['"$env:USERPROFILE/.local/bin"'],
        ...opts,
      })
    );
  }

  function runScript(script: string) {
    return new Promise<{ code: number; stdout: string; stderr: string }>(resolve => {
      execFile(
        PWSH!,
        windowsCommandArgs(script),
        { env: { USERPROFILE: home, HOME: home, PATH: '/usr/bin:/bin' }, timeout: 30_000 },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
          resolve({ code, stdout, stderr });
        }
      );
    });
  }

  it('starts claude in the folder and passes its exit code through', async () => {
    await stubClaude('2.1.280 (Claude Code)');
    await mkdir(join(home, "O'Brien proj"));
    const r = await run({ dir: "~/O'Brien proj" });
    // `pwd` resolves symlinks (macOS' /var is /private/var).
    expect(r.stdout).toContain(`RAN pwd=${join(await realpath(home), "O'Brien proj")}`);
    expect(r.code).toBe(7);
    // The same code as a marker, for the Windows ssh that would report 0.
    expect(r.stdout).toContain(MARKER(7));
  });

  it('names the pid of the Claude Code it started, and when (#294)', async () => {
    await stubClaude('2.1.280 (Claude Code)');
    const before = Math.floor(Date.now() / 1000);
    const r = await run({});
    const scan = createLaunchMarkerScanner();
    scan.feed(r.stdout);
    // Start-Process hands back the child's own pid: the one the CLI registers under.
    const pid = Number(/PID=(\d+)/.exec(r.stdout)?.[1]);
    expect(scan.launch()).toEqual({ pid, at: expect.any(Number) });
    expect(scan.launch()!.at).toBeGreaterThanOrEqual(before);
    // And the CLI's exit code still comes back, as code and as marker.
    expect(r.code).toBe(7);
    expect(r.stdout).toContain(MARKER(7));
  });

  it('prints no launch marker when the gate refuses', async () => {
    await stubClaude('2.1.279 (Claude Code)');
    expect((await run({})).stdout).not.toContain('claudelens-launch');
  });

  it('marks a failed claude update, so a tty-bound ssh cannot report it as done', async () => {
    await stubClaude('2.1.280 (Claude Code)', 3);
    const r = await run({ mode: 'update', dir: undefined, minVersion: undefined });
    expect(r.code).toBe(3);
    const scan = createExitMarkerScanner();
    scan.feed(r.stdout);
    expect(remoteExitCode(0, scan.code())).toBe(3);
  });

  it('writes no marker for a clean exit', async () => {
    await stubClaude('2.1.280 (Claude Code)', 0);
    const r = await run({ mode: 'update', dir: undefined, minVersion: undefined });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain('claudelens-exit');
  });

  it.each([[-1073741510], [0], [300]])(
    'writes a code the marker cannot carry (%s) as 1',
    async code => {
      const r = await runScript(`${WINDOWS_MARK_FN}\nMark ${code}`);
      expect(r.stdout).toContain(MARKER(1));
    }
  );

  it('refuses an outdated claude, and says so in the marker too', async () => {
    await stubClaude('2.1.279 (Claude Code)');
    const r = await run({});
    expect(r.code).toBe(REMOTE_EXIT.outdated);
    expect(r.stderr).toContain('older than 2.1.280');
    expect(r.stdout).toContain(MARKER(REMOTE_EXIT.outdated));
    expect(r.stdout).not.toContain('RAN ');
  });

  it.each([[null], ['garbage'], ['2.1 (Claude Code)']])(
    'refuses a version it cannot read (%s)',
    async version => {
      await stubClaude(version);
      const r = await run({});
      expect(r.code).toBe(REMOTE_EXIT.unknownVersion);
      expect(r.stdout).toContain(MARKER(REMOTE_EXIT.unknownVersion));
    }
  );

  it('says claude is not there when nothing answers', async () => {
    const r = await run({});
    expect(r.code).toBe(REMOTE_EXIT.notFound);
    expect(r.stderr).toContain('claude was not found on this host');
  });

  it('refuses a folder that does not exist', async () => {
    await stubClaude('2.1.280 (Claude Code)');
    const r = await run({ dir: '~/missing' });
    expect(r.code).toBe(REMOTE_EXIT.noDir);
    expect(r.stderr).toContain('does not exist on this host');
  });

  it('runs claude update without a gate', async () => {
    await stubClaude('garbage');
    const r = await run({ mode: 'update', dir: undefined, minVersion: undefined });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('UPDATED');
  });
});
