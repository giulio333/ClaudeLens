import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveClaudeExecutable,
  sdkExecutableOption,
  type ResolveDeps,
} from '../electron/modules/claude-executable';

// Which binary the SDK chat is told to run (#289). Every lookup is injected —
// the package resolver and the dirs searched — and the files are real ones in a
// temp dir, so the existence check runs for real while nothing here can meet
// this machine's own install (its node_modules, ~/.local/bin, /opt/homebrew).

const SDK = '@anthropic-ai/claude-agent-sdk';
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cl-claude-exe-'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function file(path: string, body = '#!/bin/sh\n', mode = 0o755): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, mode);
  return path;
}

/** A node_modules under `base` holding the SDK and the given platform packages. */
function install(base: string, pkgs: Record<string, 'binary' | 'emptied'>, exe = 'claude') {
  const nm = join(base, 'node_modules');
  const table: Record<string, string> = { [SDK]: file(join(nm, SDK, 'sdk.mjs')) };
  for (const [pkg, state] of Object.entries(pkgs)) {
    table[`${pkg}/package.json`] = file(join(nm, pkg, 'package.json'), '{}', 0o644);
    if (state === 'binary') file(join(nm, pkg, exe));
  }
  return (request: string): string => {
    const hit = table[request];
    if (!hit) throw new Error(`Cannot find module '${request}'`);
    return hit;
  };
}

function deps(over: ResolveDeps): ResolveDeps {
  return { platform: 'darwin', arch: 'arm64', searchDirs: [], ...over };
}

describe('a healthy install is left as it was', () => {
  it('passes no path in dev when the bundled binary is there, even with a claude on PATH', () => {
    const resolve = install(join(root, 'app'), { [`${SDK}-darwin-arm64`]: 'binary' });
    const bin = join(root, 'bin');
    file(join(bin, 'claude'));
    expect(resolveClaudeExecutable(deps({ resolve, searchDirs: [bin] }))).toEqual({
      source: 'sdk',
    });
  });

  it('passes the unpacked binary in a packaged build', () => {
    const asar = join(root, 'Resources', 'app.asar');
    const unpacked = join(root, 'Resources', 'app.asar.unpacked');
    // The archive's paths are what require.resolve answers; the binary itself
    // lives outside it, where electron-builder's asarUnpack puts it.
    const real = install(unpacked, { [`${SDK}-darwin-arm64`]: 'binary' });
    const resolve = (r: string) => real(r).replace(unpacked, asar);
    expect(resolveClaudeExecutable(deps({ resolve }))).toEqual({
      source: 'bundled',
      path: join(unpacked, 'node_modules', `${SDK}-darwin-arm64`, 'claude'),
    });
  });

  it('leaves Linux to the SDK when only the musl package has its binary', () => {
    // The SDK orders musl and glibc by detection; ours must not second-guess it.
    const resolve = install(join(root, 'app'), { [`${SDK}-linux-x64-musl`]: 'binary' });
    const bin = join(root, 'bin');
    file(join(bin, 'claude'));
    const r = resolveClaudeExecutable(
      deps({ platform: 'linux', arch: 'x64', resolve, searchDirs: [bin] })
    );
    expect(r).toEqual({ source: 'sdk' });
  });
});

describe('a missing bundled binary falls back to the user’s claude', () => {
  it('runs the claude found in the search dirs when the package dir was emptied', () => {
    const resolve = install(join(root, 'app'), { [`${SDK}-darwin-arm64`]: 'emptied' });
    const bin = join(root, 'bin');
    const own = file(join(bin, 'claude'));
    expect(resolveClaudeExecutable(deps({ resolve, searchDirs: [bin] }))).toEqual({
      source: 'path',
      path: own,
    });
  });

  it('takes the first dir that has one, in the order given', () => {
    const resolve = install(join(root, 'app'), {});
    const first = file(join(root, 'local', 'claude'));
    file(join(root, 'usr', 'claude'));
    const r = resolveClaudeExecutable(
      deps({ resolve, searchDirs: [join(root, 'none'), join(root, 'local'), join(root, 'usr')] })
    );
    expect(r).toEqual({ source: 'path', path: first });
  });

  it('skips what cannot be run: an empty file, a directory, a file without the exec bit', () => {
    const resolve = install(join(root, 'app'), { [`${SDK}-darwin-arm64`]: 'emptied' });
    file(join(root, 'a', 'claude'), '');
    mkdirSync(join(root, 'b', 'claude'), { recursive: true });
    const dirs = [join(root, 'a'), join(root, 'b')];
    if (process.platform !== 'win32') {
      file(join(root, 'c', 'claude'), '#!/bin/sh\n', 0o644);
      dirs.push(join(root, 'c'));
    }
    const good = file(join(root, 'd', 'claude'));
    dirs.push(join(root, 'd'));
    expect(resolveClaudeExecutable(deps({ resolve, searchDirs: dirs }))).toEqual({
      source: 'path',
      path: good,
    });
  });

  it('on Windows takes claude.exe only, never an npm claude.cmd shim', () => {
    const resolve = install(join(root, 'app'), { [`${SDK}-win32-x64`]: 'emptied' }, 'claude.exe');
    file(join(root, 'npm', 'claude.cmd'));
    const exe = file(join(root, 'native', 'claude.exe'));
    const r = resolveClaudeExecutable(
      deps({
        platform: 'win32',
        arch: 'x64',
        resolve,
        searchDirs: [join(root, 'npm'), join(root, 'native')],
      })
    );
    expect(r).toEqual({ source: 'path', path: exe });
  });
});

describe('with nothing to run, the message says what to do here', () => {
  it('names the emptied package dir and says npm will not repair it in place', () => {
    const resolve = install(join(root, 'app'), { [`${SDK}-darwin-arm64`]: 'emptied' });
    const r = resolveClaudeExecutable(deps({ resolve, searchDirs: [join(root, 'none')] }));
    expect(r.source).toBe('missing');
    const message = r.source === 'missing' ? r.message : '';
    expect(message).toContain(join(root, 'app', 'node_modules', `${SDK}-darwin-arm64`));
    expect(message).toContain('Delete that folder and run npm install');
    expect(message).not.toContain('pathToClaudeCodeExecutable');
  });

  it('never tells a packaged app to delete a folder inside itself', () => {
    const asar = join(root, 'Resources', 'app.asar');
    const unpacked = join(root, 'Resources', 'app.asar.unpacked');
    const real = install(unpacked, { [`${SDK}-darwin-arm64`]: 'emptied' });
    const resolve = (r: string) => real(r).replace(unpacked, asar);
    const r = resolveClaudeExecutable(deps({ resolve }));
    const message = r.source === 'missing' ? r.message : '';
    expect(message).toContain('reinstall ClaudeLens');
    expect(message).not.toContain('Delete');
  });

  it('asks for the optional package when it was never installed', () => {
    const resolve = install(join(root, 'app'), {});
    const r = resolveClaudeExecutable(deps({ resolve }));
    const message = r.source === 'missing' ? r.message : '';
    expect(message).toContain('darwin-arm64 is not installed');
    expect(message).toContain('without --omit=optional');
  });
});

describe('the query option', () => {
  it('is empty when the SDK resolves its own binary', () => {
    expect(sdkExecutableOption({ source: 'sdk' })).toEqual({});
  });

  it('names the binary for a bundled or a PATH CLI', () => {
    expect(sdkExecutableOption({ source: 'bundled', path: '/x/claude' })).toEqual({
      pathToClaudeCodeExecutable: '/x/claude',
    });
    expect(sdkExecutableOption({ source: 'path', path: '/y/claude' })).toEqual({
      pathToClaudeCodeExecutable: '/y/claude',
    });
  });

  it('throws its own message rather than letting the SDK throw one written for embedders', () => {
    expect(() => sdkExecutableOption({ source: 'missing', message: 'do this' })).toThrow('do this');
  });
});
