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
// between double quotes.
//
// Windows has no `sh`, so a Windows host gets the same gate written in
// PowerShell (5.1 ships with every supported Windows) and sent as
// `powershell -EncodedCommand <base64>`: the base64 alphabet means nothing to
// cmd.exe or to PowerShell as the OpenSSH DefaultShell, so no quoting argument
// is needed there at all, and inside the script the folder is a single-quoted
// literal.

import {
  REMOTE_EXIT,
  remoteDirProblem,
  type RemoteHost,
  type RemoteLaunchMode,
  type RemoteOs,
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
 * Where Claude Code installs itself on Windows, as PowerShell expressions: the
 * native installer's `%USERPROFILE%\.local\bin`, npm's global folder, and the
 * old local install.
 */
export const WINDOWS_CLAUDE_DIRS = [
  '"$env:USERPROFILE\\.local\\bin"',
  '"$env:APPDATA\\npm"',
  '"$env:USERPROFILE\\.claude\\local"',
];

/**
 * How a Windows host says why the script stopped. Win32-OpenSSH does not
 * propagate the remote exit status when a tty is allocated — measured on
 * OpenSSH_for_Windows 10.0p2: `cmd /c exit 42` answers 42 with `-T` and 0 with
 * `-t` — and the TUI needs the tty, so the refusal codes cannot ride the exit
 * code there. The script writes them as a private OSC sequence instead, which
 * ConPTY passes through untouched (also measured) and xterm, not knowing the
 * number, draws as nothing. `createExitMarkerScanner` reads it back in the main
 * process.
 */
const EXIT_MARKER_OSC = 7771;
const EXIT_MARKER_KEY = 'claudelens-exit';
const EXIT_MARKER_RE = new RegExp(`\x1b\\]${EXIT_MARKER_OSC};${EXIT_MARKER_KEY}=(\\d{1,3})\x07`);
// Longer than any marker, so one split across two chunks is still whole in the tail.
const EXIT_MARKER_TAIL = 48;

/** Watches a pane's output for the exit marker; `code()` is the last one seen. */
export function createExitMarkerScanner(): { feed(chunk: string): void; code(): number | null } {
  let tail = '';
  let found: number | null = null;
  return {
    feed(chunk) {
      const text = tail + chunk;
      const m = EXIT_MARKER_RE.exec(text);
      if (m) found = Number(m[1]);
      tail = text.slice(-EXIT_MARKER_TAIL);
    },
    code: () => found,
  };
}

/**
 * Writes the marker. A code outside 1–254 becomes 1: Windows reports a crash
 * or a Ctrl+C as a negative NTSTATUS, which the marker's three digits could not
 * carry, and a failure read back as nothing would read as a success.
 */
export const WINDOWS_MARK_FN =
  'function Mark($code) { if ($null -eq $code -or $code -lt 1 -or $code -gt 254) { $code = 1 }; ' +
  `[Console]::Out.Write("$([char]27)]${EXIT_MARKER_OSC};${EXIT_MARKER_KEY}=$code$([char]7)") }`;

/**
 * The exit code to report for a remote pane: ssh's own, unless the connect
 * script marked a refusal and ssh could not carry it (it reads 0 then).
 */
export function remoteExitCode(sshExit: number, marker: number | null): number {
  return sshExit === 0 && marker !== null ? marker : sshExit;
}

/** A PowerShell single-quoted literal: only a quote is special, escaped by doubling. */
function psLiteral(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** The folder as a PowerShell expression: `~` is the user profile, anything else a literal. */
export function windowsDirExpr(dir: string): string {
  const problem = remoteDirProblem(dir, 'windows');
  if (problem) throw new Error(problem);
  if (dir === '~') return '$env:USERPROFILE';
  if (dir.startsWith('~\\') || dir.startsWith('~/')) {
    return `(Join-Path $env:USERPROFILE ${psLiteral(dir.slice(2))})`;
  }
  return psLiteral(dir);
}

function windowsVersionGate(minVersion: string): string[] {
  const [maj, min, pat] = parseMinVersion(minVersion);
  return [
    '$raw = [string](& $claude --version 2>$null | Select-Object -First 1)',
    "$m = [regex]::Match($raw, '^\\s*(\\d+)\\.(\\d+)\\.(\\d+)')",
    `if (-not $m.Success) { Fail ${REMOTE_EXIT.unknownVersion} "could not read the Claude Code version on this host (claude --version answered: $raw)." }`,
    "$v = [version]('{0}.{1}.{2}' -f $m.Groups[1].Value, $m.Groups[2].Value, $m.Groups[3].Value)",
    `if ($v -lt [version]'${maj}.${min}.${pat}') { Fail ${REMOTE_EXIT.outdated} "Claude Code $v on this host is older than ${minVersion}, the version this ClaudeLens requires. Update it (claude update) and connect again." }`,
  ];
}

/** The PowerShell script run on a Windows host: the POSIX gate, rule for rule. */
export function buildWindowsScript(opts: RemoteScriptOptions): string {
  const dirs = opts.claudeDirs ?? WINDOWS_CLAUDE_DIRS;
  const lines = [
    "$ProgressPreference = 'SilentlyContinue'",
    WINDOWS_MARK_FN,
    'function Fail($code, $msg) { [Console]::Error.WriteLine("ClaudeLens: $msg"); Mark $code; exit $code }',
    `$dirs = @(${dirs.join(', ')})`,
    '$env:PATH = (@($dirs | Where-Object { $_ -and (Test-Path -LiteralPath $_) }) + @($env:PATH)) -join [IO.Path]::PathSeparator',
    // An .exe or .cmd first; npm's .ps1 shim only when nothing else answers.
    '$c = Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1',
    'if (-not $c) { $c = Get-Command claude -CommandType ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1 }',
    `if (-not $c) { Fail ${REMOTE_EXIT.notFound} 'claude was not found on this host. Install Claude Code there (irm https://claude.ai/install.ps1 | iex), or add its folder to the user PATH.' }`,
    '$claude = $c.Source',
  ];
  // What the CLI itself answered has to take the marker too: ssh would report
  // a failed `claude update` as 0, and the pane would call it a success.
  const passThrough = ['$rc = $LASTEXITCODE', 'if ($rc -ne 0) { Mark $rc }', 'exit $rc'];
  if (opts.mode === 'update') {
    lines.push('& $claude update', ...passThrough);
  } else {
    if (!opts.dir || !opts.minVersion)
      throw new Error('A Claude Code launch needs a folder and a minimum version.');
    const dir = windowsDirExpr(opts.dir);
    lines.push(
      ...windowsVersionGate(opts.minVersion),
      `$d = ${dir}`,
      `if (-not (Test-Path -LiteralPath $d -PathType Container)) { Fail ${REMOTE_EXIT.noDir} "the folder $d does not exist on this host." }`,
      'Set-Location -LiteralPath $d',
      '& $claude',
      ...passThrough
    );
  }
  return lines.join('\n');
}

/** The PowerShell flags that run an encoded script — also what the suite runs `pwsh` with. */
export function windowsCommandArgs(script: string): string[] {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
}

// cmd.exe refuses a command line past 8191 characters; the script is far
// shorter, so reaching this means something grew that should not have.
const WINDOWS_COMMAND_MAX = 8000;

/** The string ssh sends to a Windows host, whose default shell is cmd.exe or PowerShell. */
export function windowsCommandString(script: string): string {
  const command = ['powershell', ...windowsCommandArgs(script)].join(' ');
  if (command.length > WINDOWS_COMMAND_MAX) throw new Error('The remote command is too long.');
  return command;
}

/** What ssh runs on the host, for the system the host runs. */
export function buildRemoteCommand(os: RemoteOs, opts: RemoteScriptOptions): string {
  return os === 'windows'
    ? windowsCommandString(buildWindowsScript(opts))
    : remoteCommandString(buildRemoteScript(opts));
}

/**
 * The ssh argv. `-t` asks for a remote tty (the TUI needs one); the `--` ends
 * option parsing before the destination, a second guard behind `TARGET_RE`
 * against a destination read as an option. The keepalives make a dropped
 * network end the pane instead of leaving it frozen.
 */
export function buildSshArgs(
  host: Pick<RemoteHost, 'target' | 'port'>,
  remoteCommand: string
): string[] {
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
    remoteCommand,
  ];
}

/** The local ssh client: OpenSSH on macOS/Linux, the Windows 10+ built-in on win32. */
export function sshCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'ssh.exe' : 'ssh';
}
