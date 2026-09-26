// Which Claude Code binary the Agent SDK is told to run (#289).
//
// The SDK ships its CLI as an optional platform package
// (`@anthropic-ai/claude-agent-sdk-{platform}-{arch}/claude`) and, left to
// itself, throws when that file is absent — with no second candidate. So a
// package directory emptied after install (seen: metadata files present, the
// ~200 MB executable gone, `npm ls` valid and `npm install` a no-op because the
// directory is there at the right version) took the whole chat surface down on
// a machine where `claude` answered from PATH all along.
//
// A healthy install is left exactly as it was: in dev the SDK resolves its own
// binary (on Linux it prefers musl or glibc by detection, which is why nothing
// here passes a path when one of its candidates exists), and in a packaged
// build the binary unpacked outside app.asar is passed, because the SDK's
// spawn cannot reach into the archive. Only when every candidate is missing
// does the user's own `claude` stand in, found in the same places — and the
// same order — `claudeEnv()` gives the CLI calls Settings reads its version
// from, so the chat and the version row cannot name two different binaries.
// On Windows only `claude.exe`: the SDK spawns without a shell, and an npm
// `claude.cmd` shim does not start that way (see `claude-cli.ts`).

import { accessSync, constants, statSync } from 'fs';
import { delimiter, dirname, join, sep } from 'path';
import os from 'os';

export type ClaudeExecutable =
  /** Dev, binary present: the SDK finds it on its own. */
  | { source: 'sdk' }
  /** Packaged: the bundled binary, unpacked outside app.asar. */
  | { source: 'bundled'; path: string }
  /** Every bundled candidate is missing: the user's own `claude`. */
  | { source: 'path'; path: string }
  /** Nothing to run; `message` says what to do about it. */
  | { source: 'missing'; message: string };

export interface ResolveDeps {
  platform?: NodeJS.Platform;
  arch?: string;
  /** `require.resolve`, injectable so tests never meet this machine's install. */
  resolve?: (request: string) => string;
  isExecutable?: (path: string) => boolean;
  /** Where to look for the user's `claude`, in order. */
  searchDirs?: string[];
}

const SDK = '@anthropic-ai/claude-agent-sdk';
const ASAR = `app.asar${sep}`;

/** The install dirs a GUI-launched app's PATH may lack, searched before PATH. */
export function claudeExtraDirs(home = os.homedir(), platform = process.platform): string[] {
  return [
    join(home, '.claude', 'local'),
    join(home, '.local', 'bin'),
    ...(platform === 'win32' ? [] : ['/usr/local/bin', '/opt/homebrew/bin']),
  ];
}

function defaultSearchDirs(): string[] {
  return [...claudeExtraDirs(), ...(process.env.PATH ?? '').split(delimiter)].filter(Boolean);
}

function isExecutableFile(path: string): boolean {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size === 0) return false;
    if (process.platform !== 'win32') accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The SDK's own candidate packages, in the order its resolver may try them. */
function sdkBinaryPackages(platform: string, arch: string): string[] {
  if (platform === 'linux') return [`${SDK}-linux-${arch}`, `${SDK}-linux-${arch}-musl`];
  return [`${SDK}-${platform}-${arch}`];
}

function tryResolve(resolve: (r: string) => string, request: string): string | null {
  try {
    return resolve(request);
  } catch {
    return null;
  }
}

export function resolveClaudeExecutable(deps: ResolveDeps = {}): ClaudeExecutable {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const resolve = deps.resolve ?? require.resolve;
  const isExecutable = deps.isExecutable ?? isExecutableFile;
  const exe = platform === 'win32' ? 'claude.exe' : 'claude';
  const packaged = tryResolve(resolve, SDK)?.includes(ASAR) ?? false;

  const emptied: string[] = [];
  for (const pkg of sdkBinaryPackages(platform, arch)) {
    const pkgJson = tryResolve(resolve, `${pkg}/package.json`);
    if (!pkgJson) continue;
    const dir = dirname(pkgJson);
    const inAsar = pkgJson.includes(ASAR);
    const binary = join(inAsar ? dir.replace(ASAR, `app.asar.unpacked${sep}`) : dir, exe);
    if (isExecutable(binary))
      return inAsar ? { source: 'bundled', path: binary } : { source: 'sdk' };
    emptied.push(dir);
  }

  for (const dir of deps.searchDirs ?? defaultSearchDirs()) {
    const candidate = join(dir, exe);
    if (isExecutable(candidate)) return { source: 'path', path: candidate };
  }
  return { source: 'missing', message: missingMessage(packaged, emptied, `${platform}-${arch}`) };
}

function missingMessage(packaged: boolean, emptied: string[], target: string): string {
  const head = 'Claude Code could not be started:';
  const noPath = 'and no claude was found on PATH.';
  if (packaged)
    return `${head} the CLI that ships inside ClaudeLens is missing ${noPath} Install Claude Code, or reinstall ClaudeLens.`;
  if (emptied.length > 0)
    return (
      `${head} the Agent SDK's bundled CLI is missing from ${emptied[0]} ${noPath} ` +
      'Delete that folder and run npm install — npm does not repair it in place — or install Claude Code.'
    );
  return `${head} the Agent SDK's CLI for ${target} is not installed ${noPath} Run npm install without --omit=optional, or install Claude Code.`;
}

let warnedFallback = false;

/**
 * The `pathToClaudeCodeExecutable` part of a `query()`'s options. Resolved on
 * every call — a few `stat`s against a process spawn — so a binary that goes
 * missing while the app runs is noticed on the next chat, not after a restart.
 * Throws the actionable message instead of letting the SDK throw its own, which
 * is written for someone embedding it ("reinstall without --omit=optional").
 */
export function sdkExecutableOption(resolved = resolveClaudeExecutable()): {
  pathToClaudeCodeExecutable?: string;
} {
  if (resolved.source === 'missing') throw new Error(resolved.message);
  if (resolved.source === 'sdk') return {};
  if (resolved.source === 'path' && !warnedFallback) {
    warnedFallback = true;
    console.warn(`[claude-executable] bundled CLI missing, running ${resolved.path}`);
  }
  return { pathToClaudeCodeExecutable: resolved.path };
}

/** An explicit binary for a plain CLI call (`claude mcp list`), or undefined for
 *  `claude` on PATH — which in dev is also what the SDK case means. */
export function resolveClaudeExecutablePath(): string | undefined {
  const resolved = resolveClaudeExecutable();
  return resolved.source === 'bundled' || resolved.source === 'path' ? resolved.path : undefined;
}
