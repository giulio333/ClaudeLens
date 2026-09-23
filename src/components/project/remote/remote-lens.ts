// The pure half of the remote Lens view (#294), kept apart so the component
// files export only components (fast refresh, `--max-warnings 0`).
import type { SessionSummary } from '../../../hooks/useIPC';
import type {
  RemoteLensChannel,
  RemoteLensState,
} from '../../../../electron/shared/remote-session';
import type { RemoteTranscript } from '../../remote-origin';

/** What the page says about how it reaches the host — never hidden, because a
 *  second login is something the user will be asked for. */
export function channelNote(channel: RemoteLensChannel, hostName: string): string {
  return channel === 'shared'
    ? `Lens and Mission Control read it from ${hostName} over this terminal's own ssh connection, so nothing is asked twice. Nothing of it is saved on this machine.`
    : `Lens and Mission Control read it from ${hostName} over a second ssh login: if ssh asks for your password or a code again, answer it in the Lens tab. Nothing of it is saved on this machine.`;
}

/**
 * The key the remote session's views are given for the project. Never a local
 * project's folder name — `:` is one character Claude Code's folder naming
 * never produces — so nothing keyed on it can meet this machine's data.
 */
export function remoteProjectHash(hostId: string): string {
  return `remote:${hostId}`;
}

/** The transcript handed to `ChatView` and `MissionRail`, once there is a session. */
export function remoteTranscript(
  lens: RemoteLensState | null,
  hostName: string
): RemoteTranscript | undefined {
  if (!lens?.sessionId) return undefined;
  return {
    hostName,
    messages: lens.messages,
    status: lens.status,
    summary: lens.summary,
  };
}

/** The summary `ChatView` needs: the figures the host's transcript gave, or
 *  zeros while there are none yet. */
export function remoteSessionSummary(lens: RemoteLensState | null): SessionSummary | null {
  if (!lens?.sessionId) return null;
  return (
    lens.summary ?? {
      filename: `${lens.sessionId}.jsonl`,
      date: '',
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
      cacheSavings: 0,
      messageCount: 0,
      models: {},
    }
  );
}
