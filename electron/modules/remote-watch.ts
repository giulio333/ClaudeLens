// The second ssh channel of a remote pane (#294): a small script that runs on
// the host, finds the session the pane launched in the host's registry, and
// streams its transcript back, so Lens and Mission Control can draw a session
// whose files are on another machine.
//
// Finding it. The connect script prints a launch marker (`remote-ssh.ts`) with
// the host's clock and the pid of the process it launched: the CLI itself —
// POSIX `exec`s it, Windows starts it with `Start-Process` — or, behind a shim,
// an ancestor that lives as long as it. The registry entry is then
// `sessions/<pid>.json` exactly. Only when that entry does not appear (a shim
// forked the real CLI) are other entries considered, and only one whose
// process DESCENDS from the launched one — checked with `ps` on POSIX and CIM
// on Windows — in the same folder and not older than the launch. Without a way
// to check the descent nothing is picked: matching on the folder and the time
// alone was measured to attach to someone else's session, started seconds
// later in the same folder while this one sat on its "trust this folder?"
// prompt, unregistered. The entry is re-read on every poll because `/clear`
// and `/resume` give the same process a new session id, and the transcript is
// found by that id (`projects/*/<id>.jsonl`) rather than by re-deriving Claude
// Code's folder naming rule.
//
// Streaming it. Every poll sends the bytes appended since the last one as a
// base64 frame, one line each: base64 survives a console code page and a
// login shell that prints something first, and a frame cut short by a dropped
// channel never ends its line, so it is never read. The script cuts at a byte
// count, not at a line — the reader on this side keeps the partial line, the
// same way `transcript-tail` does for a local file.
//
// Ending it. With `ControlMaster` the pane's ssh cannot exit while this
// channel is open, so the script must never outlive the CLI: it exits by
// itself once the launched process is gone — registered or not, which is what
// the measured case above needed, since that CLI exited from its prompt and
// never wrote an entry — and sends a heartbeat so that a channel closed under
// it kills it on the next write (SIGPIPE on POSIX, a failed write on Windows)
// instead of letting it poll forever.
//
// Protocol, one line per message, each starting with `@cl `:
//   hello 1                 the script started (anything before it is ssh's)
//   cwd <path>              the folder, as the host resolves it
//   search                  no session found yet
//   ambiguous <n>           n descendants of the launched process are sessions
//   session <id>            this is the session (again, after /clear)
//   status <status>         its registry status changed
//   wait                    the session has no transcript yet
//   reset                   the transcript shrank: start over
//   data <offset> <base64>  bytes from <offset>
//   tick                    heartbeat
//   gone                    the session's process ended; the script exits

import { remoteDirWord, windowsCommandString, windowsDirExpr } from './remote-ssh';
import type { RemoteHost, RemoteOs } from '../shared/remote-host';

export interface WatchScriptOptions {
  /** The launched process on the host: the CLI, or an ancestor living as long. */
  pid: number;
  /** Host clock, epoch seconds, when the connect script launched the CLI. */
  launchedAt: number;
  /** The folder the session was started in, as the connect form took it. */
  dir: string;
  /** Seconds between polls — tests shorten it. */
  interval?: number;
}

/** Raw bytes per data frame: ~256 KB of base64, one line. */
const FRAME_BYTES = 196_608;
/** Polls between heartbeats. */
const TICK_EVERY = 5;
/** A registry entry dated this many seconds before the launch still matches:
 *  the launch clock is read in whole seconds. */
const LAUNCH_SLACK_S = 5;

function checkOptions(opts: WatchScriptOptions): void {
  if (!Number.isInteger(opts.pid) || opts.pid < 1) throw new Error('Invalid remote pid.');
  if (!Number.isInteger(opts.launchedAt) || opts.launchedAt <= 0) {
    throw new Error('Invalid remote launch time.');
  }
  const interval = opts.interval ?? 1;
  if (!(interval > 0 && interval <= 10)) throw new Error('Invalid poll interval.');
}

/** The POSIX watcher, as the script `sh` runs. */
export function buildPosixWatchScript(opts: WatchScriptOptions): string {
  checkOptions(opts);
  const since = opts.launchedAt - LAUNCH_SLACK_S;
  return [
    'R="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"',
    'S="$R/sessions"',
    'P="$R/projects"',
    `WANT=${opts.pid}`,
    `SINCE=${since}000`,
    `PHYS=$(cd ${remoteDirWord(opts.dir)} 2>/dev/null && pwd -P)`,
    'if command -v base64 >/dev/null 2>&1; then enc() { base64 | tr -d "\\n\\r"; }; else enc() { openssl base64 -A; }; fi',
    'say() { printf "@cl %s\\n" "$*"; }',
    // The registry is one line of compact JSON; these read one field of it.
    'str() { sed -n "s/.*\\"$1\\":\\"\\([^\\"]*\\)\\".*/\\1/p" "$2" 2>/dev/null | head -n 1; }',
    'num() { sed -n "s/.*\\"$1\\":\\([0-9][0-9]*\\).*/\\1/p" "$2" 2>/dev/null | head -n 1; }',
    'alive() { kill -0 "$1" 2>/dev/null; }',
    // Parent pid: `ps` where it takes `-o`/`-p`, /proc where it does not (busybox).
    'ppid() { v=$(ps -o ppid= -p "$1" 2>/dev/null | tr -d " "); [ -z "$v" ] && [ -r "/proc/$1/status" ] && v=$(sed -n "s/^PPid:[[:space:]]*//p" "/proc/$1/status"); printf %s "$v"; }',
    'desc() { q=$1; i=0; while [ "$i" -lt 8 ]; do q=$(ppid "$q"); [ -n "$q" ] && [ "$q" -gt 1 ] || return 1; [ "$q" = "$WANT" ] && return 0; i=$((i + 1)); done; return 1; }',
    'find_pid() {',
    '  if [ -f "$S/$WANT.json" ]; then cp=$WANT; return; fi',
    '  c=; k=0',
    '  for e in "$S"/*.json; do',
    '    [ -f "$e" ] || continue',
    '    [ -n "$PHYS" ] && [ "$(str cwd "$e")" = "$PHYS" ] || continue',
    '    t=$(num startedAt "$e"); [ -n "$t" ] && [ "$t" -ge "$SINCE" ] || continue',
    '    p=$(num pid "$e"); [ -n "$p" ] && alive "$p" && desc "$p" || continue',
    '    c=$p; k=$((k + 1))',
    '  done',
    '  if [ "$k" -eq 1 ]; then cp=$c; elif [ "$k" -gt 1 ]; then say ambiguous "$k"; else say search; fi',
    '}',
    'send() {',
    '  [ -f "$f" ] || { f=; return; }',
    '  sz=$(wc -c < "$f" | tr -d " ")',
    '  if [ "$sz" -lt "$off" ]; then off=0; say reset; fi',
    '  while [ "$off" -lt "$sz" ]; do',
    `    m=$((sz - off)); [ "$m" -gt ${FRAME_BYTES} ] && m=${FRAME_BYTES}`,
    '    say data "$off" "$(tail -c +$((off + 1)) "$f" | head -c "$m" | enc)"',
    '    off=$((off + m))',
    '  done',
    '}',
    'say hello 1',
    '[ -n "$PHYS" ] && say cwd "$PHYS"',
    'cp=; sid=; st=; f=; off=0; n=0; waited=',
    'while :; do',
    // The processes, not the registry file, decide: a crashed CLI leaves its
    // file behind, and one that quit from its first prompt never wrote one.
    '  alive "$WANT" || { say gone; exit 0; }',
    '  [ -z "$cp" ] && find_pid',
    '  if [ -n "$cp" ]; then',
    '    e="$S/$cp.json"',
    '    alive "$cp" || { say gone; exit 0; }',
    '    if [ -f "$e" ]; then',
    '      s=$(str sessionId "$e")',
    '      if [ -n "$s" ] && [ "$s" != "$sid" ]; then sid=$s; f=; off=0; waited=; say session "$sid"; fi',
    '      x=$(str status "$e"); if [ -n "$x" ] && [ "$x" != "$st" ]; then st=$x; say status "$st"; fi',
    '    fi',
    '    if [ -n "$sid" ] && [ -z "$f" ]; then',
    '      for g in "$P"/*/"$sid".jsonl; do [ -f "$g" ] && f=$g && break; done',
    '      [ -z "$f" ] && [ -z "$waited" ] && { waited=1; say wait; }',
    '    fi',
    '    [ -n "$f" ] && send',
    '  fi',
    '  n=$((n + 1))',
    `  [ $((n % ${TICK_EVERY})) -eq 0 ] && say tick`,
    `  sleep ${opts.interval ?? 1}`,
    'done',
  ].join('\n');
}

/**
 * The string ssh sends for the POSIX watcher. The script travels base64-encoded
 * inside a line that obeys the connect script's quoting rules (no `'`, `\`, `!`
 * or newline), so every login shell reads it the same; the decoder's flag is
 * probed, because GNU and busybox spell it `-d`, older macOS only `-D`, and a
 * host with neither tool still has openssl.
 */
export function posixWatchCommand(script: string): string {
  const encoded = Buffer.from(script, 'utf-8').toString('base64');
  const line =
    'if base64 -d </dev/null >/dev/null 2>&1; then d="base64 -d"; ' +
    'elif base64 -D </dev/null >/dev/null 2>&1; then d="base64 -D"; ' +
    'else d="openssl base64 -d -A"; fi; ' +
    `printf %s ${encoded} | $d | sh`;
  if (/['\\\n!]/.test(line)) throw new Error('The watch command would break its quoting.');
  return `sh -c '${line}'`;
}

/** The Windows watcher: the POSIX one, rule for rule, in Windows PowerShell 5.1. */
export function buildWindowsWatchScript(opts: WatchScriptOptions): string {
  checkOptions(opts);
  const since = (opts.launchedAt - LAUNCH_SLACK_S) * 1000;
  const sleepMs = Math.round((opts.interval ?? 1) * 1000);
  return [
    "$ProgressPreference='SilentlyContinue'",
    "$R=if($env:CLAUDE_CONFIG_DIR){$env:CLAUDE_CONFIG_DIR}else{Join-Path $env:USERPROFILE '.claude'}",
    "$S=Join-Path $R 'sessions';$P=Join-Path $R 'projects'",
    `$W=${opts.pid};$T=${since}`,
    `$D=${windowsDirExpr(opts.dir)}`,
    '$D=try{(Resolve-Path -LiteralPath $D -EA Stop).ProviderPath}catch{$D}',
    "function N($p){($p -replace '[\\\\/]+','/').TrimEnd('/').ToLowerInvariant()}",
    // A write to a closed channel throws, which ends the script like SIGPIPE.
    'function Say($m){[Console]::Out.Write("@cl $m`n");[Console]::Out.Flush()}',
    'function A($i){[bool](Get-Process -Id $i -EA SilentlyContinue)}',
    'function E($f){try{Get-Content -LiteralPath $f -Raw -EA Stop|ConvertFrom-Json}catch{$null}}',
    // Parent pid through CIM, which a user may be denied: then nothing
    // descends. A denied call was measured at ~5 s on the test host, inside the
    // loop that enforces teardown and sends the heartbeat, so the first refusal
    // is remembered and never paid again.
    '$global:CIM=$true',
    'function Par($i){if(-not $global:CIM){return $null};try{(Get-CimInstance Win32_Process -Filter "ProcessId=$i" -EA Stop).ParentProcessId}catch{$global:CIM=$false;$null}}',
    'function Desc($i){$q=$i;for($k=0;$k -lt 8;$k++){$q=Par $q;if(-not $q -or $q -le 4){return $false};if($q -eq $W){return $true}};$false}',
    '$ND=N $D;$cp=0;$sid=$null;$st=$null;$f=$null;$off=0;$n=0;$wt=$false',
    'Say "hello 1"',
    'Say "cwd $D"',
    'while($true){',
    ' if(-not (A $W)){Say "gone";exit 0}',
    ' if(-not $cp){',
    '  if(Test-Path -LiteralPath (Join-Path $S "$W.json")){$cp=$W}else{',
    '   $c=@(Get-ChildItem -LiteralPath $S -Filter *.json -EA SilentlyContinue|%{E $_.FullName}|?{$_ -and $_.cwd -and (N $_.cwd) -eq $ND -and $_.startedAt -ge $T -and (A $_.pid) -and (Desc $_.pid)})',
    '   if($c.Count -eq 1){$cp=[int]$c[0].pid}elseif($c.Count -gt 1){Say "ambiguous $($c.Count)"}else{Say "search"}}}',
    ' if($cp){',
    '  $e=E (Join-Path $S "$cp.json")',
    '  if(-not (A $cp)){Say "gone";exit 0}',
    '  if($e){',
    '   if($e.sessionId -and $e.sessionId -ne $sid){$sid=$e.sessionId;$f=$null;$off=0;$wt=$false;Say "session $sid"}',
    '   if($e.status -and $e.status -ne $st){$st=$e.status;Say "status $st"}}',
    '  if($sid -and -not $f){',
    '   $f=Get-ChildItem -Path (Join-Path (Join-Path $P \'*\') "$sid.jsonl") -EA SilentlyContinue|Select-Object -First 1 -ExpandProperty FullName',
    '   if(-not $f -and -not $wt){$wt=$true;Say "wait"}}',
    '  if($f){',
    // ReadWrite+Delete share: the CLI keeps appending to this file, and a
    // reader that denied writers would make its writes fail.
    "   try{$fs=[IO.File]::Open($f,'Open','Read','ReadWrite, Delete')}catch{$f=$null;$fs=$null}",
    '   if($fs){try{',
    '    $len=$fs.Length',
    '    if($len -lt $off){$off=0;Say "reset"}',
    '    while($off -lt $len){',
    `     $m=[Math]::Min(${FRAME_BYTES},$len-$off);$b=New-Object byte[] $m;$fs.Position=$off;$r=$fs.Read($b,0,$m)`,
    '     if($r -le 0){break}',
    '     Say "data $off $([Convert]::ToBase64String($b,0,$r))";$off+=$r}',
    '   }finally{$fs.Dispose()}}}}',
    ` $n++;if($n % ${TICK_EVERY} -eq 0){Say "tick"}`,
    ` Start-Sleep -Milliseconds ${sleepMs}`,
    '}',
  ].join('\n');
}

/** What ssh runs on the host to watch the session, for the system it runs. */
export function buildRemoteWatchCommand(os: RemoteOs, opts: WatchScriptOptions): string {
  return os === 'windows'
    ? windowsCommandString(buildWindowsWatchScript(opts))
    : posixWatchCommand(buildPosixWatchScript(opts));
}

/**
 * The watcher's ssh argv. `-T`: no remote tty, so the frames arrive as written
 * and a Windows host returns its real exit code. With a control socket it rides
 * the pane's master (`ControlMaster=no` never makes this one a master); without
 * one, or when the master is gone, it logs in on its own and ssh asks whatever
 * it has to ask in the PTY the Lens reads. The keepalives are shorter than the
 * pane's: this channel is what tells the Lens the host went away.
 */
export function buildWatchSshArgs(
  host: Pick<RemoteHost, 'target' | 'port'>,
  remoteCommand: string,
  controlPath: string | null
): string[] {
  return [
    '-T',
    '-o',
    'ConnectTimeout=15',
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=3',
    ...(controlPath ? ['-o', 'ControlMaster=no', '-o', `ControlPath=${controlPath}`] : []),
    ...(host.port ? ['-p', String(host.port)] : []),
    '--',
    host.target,
    remoteCommand,
  ];
}
