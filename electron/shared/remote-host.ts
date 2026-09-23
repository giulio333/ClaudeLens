// A remote machine the terminal pane can run Claude Code on, over the system
// `ssh` (#242). Shared by the main process, which enforces these rules before
// anything reaches a shell, and by the renderer, whose host form states the same
// verdict inline instead of waiting for the round-trip to refuse it.
//
// The remote layer is additive on purpose: an upstream way to attach to a
// session on another machine (anthropics/claude-code#87190) would supersede it,
// so nothing local is rewired around a host — this file, `remote-ssh.ts`,
// `remote-hosts-store.ts`, the `remote:*` / `terminal:createRemote` handlers and
// `project/remote/` are the whole of it.

export interface RemoteHost {
  id: string;
  /** What the host is called in ClaudeLens. */
  name: string;
  /** The ssh destination: an alias from `~/.ssh/config`, a host, or `user@host`. */
  target: string;
  port?: number;
  /** Folder the connect form starts from: absolute, `~` or `~/…`. */
  defaultDir?: string;
}

export type RemoteHostInput = Omit<RemoteHost, 'id'> & { id?: string };

/** What one connection runs: Claude Code in a folder, or `claude update`. */
export type RemoteLaunchMode = 'claude' | 'update';

/**
 * Exit codes the connect script uses for its own refusals, before it hands the
 * terminal to `claude`. They only mean this while the script is running: once it
 * `exec`s the CLI, the code is Claude Code's — which is why they sit far from
 * anything the CLI or ssh (255) returns.
 */
export const REMOTE_EXIT = {
  outdated: 190,
  notFound: 191,
  unknownVersion: 192,
  noDir: 193,
} as const;

// No control characters, and none of the characters the connect script would
// have to escape. The folder is interpolated between double quotes in a script
// that is itself single-quoted for the remote login shell (bash, zsh, fish,
// csh…), so a quote, `$`, a backtick or a backslash could change what runs, and
// csh expands `!` even inside single quotes. Refusing them is the whole escaping
// strategy — narrow, and checkable.
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const UNSAFE_DIR_CHARS = /["'`$\\!\x00-\x1f\x7f]/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
// A destination ssh reads as a host: no whitespace, and never a leading `-`,
// which ssh would parse as an option (`-oProxyCommand=…`).
const TARGET_RE = /^[A-Za-z0-9._@%:[\]][A-Za-z0-9._@%:[\]-]*$/;

/** Why a host entry cannot be saved, or null when it can. */
export function remoteHostProblem(input: RemoteHostInput): string | null {
  const name = input.name?.trim() ?? '';
  if (!name) return 'Give the host a name.';
  if (name.length > 60) return 'The name is longer than 60 characters.';
  if (CONTROL_CHARS.test(name)) return 'The name contains control characters.';
  const target = input.target?.trim() ?? '';
  if (!target)
    return 'Enter the ssh destination: an alias from ~/.ssh/config, a host or user@host.';
  if (target.length > 255 || !TARGET_RE.test(target)) {
    return 'The ssh destination can hold letters, digits and . _ @ : % - only, and cannot start with "-".';
  }
  if (input.port !== undefined) {
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
      return 'The port must be a whole number between 1 and 65535.';
    }
  }
  // Judged as stored: `normalizeRemoteHost` trims it.
  const defaultDir = input.defaultDir?.trim();
  if (defaultDir) {
    const dirProblem = remoteDirProblem(defaultDir);
    if (dirProblem) return dirProblem;
  }
  return null;
}

/** Why a folder cannot be opened on the remote, or null when it can. */
export function remoteDirProblem(dir: string): string | null {
  if (!dir) return 'Enter a folder on the host.';
  if (dir.length > 1024) return 'The folder path is longer than 1024 characters.';
  if (dir !== '~' && !dir.startsWith('~/') && !dir.startsWith('/')) {
    return 'Use an absolute path, or one starting with ~/ (the home folder on the host).';
  }
  if (UNSAFE_DIR_CHARS.test(dir)) {
    return 'The folder path cannot contain quotes, $, `, \\, ! or control characters.';
  }
  return null;
}

/** The entry as it is stored: trimmed, with empty optionals dropped. */
export function normalizeRemoteHost(input: RemoteHostInput, id: string): RemoteHost {
  const defaultDir = input.defaultDir?.trim();
  return {
    id,
    name: input.name.trim(),
    target: input.target.trim(),
    ...(input.port !== undefined && { port: input.port }),
    ...(defaultDir && { defaultDir }),
  };
}
