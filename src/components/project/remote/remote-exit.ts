import {
  REMOTE_EXIT,
  type RemoteLaunchMode,
  type RemoteOs,
} from '../../../../electron/shared/remote-host';

/** What the notice under a finished remote connection offers next. */
export type RemoteNoticeAction = 'update' | 'reconnect' | 'retry' | 'hosts';

export interface RemoteNotice {
  tone: 'warn' | 'ok' | 'neutral';
  title: string;
  body: string;
  actions: RemoteNoticeAction[];
}

export interface RemoteExitContext {
  mode: RemoteLaunchMode;
  hostName: string;
  target: string;
  dir: string;
  minVersion: string;
  os: RemoteOs;
}

// ssh's own failure code: the host is unreachable, the login was refused, or
// the host key was not accepted. The remote script never uses it.
const SSH_FAILED = 255;

/**
 * What a remote connection's exit code means, in words. The connect script
 * prints its own reason in the terminal before it exits, and the terminal is
 * left uncovered, so the notice names the case and the next step, and points
 * at that output rather than repeating it.
 */
export function remoteExitNotice(code: number, ctx: RemoteExitContext): RemoteNotice {
  const host = ctx.hostName;
  if (code === SSH_FAILED) {
    return {
      tone: 'warn',
      title: `Could not connect to ${ctx.target}`,
      body: 'ssh ended with code 255: the host is unreachable, or the login was refused. What ssh said is in the terminal.',
      actions: ['retry', 'hosts'],
    };
  }
  if (code === REMOTE_EXIT.notFound) {
    return {
      tone: 'warn',
      title: `Claude Code was not found on ${host}`,
      body:
        ctx.os === 'windows'
          ? 'Neither the PATH of the host nor %USERPROFILE%\\.local\\bin or %APPDATA%\\npm holds a claude. Install Claude Code there (in PowerShell: irm https://claude.ai/install.ps1 | iex), or add its folder to the user PATH.'
          : 'Neither the PATH of the host nor ~/.local/bin, ~/.claude/local, /opt/homebrew/bin or /usr/local/bin holds a claude. Install Claude Code there, or add its folder to PATH in ~/.profile on the host.',
      actions: ['retry', 'hosts'],
    };
  }
  return ctx.mode === 'update' ? updateNotice(code, host) : sessionNotice(code, ctx);
}

function updateNotice(code: number, host: string): RemoteNotice {
  if (code === 0) {
    return {
      tone: 'ok',
      title: `Claude Code on ${host} is updated`,
      body: 'Connect again to start the session.',
      actions: ['reconnect', 'hosts'],
    };
  }
  return {
    tone: 'warn',
    title: 'The update did not finish',
    body: `claude update exited with code ${code} on ${host}. Its output is in the terminal.`,
    actions: ['retry', 'hosts'],
  };
}

function sessionNotice(code: number, ctx: RemoteExitContext): RemoteNotice {
  const host = ctx.hostName;
  switch (code) {
    case REMOTE_EXIT.outdated:
      return {
        tone: 'warn',
        title: `Claude Code on ${host} is too old`,
        body: `It is older than ${ctx.minVersion}, the version this ClaudeLens requires, so the session was not started. The version it runs is printed in the terminal.`,
        actions: ['update', 'hosts'],
      };
    case REMOTE_EXIT.unknownVersion:
      return {
        tone: 'warn',
        title: `Could not read the Claude Code version on ${host}`,
        body: 'The session was not started: ClaudeLens does not run a version it cannot check. What claude --version answered is in the terminal.',
        actions: ['retry', 'hosts'],
      };
    case REMOTE_EXIT.noDir:
      return {
        tone: 'warn',
        title: `${ctx.dir} does not exist on ${host}`,
        body: 'Go back to the host and pick another folder.',
        actions: ['hosts'],
      };
    default:
      return {
        tone: 'neutral',
        title: `The session on ${host} ended`,
        body: code ? `Claude Code exited with code ${code}.` : 'Claude Code exited.',
        actions: ['reconnect', 'hosts'],
      };
  }
}

export function remoteActionLabel(action: RemoteNoticeAction, hostName: string): string {
  switch (action) {
    case 'update':
      return `Update Claude Code on ${hostName}`;
    case 'reconnect':
      return 'Connect again';
    case 'retry':
      return 'Try again';
    case 'hosts':
      return 'Back to hosts';
  }
}
