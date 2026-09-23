import { spawn, execFileSync, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildPosixWatchScript,
  buildRemoteWatchCommand,
  buildWatchSshArgs,
  buildWindowsWatchScript,
  posixWatchCommand,
} from '../electron/modules/remote-watch';
import { windowsCommandArgs } from '../electron/modules/remote-ssh';
import { RemoteLens, type LensSpawner } from '../electron/modules/remote-lens';
import { createWatchReader, type WatchMessage } from '../electron/modules/remote-transcript';
import type { RemoteLensState } from '../electron/shared/remote-session';

// The watcher is the half of #294 that runs on another machine, so it is run
// for real: the command string ssh would send, through the login shells this
// machine has — and, for a Windows host, through `pwsh` where there is one —
// against a temp HOME holding a registry entry, a transcript, and a live
// process standing in for the CLI. `RemoteLens` is driven end to end over the
// same scripts, with a spawner that runs the command here instead of over ssh:
// everything but the network is the real thing.

const SID = '0b6c1f2e-1111-2222-3333-444444444444';
const SID2 = '7d8e9f00-5555-6666-7777-888888888888';
const POLL = 0.2;

let home: string;
let phys: string;
let cli: ChildProcess;
let launchedAt: number;
let children: ChildProcess[];
// Grandchildren a shim started: they outlive a SIGKILLed shell.
let strays: number[];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'remote-watch-home-'));
  await mkdir(join(home, 'proj'), { recursive: true });
  await mkdir(join(home, '.claude', 'sessions'), { recursive: true });
  await mkdir(join(home, '.claude', 'projects', '-p'), { recursive: true });
  // What the CLI reports as its cwd is the physical path (macOS' /var is /private/var).
  phys = await realpath(join(home, 'proj'));
  cli = spawn('sleep', ['60'], { stdio: 'ignore' });
  launchedAt = Math.floor(Date.now() / 1000);
  children = [];
  strays = [];
});

afterEach(async () => {
  for (const child of [...children, cli]) if (child.exitCode === null) child.kill('SIGKILL');
  for (const pid of strays) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  await rm(home, { recursive: true, force: true });
});

const registry = (pid: number) => join(home, '.claude', 'sessions', `${pid}.json`);
const transcript = (sid: string) => join(home, '.claude', 'projects', '-p', `${sid}.jsonl`);

async function register(
  pid: number,
  over: Record<string, unknown> = {},
  cwd = phys
): Promise<void> {
  const entry = { pid, sessionId: SID, cwd, startedAt: launchedAt * 1000, status: 'busy', ...over };
  await writeFile(registry(pid), JSON.stringify(entry));
}

const userLine = (uuid: string, text: string) =>
  JSON.stringify({
    type: 'user',
    uuid,
    timestamp: '2026-09-23T10:00:00.000Z',
    message: { role: 'user', content: text },
  }) + '\n';

/** Runs a command the way sshd does — `<login shell> -c <it>` — and reads its frames. */
function runWatch(command: string, shell = '/bin/sh') {
  const child = spawn(shell, ['-c', command], {
    env: { HOME: home, PATH: '/usr/bin:/bin' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const reader = createWatchReader();
  const messages: WatchMessage[] = [];
  let stderr = '';
  child.stdout!.on('data', d => messages.push(...reader.feed(d.toString())));
  child.stderr!.on('data', d => (stderr += d.toString()));
  const exited = new Promise<number>(resolve => child.on('exit', code => resolve(code ?? -1)));
  return { child, messages, exited, stderr: () => stderr };
}

async function until(check: () => boolean, what: string, ms = 8000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 25));
  }
}

// `Array.prototype.at` is past the suite's lib target.
const lastOf = <T>(list: T[]): T | undefined => list[list.length - 1];

const bytesOf = (messages: WatchMessage[]) =>
  Buffer.concat(messages.flatMap(m => (m.kind === 'data' ? [m.bytes] : []))).toString('utf-8');

/** A shim: a shell that starts `n` long-lived children and waits for them. */
function spawnShim(n: number) {
  const proc = spawn('/bin/sh', ['-c', `${'sleep 60 & echo $!; '.repeat(n)}wait`], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  children.push(proc);
  const pids: number[] = [];
  const kids = new Promise<number[]>(resolve => {
    proc.stdout!.on('data', d => {
      pids.push(...d.toString().split(/\s+/).filter(Boolean).map(Number));
      if (pids.length >= n) resolve(pids.slice(0, n));
    });
  });
  void kids.then(list => strays.push(...list));
  return { proc, children: kids };
}

const posixCommand = (pid: number, dir = '~/proj') =>
  buildRemoteWatchCommand('posix', { pid, launchedAt, dir, interval: POLL });

describe('the POSIX watcher, run by sh', () => {
  it('finds the session by the exact pid and streams its transcript, appends included', async () => {
    await register(cli.pid!);
    await writeFile(transcript(SID), userLine('u1', 'hello'));
    const run = runWatch(posixCommand(cli.pid!));
    await until(() => bytesOf(run.messages).includes('hello'), 'the first frame');
    expect(run.messages[0]).toEqual({ kind: 'hello' });
    expect(run.messages).toContainEqual({ kind: 'cwd', cwd: phys });
    expect(run.messages).toContainEqual({ kind: 'session', sessionId: SID });
    expect(run.messages).toContainEqual({ kind: 'status', status: 'busy' });

    await appendFile(transcript(SID), userLine('u2', 'more'));
    await until(() => bytesOf(run.messages).includes('more'), 'the appended line');
    // Every byte arrives once, in order: the frames rebuild the file exactly.
    expect(bytesOf(run.messages)).toBe(userLine('u1', 'hello') + userLine('u2', 'more'));
  });

  it('never takes a session in the same folder that the launched process did not start', async () => {
    // The measured case: this pane's CLI sits on its first prompt, unregistered,
    // while someone else's session starts in the same folder a second later.
    const launched = spawn('sleep', ['60'], { stdio: 'ignore' });
    children.push(launched);
    await register(cli.pid!);
    const run = runWatch(posixCommand(launched.pid!));
    await until(() => run.messages.filter(m => m.kind === 'search').length >= 3, 'searches');
    expect(run.messages.some(m => m.kind === 'session')).toBe(false);
    // And when the launched process ends without ever registering, so does the
    // watcher — the pane's ssh is not held open for a session that never was.
    launched.kill('SIGKILL');
    expect(await run.exited).toBe(0);
    expect(lastOf(run.messages)).toEqual({ kind: 'gone' });
  });

  it('falls back only to a session that descends from the launched process, as behind a shim', async () => {
    const shim = spawnShim(1);
    const [child] = await shim.children;
    // Around it: a dead entry, one with no start time, one from before the
    // launch, and a live session in the same folder that the shim did not start.
    const dead = spawn('true');
    await new Promise(resolve => dead.on('exit', resolve));
    await register(dead.pid!, { sessionId: SID2 });
    await writeFile(registry(424242), JSON.stringify({ pid: child, sessionId: SID2, cwd: phys }));
    await register(cli.pid!, { sessionId: SID2 });
    await writeFile(
      registry(child),
      JSON.stringify({ pid: child, sessionId: SID, cwd: phys, startedAt: (launchedAt - 60) * 1000 })
    );
    const run = runWatch(posixCommand(shim.proc.pid!));
    await until(() => run.messages.some(m => m.kind === 'search'), 'a search');
    expect(run.messages.some(m => m.kind === 'session')).toBe(false);

    await register(child);
    await until(() => run.messages.some(m => m.kind === 'session'), 'the session');
    expect(run.messages).toContainEqual({ kind: 'session', sessionId: SID });
  });

  it('says two descendants could be it and picks neither', async () => {
    const shim = spawnShim(2);
    const [a, b] = await shim.children;
    await register(a);
    await register(b, { sessionId: SID2 });
    const run = runWatch(posixCommand(shim.proc.pid!));
    await until(() => run.messages.some(m => m.kind === 'ambiguous'), 'ambiguity');
    expect(run.messages).toContainEqual({ kind: 'ambiguous', count: 2 });
    expect(run.messages.some(m => m.kind === 'session')).toBe(false);
  });

  it('waits for a transcript that does not exist yet, then reads it', async () => {
    await register(cli.pid!);
    const run = runWatch(posixCommand(cli.pid!));
    await until(() => run.messages.some(m => m.kind === 'wait'), 'the wait');
    await writeFile(transcript(SID), userLine('u1', 'first prompt'));
    await until(() => bytesOf(run.messages).includes('first prompt'), 'the transcript');
    expect(run.messages.filter(m => m.kind === 'wait')).toHaveLength(1);
  });

  it('follows the same process onto a new session, as /clear makes one', async () => {
    await register(cli.pid!);
    await writeFile(transcript(SID), userLine('u1', 'before clear'));
    await writeFile(transcript(SID2), userLine('v1', 'after clear'));
    const run = runWatch(posixCommand(cli.pid!));
    await until(() => bytesOf(run.messages).includes('before clear'), 'the first session');
    await register(cli.pid!, { sessionId: SID2 });
    await until(
      () => run.messages.some(m => m.kind === 'session' && m.sessionId === SID2),
      'the switch'
    );
    await until(() => bytesOf(run.messages).includes('after clear'), 'the new transcript');
    // The new transcript is read from its first byte.
    const afterSwitch = run.messages.slice(
      run.messages.findIndex(m => m.kind === 'session' && m.sessionId === SID2)
    );
    expect(afterSwitch.find(m => m.kind === 'data')).toMatchObject({ offset: 0 });
  });

  it('reads a transcript that shrank again from zero', async () => {
    await register(cli.pid!);
    await writeFile(transcript(SID), userLine('u1', 'long line one') + userLine('u2', 'two'));
    const run = runWatch(posixCommand(cli.pid!));
    await until(() => bytesOf(run.messages).includes('two'), 'the transcript');
    await writeFile(transcript(SID), userLine('u3', 'x'));
    await until(() => run.messages.some(m => m.kind === 'reset'), 'the reset');
    await until(
      () => run.messages.some(m => m.kind === 'data' && m.bytes.toString().includes('"x"')),
      'the re-read'
    );
  });

  it('exits by itself once the session process is gone, even with its registry file left behind', async () => {
    await register(cli.pid!);
    const run = runWatch(posixCommand(cli.pid!));
    await until(() => run.messages.some(m => m.kind === 'session'), 'the session');
    cli.kill('SIGKILL');
    expect(await run.exited).toBe(0);
    expect(lastOf(run.messages)).toEqual({ kind: 'gone' });
    expect(existsSync(registry(cli.pid!))).toBe(true);
  });

  it('dies on its next heartbeat when the channel under it closes', async () => {
    await register(cli.pid!);
    const run = runWatch(posixCommand(cli.pid!));
    await until(() => run.messages.some(m => m.kind === 'session'), 'the session');
    run.child.stdout!.destroy();
    // A write to the closed pipe is SIGPIPE: the loop does not outlive it.
    await run.exited;
    expect(run.child.exitCode !== null || run.child.signalCode !== null).toBe(true);
  });
});

// sshd hands the command to the user's login shell; each one present proves it.
const LOGIN_SHELLS = [
  '/bin/sh',
  '/bin/dash',
  '/bin/bash',
  '/bin/zsh',
  '/bin/tcsh',
  '/bin/csh',
].filter(s => existsSync(s));

describe.each(LOGIN_SHELLS)('through %s as the login shell', shell => {
  it('reaches the script and streams the session', async () => {
    await register(cli.pid!);
    await writeFile(transcript(SID), userLine('u1', 'hello'));
    const run = runWatch(posixCommand(cli.pid!), shell);
    await until(() => bytesOf(run.messages).includes('hello'), `the frames through ${shell}`);
  });
});

describe('what reaches a shell', () => {
  it('sends the script encoded, inside a line every login shell reads the same', () => {
    const command = posixCommand(123, '~/a b/c-d_e.f');
    expect(command.startsWith("sh -c '")).toBe(true);
    expect(command.slice(7, -1)).not.toMatch(/['\\\n!]/);
    // The decoder's flag is probed, not assumed: GNU/busybox -d, old macOS -D, else openssl.
    expect(command).toContain('base64 -d </dev/null');
    expect(command).toContain('base64 -D </dev/null');
    expect(command).toContain('openssl base64 -d -A');
  });

  it('refuses a folder the connect script would refuse too', () => {
    expect(() => buildPosixWatchScript({ pid: 1, launchedAt, dir: '~/$(id)' })).toThrow();
    expect(() =>
      posixWatchCommand(buildPosixWatchScript({ pid: 1, launchedAt, dir: '~' }))
    ).not.toThrow();
  });

  it('refuses a launch it could not trust', () => {
    expect(() => buildPosixWatchScript({ pid: 0, launchedAt, dir: '~' })).toThrow();
    expect(() => buildPosixWatchScript({ pid: -1, launchedAt, dir: '~' })).toThrow();
    expect(() => buildPosixWatchScript({ pid: 1, launchedAt: 0, dir: '~' })).toThrow();
  });

  it('rides the pane connection when there is a control socket, and never becomes a master', () => {
    const args = buildWatchSshArgs({ target: 'dev@box', port: 2222 }, 'cmd', '/tmp/cl-x/s');
    expect(args[0]).toBe('-T');
    expect(args).toContain('ControlMaster=no');
    expect(args).toContain('ControlPath=/tmp/cl-x/s');
    expect(args.slice(-3)).toEqual(['--', 'dev@box', 'cmd']);
    const alone = buildWatchSshArgs({ target: 'dev@box' }, 'cmd', null);
    expect(alone.join(' ')).not.toContain('Control');
  });

  it('asks CIM for a parent at most until it is refused once', () => {
    // A refusal costs seconds on a host that denies WMI; paying it every poll
    // would hold up the teardown check and the heartbeat behind it.
    const script = buildWindowsWatchScript({ pid: 4242, launchedAt, dir: '~' });
    expect(script).toContain('if(-not $global:CIM){return $null}');
    expect(script).toContain('catch{$global:CIM=$false;$null}');
  });

  it('keeps a Windows watch command under the length cmd.exe accepts', () => {
    const command = buildRemoteWatchCommand('windows', {
      pid: 4242,
      launchedAt,
      dir: 'C:\\src\\app',
    });
    expect(command.startsWith('powershell ')).toBe(true);
    expect(command.length).toBeLessThan(8000);
  });
});

describe('the Lens over the real script', () => {
  function lensRun(pid: number) {
    const states: RemoteLensState[] = [];
    let args: string[] = [];
    const spawner: LensSpawner = (sshArgs, handlers) => {
      args = sshArgs;
      const child = spawn('/bin/sh', ['-c', sshArgs[sshArgs.length - 1]], {
        env: { HOME: home, PATH: '/usr/bin:/bin' },
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      children.push(child);
      child.stdout!.on('data', d => handlers.onData(d.toString()));
      child.on('exit', code => handlers.onExit(code ?? -1));
      return { write: d => child.stdin!.write(d), kill: () => child.kill('SIGKILL') };
    };
    const lens = new RemoteLens({
      terminalId: 'pty-1',
      host: { target: 'dev@box' },
      dir: '~/proj',
      controlPath: '/tmp/cl-x/s',
      spawn: spawner,
      onChange: s => states.push(s),
      pollInterval: POLL,
      parseDelayMs: 20,
    });
    lens.launched({ pid, at: launchedAt });
    return { lens, states, args: () => args, last: () => lastOf(states)! };
  }

  it('goes live with the messages the transcript holds, and says it rides the pane connection', async () => {
    await register(cli.pid!);
    await writeFile(transcript(SID), userLine('u1', 'hello from the host'));
    const run = lensRun(cli.pid!);
    await until(() => run.last().messages.length === 1, 'the parsed transcript');
    expect(run.last()).toMatchObject({ phase: 'live', sessionId: SID, status: 'busy', cwd: phys });
    expect(run.last().channel).toBe('shared');
    expect(run.args()).toContain('ControlPath=/tmp/cl-x/s');
    expect(run.last().summary?.firstUserMessage).toBe('hello from the host');

    await appendFile(transcript(SID), userLine('u2', 'second'));
    await until(() => run.last().messages.length === 2, 'the append');
    run.lens.dispose();
  });

  it('empties the view on /clear instead of mixing two sessions', async () => {
    await register(cli.pid!);
    await writeFile(transcript(SID), userLine('u1', 'old'));
    await writeFile(transcript(SID2), userLine('v1', 'new'));
    const run = lensRun(cli.pid!);
    await until(() => run.last().messages.length === 1, 'the first session');
    await register(cli.pid!, { sessionId: SID2 });
    await until(
      () => run.last().sessionId === SID2 && run.last().messages.length === 1,
      'the switch'
    );
    expect(run.last().messages[0].uuid).toBe('v1');
    run.lens.dispose();
  });

  it('ends when the session process ends, and leaves no watcher behind', async () => {
    await register(cli.pid!);
    const run = lensRun(cli.pid!);
    await until(() => run.last().phase === 'waiting', 'the session');
    cli.kill('SIGKILL');
    await until(() => run.last().phase === 'ended', 'the end');
    await until(
      () => children.every(c => c.exitCode !== null || c.signalCode !== null),
      'the exit'
    );
  });

  it('reads a pane closed under it as the end of the session, never as a failure first', async () => {
    // Closing the pane kills the master, and with it this channel, a moment
    // before the pane reports its own end.
    const states: RemoteLensState[] = [];
    let exit: (code: number) => void = () => {};
    const lens = new RemoteLens({
      terminalId: 'pty-4',
      host: { target: 'dev@box' },
      dir: '~/proj',
      controlPath: '/tmp/cl-x/s',
      spawn: (_args, handlers) => {
        exit = handlers.onExit;
        return { write: () => {}, kill: () => {} };
      },
      onChange: s => states.push(s),
    });
    lens.launched({ pid: 1, at: launchedAt });
    exit(255);
    await new Promise(r => setTimeout(r, 20));
    lens.terminalExited();
    await new Promise(r => setTimeout(r, 600));
    expect(states.map(s => s.phase)).not.toContain('failed');
    expect(lastOf(states)?.phase).toBe('ended');
  });

  it("fails with ssh's own words when the channel never reaches the host", async () => {
    const states: RemoteLensState[] = [];
    const lens = new RemoteLens({
      terminalId: 'pty-2',
      host: { target: 'dev@box' },
      dir: '~/proj',
      controlPath: null,
      spawn: (_args, handlers) => {
        setTimeout(() => {
          handlers.onData('dev@box: Permission denied (publickey,password).\r\n');
          handlers.onExit(255);
        }, 5);
        return { write: () => {}, kill: () => {} };
      },
      onChange: s => states.push(s),
    });
    lens.launched({ pid: 1, at: launchedAt });
    await until(() => lastOf(states)?.phase === 'failed', 'the failure');
    expect(lastOf(states)?.detail).toContain('Permission denied');
    expect(lastOf(states)?.channel).toBe('separate');
  });

  it('shows what ssh asks on a second login and types the answer back', async () => {
    const states: RemoteLensState[] = [];
    const written: string[] = [];
    let feed: (d: string) => void = () => {};
    const lens = new RemoteLens({
      terminalId: 'pty-3',
      host: { target: 'dev@box' },
      dir: '~/proj',
      controlPath: null,
      spawn: (_args, handlers) => {
        feed = handlers.onData;
        return { write: d => written.push(d), kill: () => {} };
      },
      onChange: s => states.push(s),
    });
    lens.launched({ pid: 1, at: launchedAt });
    feed("dev@box's password: ");
    expect(lastOf(states)).toMatchObject({ phase: 'prompt', prompt: "dev@box's password:" });
    lens.answer('hunter2');
    expect(written).toEqual(['hunter2\r']);
    expect(lastOf(states)).toMatchObject({ phase: 'connecting', prompt: null });
    feed('\r\n@cl hello 1\r\n');
    expect(lastOf(states)?.phase).toBe('searching');
    lens.dispose();
  });
});

function findPwsh(): string | null {
  if (process.env.CLAUDELENS_PWSH) return process.env.CLAUDELENS_PWSH;
  try {
    return execFileSync('which', ['pwsh'], { encoding: 'utf-8' }).trim() || null;
  } catch {
    return null;
  }
}
const PWSH = findPwsh();

// A cold pwsh start on a CI runner can take seconds.
describe.skipIf(!PWSH)('the Windows watcher, run by PowerShell', { timeout: 40_000 }, () => {
  function runWin(pid: number) {
    const script = buildWindowsWatchScript({ pid, launchedAt, dir: '~/proj', interval: POLL });
    const child = spawn(PWSH!, windowsCommandArgs(script), {
      env: { HOME: home, USERPROFILE: home, PATH: '/usr/bin:/bin' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    const reader = createWatchReader();
    const messages: WatchMessage[] = [];
    child.stdout!.on('data', d => messages.push(...reader.feed(d.toString())));
    const exited = new Promise<number>(resolve => child.on('exit', code => resolve(code ?? -1)));
    return { messages, exited };
  }

  it('finds the session by the exact pid, streams the transcript and ends with the process', async () => {
    await register(cli.pid!, {}, join(home, 'proj'));
    await writeFile(transcript(SID), userLine('u1', 'é from windows'));
    const run = runWin(cli.pid!);
    await until(() => bytesOf(run.messages).includes('é from windows'), 'the frames', 30_000);
    expect(run.messages).toContainEqual({ kind: 'session', sessionId: SID });
    await appendFile(transcript(SID), userLine('u2', 'next'));
    await until(() => bytesOf(run.messages).includes('next'), 'the append', 15_000);
    cli.kill('SIGKILL');
    expect(await run.exited).toBe(0);
    expect(lastOf(run.messages)).toEqual({ kind: 'gone' });
  });

  it('takes no same-folder session it cannot prove the launched process started', async () => {
    // PowerShell resolves `~/proj` without following symlinks, like the CLI's
    // own cwd on Windows. Off Windows there is no CIM to read a parent pid
    // from, which is exactly the case of a user denied WMI: nothing descends.
    const launched = spawn('sleep', ['60'], { stdio: 'ignore' });
    children.push(launched);
    await register(cli.pid!, {}, join(home, 'proj'));
    const run = runWin(launched.pid!);
    await until(
      () => run.messages.filter(m => m.kind === 'search').length >= 3,
      'searches',
      30_000
    );
    expect(run.messages.some(m => m.kind === 'session')).toBe(false);
    launched.kill('SIGKILL');
    expect(await run.exited).toBe(0);
    expect(lastOf(run.messages)).toEqual({ kind: 'gone' });
  });
});
