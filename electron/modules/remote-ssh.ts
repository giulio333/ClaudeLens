// The command line that runs Claude Code on a remote machine inside the
// terminal pane (#242): the system `ssh`, a tty, and a short POSIX script that
// checks the remote CLI before handing the terminal to it.
//
// Why the system binary and not a JS ssh library: `~/.ssh/config`, ProxyJump,
// ssh-agent, hardware keys and 2FA keep working as they do in any terminal, and
// ClaudeLens never holds a credential. The PTY is the local one
// (`terminal-manager.ts`, untouched), so a password, a passphrase or a new host
// key is asked in the pane itself — which is also why the version check lives in
// the remote script rather than in a separate non-interactive `ssh` beforehand:
// one connection, one login, and whatever the login needs to ask it can.
//
// Quoting. ssh hands its command string to the remote user's login shell, which
// can be bash, zsh, fish or csh. The script is wrapped in single quotes for that
// shell and contains no single quote, no backslash, no `!` and no newline of its
// own, so every one of them reads it as the same literal `sh -c` argument: csh
// refuses a newline inside quotes and expands `!` even inside them, fish treats
// `\\` and `\'` specially there. That is why the gate spells "only digits" with
// `tr -d` rather than the usual `[!0-9]`. The only user text in the script is
// the folder, which `remoteDirProblem` restricts to characters that are inert
// between double quotes. The remote must be Linux/macOS: a Windows OpenSSH
// server has no `sh`.

import {
  REMOTE_EXIT,
  remoteDirProblem,
  type RemoteHost,
  type RemoteLaunchMode,
} from '../shared/remote-host';

/**
 * Where Claude Code installs itself, put in front of the PATH the remote login
 * gives. ssh runs the command through a non-interactive shell, which on most
 * systems never reads the file that adds `~/.local/bin` — the native
 * installer's default — so without these `claude` is "not found" on a host where
 * typing it at a prompt works.
 */
export const REMOTE_CLAUDE_DIRS = [
  '$HOME/.local/bin',
  '$HOME/.claude/local',
  '/opt/homebrew/bin',
  '/usr/local/bin',
];

export interface RemoteScriptOptions {
  mode: RemoteLaunchMode;
  /** Folder to start in (mode `claude`); already checked by `remoteDirProblem`. */
  dir?: string;
  /** Oldest Claude Code accepted on the remote, `x.y.z` (mode `claude`). */
  minVersion?: string;
  /** Override of `REMOTE_CLAUDE_DIRS` — tests only, so a stub cannot be shadowed. */
  claudeDirs?: string[];
}

const MIN_VERSION_RE = /^(\d{1,4})\.(\d{1,4})\.(\d{1,5})$/;

/** `x.y.z` → its three numbers; throws on anything else, which never reaches a shell. */
export function parseMinVersion(version: string): [number, number, number] {
  const m = MIN_VERSION_RE.exec(version);
  if (!m) throw new Error(`Invalid minimum Claude Code version: ${JSON.stringify(version)}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * The folder as a double-quoted sh word: `~` and `~/…` become `$HOME…` (a tilde
 * inside quotes is not expanded), anything else stays as typed.
 */
export function remoteDirWord(dir: string): string {
  const problem = remoteDirProblem(dir);
  if (problem) throw new Error(problem);
  if (dir === '~') return '"$HOME"';
  if (dir.startsWith('~/')) return `"$HOME/${dir.slice(2)}"`;
  return `"${dir}"`;
}

// The gate refuses anything it cannot read as three numbers — an unknown
// version is never let through, the same rule the local version read follows.
function versionGate(minVersion: string): string[] {
  const [maj, min, pat] = parseMinVersion(minVersion);
  const unreadable =
    'echo "ClaudeLens: could not read the Claude Code version on this host (claude --version answered: $raw)." >&2';
  return [
    `nv() { ${unreadable}; exit ${REMOTE_EXIT.unknownVersion}; }`,
    'raw=$(claude --version 2>/dev/null | head -n 1)',
    'v=${raw%% *}',
    'a=${v%%.*}',
    'r=${v#*.}',
    'b=${r%%.*}',
    'c=${r#*.}',
    // A pre-release (`-beta.1`) or build (`+abc`) suffix, or a fourth part, is
    // dropped: the gate compares three numbers.
    'c=${c%%-*}',
    'c=${c%%+*}',
    'c=${c%%.*}',
    'case "$v" in *.*.*) ;; *) nv;; esac',
    'for p in "$a" "$b" "$c"; do [ -n "$p" ] && [ -z "$(printf %s "$p" | tr -d 0123456789)" ] || nv; done',
    `if [ "$a" -lt ${maj} ] || { [ "$a" -eq ${maj} ] && { [ "$b" -lt ${min} ] || { [ "$b" -eq ${min} ] && [ "$c" -lt ${pat} ]; }; }; }; then ` +
      `echo "ClaudeLens: Claude Code $v on this host is older than ${minVersion}, the version this ClaudeLens requires. Update it (claude update) and connect again." >&2; ` +
      `exit ${REMOTE_EXIT.outdated}; fi`,
  ];
}

/** The POSIX script run on the remote, as one line. */
export function buildRemoteScript(opts: RemoteScriptOptions): string {
  const dirs = opts.claudeDirs ?? REMOTE_CLAUDE_DIRS;
  const lines = [
    // What a login would set up, read first so the install dirs below still win.
    '[ -r "$HOME/.profile" ] && . "$HOME/.profile" >/dev/null 2>&1',
    `PATH="${[...dirs, '$PATH'].join(':')}"`,
    'export PATH',
    'command -v claude >/dev/null 2>&1 || { ' +
      'echo "ClaudeLens: claude was not found on this host. Install Claude Code there, or add its folder to PATH in ~/.profile." >&2; ' +
      `exit ${REMOTE_EXIT.notFound}; }`,
  ];
  if (opts.mode === 'update') {
    lines.push('exec claude update');
  } else {
    if (!opts.dir || !opts.minVersion)
      throw new Error('A Claude Code launch needs a folder and a minimum version.');
    const word = remoteDirWord(opts.dir);
    lines.push(
      ...versionGate(opts.minVersion),
      `cd ${word} 2>/dev/null || { echo "ClaudeLens: the folder ${opts.dir} does not exist on this host." >&2; exit ${REMOTE_EXIT.noDir}; }`,
      'exec claude'
    );
  }
  const script = lines.join('; ');
  // The invariants the quoting argument above rests on — checked, not assumed.
  if (/['\\\n!]/.test(script)) throw new Error('The remote script would break its quoting.');
  return script;
}

/** The string ssh sends to the remote login shell. */
export function remoteCommandString(script: string): string {
  return `sh -c '${script}'`;
}

/**
 * The ssh argv. `-t` asks for a remote tty (the TUI needs one); the `--` ends
 * option parsing before the destination, a second guard behind `TARGET_RE`
 * against a destination read as an option. The keepalives make a dropped
 * network end the pane instead of leaving it frozen.
 */
export function buildSshArgs(host: Pick<RemoteHost, 'target' | 'port'>, script: string): string[] {
  return [
    '-t',
    '-o',
    'ConnectTimeout=15',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=4',
    ...(host.port ? ['-p', String(host.port)] : []),
    '--',
    host.target,
    remoteCommandString(script),
  ];
}

/** The local ssh client: OpenSSH on macOS/Linux, the Windows 10+ built-in on win32. */
export function sshCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'ssh.exe' : 'ssh';
}
