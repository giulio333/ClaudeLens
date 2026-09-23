import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  REMOTE_CLAUDE_DIRS,
  buildRemoteScript,
  buildSshArgs,
  controlPathFor,
  createLaunchMarkerScanner,
  remoteCommandString,
  sshCommand,
  type RemoteScriptOptions,
} from '../electron/modules/remote-ssh';
import { REMOTE_EXIT } from '../electron/shared/remote-host';

// The connect script is the part of #242 that can be wrong in ways no type
// catches, so it is run for real: through `sh`, with a stub `claude` that says
// which version it is and, when exec'd, where it was started and with what.
//
// HOME is a temp dir and the install dirs are narrowed to `$HOME/.local/bin`:
// the default list names `/usr/local/bin` and friends, where a machine running
// this suite may have the real CLI — and then "not found" would find it, and a
// version test would launch it.

let home: string;
let cwd: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'remote-ssh-home-'));
  cwd = await mkdtemp(join(tmpdir(), 'remote-ssh-cwd-'));
  await mkdir(join(home, '.local', 'bin'), { recursive: true });
  await mkdir(join(home, 'proj'), { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

// Answers `--version` with `version` (a whole line; null = prints nothing),
// `update` with UPDATED, and anything else — i.e. the exec'd session — with
// where it runs and its args, exiting 7 so a pass-through code is visible.
async function stubClaude(version: string | null, dir = join(home, '.local', 'bin')) {
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'claude');
  const versionLine = version === null ? ':' : `echo "${version}"`;
  await writeFile(
    file,
    [
      '#!/bin/sh',
      `if [ "$1" = "--version" ]; then ${versionLine}; exit 0; fi`,
      'if [ "$1" = "update" ]; then echo UPDATED; exit 0; fi',
      'echo "RAN pwd=$(pwd) args=[$*]"',
      'echo "PID=$$"',
      'exit 7',
    ].join('\n')
  );
  await chmod(file, 0o755);
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

// Runs the string ssh would send, the way sshd does: `<login shell> -c <it>`.
function run(opts: Partial<RemoteScriptOptions>, shell = '/bin/sh'): Promise<Run> {
  const script = buildRemoteScript({
    mode: 'claude',
    dir: '~/proj',
    minVersion: '2.1.280',
    claudeDirs: ['$HOME/.local/bin'],
    ...opts,
  });
  return new Promise(resolve => {
    execFile(
      shell,
      ['-c', remoteCommandString(script)],
      { cwd, env: { HOME: home, PATH: '/usr/bin:/bin' }, timeout: 10_000 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
        resolve({ code, stdout, stderr });
      }
    );
  });
}

describe('the version gate', () => {
  it('starts Claude Code in the folder when the version meets the minimum', async () => {
    await stubClaude('2.1.280 (Claude Code)');
    const r = await run({});
    expect(r.stdout).toContain(`RAN pwd=${join(home, 'proj')} args=[]`);
    // After `exec` the exit code is the CLI's own.
    expect(r.code).toBe(7);
  });

  it.each([
    ['3.0.0 (Claude Code)'],
    ['2.2.0 (Claude Code)'],
    // Numeric, not lexical: "1000" < "280" as strings.
    ['2.1.1000 (Claude Code)'],
    // A pre-release suffix is dropped and its number compared.
    ['2.1.280-beta.1 (Claude Code)'],
  ])('accepts %s against 2.1.280', async version => {
    await stubClaude(version);
    const r = await run({});
    expect(r.stdout).toContain('RAN ');
  });

  it.each([['2.1.279 (Claude Code)'], ['2.0.999 (Claude Code)'], ['1.9.500 (Claude Code)']])(
    'refuses %s against 2.1.280 and never starts it',
    async version => {
      await stubClaude(version);
      const r = await run({});
      expect(r.code).toBe(REMOTE_EXIT.outdated);
      expect(r.stderr).toContain('older than 2.1.280');
      expect(r.stderr).toContain('claude update');
      expect(r.stdout).not.toContain('RAN ');
    }
  );

  it.each([[null], ['garbage'], ['2.1 (Claude Code)'], ['2.x.1 (Claude Code)'], ['.1.2']])(
    'refuses a version it cannot read (%s) instead of letting it through',
    async version => {
      await stubClaude(version);
      const r = await run({});
      expect(r.code).toBe(REMOTE_EXIT.unknownVersion);
      expect(r.stderr).toContain('could not read the Claude Code version');
      expect(r.stdout).not.toContain('RAN ');
    }
  );
});

describe('finding claude and the folder', () => {
  it('says claude is not there when nothing on the PATH answers', async () => {
    const r = await run({});
    expect(r.code).toBe(REMOTE_EXIT.notFound);
    expect(r.stderr).toContain('claude was not found on this host');
  });

  it('finds a claude that only ~/.profile puts on the PATH', async () => {
    await stubClaude('2.1.280 (Claude Code)', join(home, 'tools'));
    await writeFile(join(home, '.profile'), 'PATH="$HOME/tools:$PATH"; export PATH\n');
    const r = await run({ claudeDirs: [] });
    expect(r.stdout).toContain('RAN ');
  });

  it('refuses a folder that does not exist, after the version passed', async () => {
    await stubClaude('2.1.280 (Claude Code)');
    const r = await run({ dir: '~/missing' });
    expect(r.code).toBe(REMOTE_EXIT.noDir);
    expect(r.stderr).toContain('the folder ~/missing does not exist');
    expect(r.stdout).not.toContain('RAN ');
  });

  it('expands ~ to the remote home and keeps spaces in the folder', async () => {
    await stubClaude('2.1.280 (Claude Code)');
    await mkdir(join(home, 'my proj'));
    expect((await run({ dir: '~/my proj' })).stdout).toContain(`pwd=${join(home, 'my proj')} `);
    expect((await run({ dir: '~' })).stdout).toContain(`pwd=${home} `);
    expect((await run({ dir: join(home, 'proj') })).stdout).toContain(`pwd=${join(home, 'proj')} `);
  });

  it('runs claude update without a version gate or a folder', async () => {
    await stubClaude('garbage');
    const r = await run({ mode: 'update', dir: undefined, minVersion: undefined });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('UPDATED');
  });
});

// sshd hands the command to the user's login shell. The script is built to read
// the same in all of them; each one present on this machine proves it.
const LOGIN_SHELLS = [
  '/bin/sh',
  '/bin/dash',
  '/bin/bash',
  '/bin/zsh',
  '/bin/tcsh',
  '/bin/csh',
].filter(s => existsSync(s));

describe.each(LOGIN_SHELLS)('through %s as the login shell', shell => {
  it('passes the gate and starts claude', async () => {
    await stubClaude('2.1.280 (Claude Code)');
    const r = await run({ dir: '~/proj' }, shell);
    expect(r.stdout).toContain(`RAN pwd=${join(home, 'proj')} args=[]`);
  });

  it('names the pid Claude Code runs as, which the exec leaves unchanged (#294)', async () => {
    await stubClaude('2.1.280 (Claude Code)');
    const before = Math.floor(Date.now() / 1000);
    const r = await run({ dir: '~/proj' }, shell);
    const scan = createLaunchMarkerScanner();
    scan.feed(r.stdout);
    const pid = Number(/PID=(\d+)/.exec(r.stdout)?.[1]);
    expect(scan.launch()).toEqual({ pid, at: expect.any(Number) });
    expect(scan.launch()!.at).toBeGreaterThanOrEqual(before);
    // Invisible: the marker is one OSC sequence, printed before the CLI starts.
    expect(r.stdout.indexOf('\x1b]7771;claudelens-launch=')).toBeLessThan(r.stdout.indexOf('RAN '));
  });

  it('stops an outdated claude', async () => {
    await stubClaude('2.1.1 (Claude Code)');
    expect((await run({}, shell)).code).toBe(REMOTE_EXIT.outdated);
  });
});

describe('the launch marker', () => {
  it('is not printed when the gate refuses, nor for claude update', async () => {
    await stubClaude('2.1.1 (Claude Code)');
    expect((await run({})).stdout).not.toContain('claudelens-launch');
    await stubClaude('garbage');
    const update = await run({ mode: 'update', dir: undefined, minVersion: undefined });
    expect(update.stdout).not.toContain('claudelens-launch');
  });

  it('is read back even when a chunk boundary splits it, and only the first one counts', () => {
    const scan = createLaunchMarkerScanner();
    const marker = '\x1b]7771;claudelens-launch=4242;1790000000\x07';
    scan.feed('banner\r\n' + marker.slice(0, 17));
    expect(scan.launch()).toBeNull();
    scan.feed(marker.slice(17) + '\x1b[?25h');
    expect(scan.launch()).toEqual({ pid: 4242, at: 1790000000 });
    scan.feed('\x1b]7771;claudelens-launch=1;1\x07');
    expect(scan.launch()).toEqual({ pid: 4242, at: 1790000000 });
  });

  it('is not invented from text that only looks like it', () => {
    const scan = createLaunchMarkerScanner();
    scan.feed('claudelens-launch=1;2 printed as text\r\n');
    expect(scan.launch()).toBeNull();
  });
});

describe('the control socket the Lens rides (#294)', () => {
  it('makes the pane connection a master that lives only as long as the pane', () => {
    const args = buildSshArgs({ target: 'dev@box' }, 'cmd', '/tmp/cl-abc/s');
    expect(args).toContain('ControlMaster=auto');
    expect(args).toContain('ControlPath=/tmp/cl-abc/s');
    expect(args).toContain('ControlPersist=no');
    expect(args.slice(-3)).toEqual(['--', 'dev@box', 'cmd']);
    expect(buildSshArgs({ target: 'dev@box' }, 'cmd').join(' ')).not.toContain('Control');
  });

  it('has no socket on a Windows client, or where ssh could not use the path', () => {
    expect(controlPathFor('/tmp/cl-abc', 'darwin')).toBe('/tmp/cl-abc/s');
    expect(controlPathFor('/tmp/cl-abc', 'win32')).toBeNull();
    expect(controlPathFor(`/tmp/${'x'.repeat(120)}`, 'linux')).toBeNull();
    expect(controlPathFor('/tmp/with space', 'linux')).toBeNull();
    expect(controlPathFor('/tmp/100%', 'linux')).toBeNull();
  });
});

describe('what reaches a shell', () => {
  it('puts the install dirs in front of the PATH by default', () => {
    const script = buildRemoteScript({ mode: 'claude', dir: '~', minVersion: '2.1.280' });
    expect(script).toContain(`PATH="${[...REMOTE_CLAUDE_DIRS, '$PATH'].join(':')}"`);
  });

  it('never contains the characters its quoting cannot carry', () => {
    const script = buildRemoteScript({
      mode: 'claude',
      dir: '~/a b/c-d_e.f',
      minVersion: '2.1.280',
    });
    expect(script).not.toMatch(/['\\\n!]/);
  });

  it.each([
    ['~/a"b'],
    ['~/$(touch x)'],
    ['~/`id`'],
    ["~/it's"],
    ['~/it!s'],
    ['~/a\\b'],
    ['~/a\nb'],
    ['relative/path'],
    ['~user/x'],
    [''],
  ])('refuses the folder %j', dir => {
    expect(() => buildRemoteScript({ mode: 'claude', dir, minVersion: '2.1.280' })).toThrow();
  });

  it.each([['2.1'], ['2.1.x'], ['v2.1.280'], ['2.1.280; id'], ['']])(
    'refuses the minimum version %j',
    minVersion => {
      expect(() => buildRemoteScript({ mode: 'claude', dir: '~', minVersion })).toThrow();
    }
  );

  it('ends ssh option parsing before the destination and sends one command string', () => {
    const args = buildSshArgs(
      { target: 'user@build.example.com', port: 2222 },
      remoteCommandString('true')
    );
    expect(args[0]).toBe('-t');
    expect(args.slice(args.indexOf('-p'), args.indexOf('-p') + 2)).toEqual(['-p', '2222']);
    expect(args.slice(-3)).toEqual(['--', 'user@build.example.com', "sh -c 'true'"]);
  });

  it('passes no port when none is set', () => {
    expect(buildSshArgs({ target: 'build' }, 'true')).not.toContain('-p');
  });

  it('uses the Windows built-in client on win32', () => {
    expect(sshCommand('win32')).toBe('ssh.exe');
    expect(sshCommand('darwin')).toBe('ssh');
  });
});
