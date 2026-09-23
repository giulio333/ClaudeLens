import type { RemoteHost } from '../../../../electron/shared/remote-host';
import type { RemoteLensChannel } from '../../../../electron/shared/remote-session';
import { BetaTag } from '../shared/BetaTag';
import { STATUS_LABEL, type TerminalStatus } from '../terminal/TerminalPane';
import { channelNote } from './remote-lens';

/**
 * The two pieces of a connected remote pane that say where the session runs:
 * the status in the top bar and the banner above the terminal. Their own file
 * so the "What's new" popup can draw the real ones without mounting the pane.
 */

export function RemoteStatus({ status, hostName }: { status: TerminalStatus; hostName: string }) {
  const running = status === 'running';
  return (
    <span
      className="flex items-center font-mono uppercase"
      style={{ gap: 7, fontSize: 9.5, letterSpacing: '0.16em', color: 'var(--cl-ink-3)' }}
    >
      <span
        aria-hidden
        className={running ? 'cl-live-dot' : ''}
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: running ? 'var(--cl-ok)' : 'var(--cl-ink-4)',
        }}
      />
      {(running ? 'RUNNING' : STATUS_LABEL[status].toUpperCase()) + ` ON ${hostName.toUpperCase()}`}
    </span>
  );
}

// Always on screen while connected: a remote session must never read as a local
// one, and the way Lens reaches the host — one login or two — is stated rather
// than discovered when ssh asks for a password a second time.
export function RemoteBanner({
  host,
  channel,
}: {
  host: RemoteHost;
  channel: RemoteLensChannel | null;
}) {
  return (
    <div
      role="note"
      className="flex items-baseline flex-wrap"
      style={{ gap: 10, fontSize: 12, color: 'var(--cl-ink-3)' }}
    >
      <span
        className="font-mono uppercase"
        style={{ fontSize: 9.5, letterSpacing: '0.16em', color: 'var(--cl-accent)' }}
      >
        Remote · {host.target}
      </span>
      <BetaTag />
      <span>
        This session runs on {host.name}.{' '}
        {channel
          ? channelNote(channel, host.name)
          : 'Its history stays there, so Lens and Mission Control on this machine do not show it.'}
      </span>
    </div>
  );
}
