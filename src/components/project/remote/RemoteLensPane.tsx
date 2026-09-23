import { useState, type MutableRefObject } from 'react';
import type { SessionSummary } from '../../../hooks/useIPC';
import type { RemoteHost } from '../../../../electron/shared/remote-host';
import type { RemoteLensState } from '../../../../electron/shared/remote-session';
import type { RemoteTranscript } from '../../remote-origin';
import { ChatView } from '../chat/ChatView';
import type { ToolGroup } from '../chat/utils';

/**
 * The Lens tab of a remote pane (#294): the session the host is running, read
 * over a second ssh channel and drawn by the same `ChatView` a local session
 * uses, with `remote` set so it reads nothing about the project here. Until
 * there is a transcript to draw, it says where the reading stands — and when
 * ssh asks something on that second channel, it asks it here, since only this
 * page knows the question is for the Lens and not for the terminal.
 */
export function RemoteLensPane({
  lens,
  host,
  project,
  transcript,
  session,
  onOpenTool,
  jumpToTurnRef,
  onBack,
}: {
  lens: RemoteLensState | null;
  host: RemoteHost;
  project: { hash: string; realPath: string };
  transcript: RemoteTranscript | undefined;
  session: SessionSummary | null;
  onOpenTool: (group: ToolGroup) => void;
  jumpToTurnRef: MutableRefObject<((n: number) => void) | null>;
  onBack: () => void;
}) {
  const showTranscript = !!transcript && !!session && transcript.messages.length > 0;
  return (
    <div className="h-full flex flex-col" style={{ minHeight: 0 }}>
      {lens && showTranscript && lens.phase !== 'live' && (
        <LensStrip lens={lens} hostName={host.name} />
      )}
      {showTranscript ? (
        <div className="flex-1 min-h-0">
          <ChatView
            embedded
            project={project}
            session={session}
            remote={transcript}
            onBack={onBack}
            onOpenTool={onOpenTool}
            jumpToTurnRef={jumpToTurnRef}
          />
        </div>
      ) : (
        <LensStatus lens={lens} host={host} dir={project.realPath} />
      )}
    </div>
  );
}

function LensStatus({
  lens,
  host,
  dir,
}: {
  lens: RemoteLensState | null;
  host: RemoteHost;
  dir: string;
}) {
  const phase = lens?.phase ?? 'starting';
  const say = (title: string, body?: string) => (
    <div className="cl-empty" style={{ margin: '48px auto', maxWidth: 560 }}>
      <div style={{ fontSize: 14, color: 'var(--cl-ink)', marginBottom: body ? 6 : 0 }}>
        {title}
      </div>
      {body && <div style={{ fontSize: 12.5, color: 'var(--cl-ink-3)' }}>{body}</div>}
    </div>
  );
  switch (phase) {
    case 'starting':
      return say(
        `Lens starts once Claude Code is running on ${host.name}.`,
        'Sign in and pass the version check in the Terminal tab first.'
      );
    case 'connecting':
      return say(`Opening the connection that reads the session on ${host.name}…`);
    case 'prompt':
      return <LensPrompt lens={lens!} hostName={host.name} />;
    case 'searching':
      return say(
        `Looking for this session in the registry on ${host.name}…`,
        'Claude Code registers it once it has started. If it is asking something in the Terminal tab — whether to trust the folder, a sign-in — answer it there.'
      );
    case 'ambiguous':
      return say(
        `${lens?.detail ?? 'Several'} sessions on ${host.name} were started from this terminal in ${lens?.cwd ?? dir}.`,
        'Lens does not guess which one to show. It picks it up as soon as only one is left.'
      );
    case 'waiting':
      return say(
        'The session has no transcript yet.',
        'Claude Code writes it with the first prompt; it appears here as soon as it does.'
      );
    case 'live':
      return say('The session has no messages yet.');
    case 'ended':
      return say(`The session on ${host.name} ended before it wrote a transcript.`);
    case 'failed':
      return <LensFailed lens={lens!} hostName={host.name} />;
  }
}

/** A one-line note over a transcript that is no longer being followed. */
function LensStrip({ lens, hostName }: { lens: RemoteLensState; hostName: string }) {
  const text =
    lens.phase === 'ended'
      ? `The session on ${hostName} ended. This is what it wrote.`
      : lens.phase === 'failed'
        ? `Lens stopped following the session: ${lens.detail ?? 'the connection closed'}.`
        : lens.phase === 'waiting'
          ? 'The session was cleared: waiting for its new transcript.'
          : null;
  if (!text) return null;
  return (
    <div
      role="status"
      className="shrink-0"
      style={{
        padding: '8px 14px',
        fontSize: 12.5,
        color: 'var(--cl-ink-2)',
        background: 'var(--cl-paper-2)',
        borderBottom: '1px solid var(--cl-line)',
      }}
    >
      {text}
      {lens.phase === 'failed' && <RetryButton terminalId={lens.terminalId} inline />}
    </div>
  );
}

function LensFailed({ lens, hostName }: { lens: RemoteLensState; hostName: string }) {
  return (
    <div className="cl-empty" style={{ margin: '48px auto', maxWidth: 560 }}>
      <div style={{ fontSize: 14, color: 'var(--cl-ink)', marginBottom: 6 }}>
        Lens could not read the session on {hostName}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--cl-ink-3)', marginBottom: 14 }}>
        {lens.detail ?? 'The connection closed.'} The terminal is not affected.
      </div>
      <RetryButton terminalId={lens.terminalId} />
    </div>
  );
}

function RetryButton({ terminalId, inline }: { terminalId: string; inline?: boolean }) {
  return (
    <button
      type="button"
      className={inline ? 'cl-btn cl-btn--quiet' : 'cl-btn cl-btn--primary'}
      style={inline ? { marginLeft: 10 } : undefined}
      onClick={() => void window.electronAPI.remote.retryLens(terminalId)}
    >
      Try again
    </button>
  );
}

/**
 * ssh asking something on the Lens channel: the password or code of a second
 * login. The question is printed as ssh wrote it, and the answer goes to that
 * channel only — it is never stored, and the field clears once it is sent.
 */
function LensPrompt({ lens, hostName }: { lens: RemoteLensState; hostName: string }) {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="cl-empty"
      style={{ margin: '48px auto', maxWidth: 560, textAlign: 'left' }}
      aria-label="Answer ssh for the Lens connection"
      onSubmit={e => {
        e.preventDefault();
        const text = answer;
        setAnswer('');
        window.electronAPI.remote
          .answerLens(lens.terminalId, text)
          .then(res => setError(res.error))
          .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Failed.'));
      }}
    >
      <div style={{ fontSize: 14, color: 'var(--cl-ink)', marginBottom: 6 }}>
        ssh asks again, for the connection Lens reads {hostName} with
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--cl-ink-3)', marginBottom: 12 }}>
        This is a second login: the terminal&apos;s connection could not be shared with it.
      </div>
      <label
        htmlFor="remote-lens-answer"
        className="font-mono"
        style={{ display: 'block', fontSize: 12, color: 'var(--cl-ink-2)', marginBottom: 6 }}
      >
        {lens.prompt}
      </label>
      <div className="flex" style={{ gap: 8 }}>
        <input
          id="remote-lens-answer"
          type="password"
          autoComplete="off"
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          className="flex-1 rounded-none border border-[var(--cl-line)] bg-[var(--cl-paper)] px-3 py-2 text-[13px] text-[var(--cl-ink)] outline-none focus:border-[var(--cl-ink)]"
        />
        <button className="cl-btn cl-btn--primary" type="submit">
          Send
        </button>
      </div>
      {error && <p className="mt-2 font-mono text-[10px] text-[var(--cl-danger)]">{error}</p>}
    </form>
  );
}
