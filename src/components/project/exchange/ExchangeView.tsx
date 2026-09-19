import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ExchangeMessage,
  ExchangeOutcome,
  ExchangeParty,
  SessionSummary,
} from '../../../types';
import { useExchange } from '../../../hooks/useIPC';
import { TopBar } from '../shared/TopBar';
import { Lens } from '../overview/Lens';
import { projectDisplayName } from '../shared/projectName';
import { fmtDate } from '../utils';
import Markdown from '../../Markdown';

type Project = { hash: string; realPath: string };

/**
 * The exchange a message from another session belongs to (#280).
 *
 * Both halves of every message between the two sessions, in arrival order —
 * the conversation that actually happened, which until now could only be
 * reconstructed by opening each session and reading it in order, knowing which
 * sessions to open. Entered from the inbound bubble, which knows its `msgId`.
 *
 * What is drawn is what the reader could join, and nothing is claimed past
 * that: a sender whose transcript is gone is named by the name it declared
 * and said to be unresolved, never dressed up as a session that can be opened.
 */
export function ExchangeView({
  project,
  sessionId,
  msgId,
  onBack,
  onOpenTurn,
}: {
  /** The project of the session the page was opened from — the receiver. */
  project: Project;
  sessionId: string;
  msgId: string;
  onBack: () => void;
  onOpenTurn: (project: Project, session: SessionSummary, messageUuid: string) => void;
}) {
  const [openError, setOpenError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useExchange({ sessionId, msgId });

  const parties = new Map((data?.parties ?? []).map(p => [p.id, p]));
  const party = (id: string): ExchangeParty => parties.get(id) ?? { id };
  const label = (id: string) => partyLabel(party(id));

  /**
   * Open a session at one turn. The chat view is driven by a `SessionSummary`
   * — the row the sessions list builds, with the session's own figures on it —
   * and an exchange carries none of that, so the real one is fetched from the
   * project's own list and the open is refused when it is not there: a
   * transcript deleted since the read is not a session that can be opened.
   */
  async function openTurn(p: ExchangeParty, uuid: string) {
    if (!p.sessionId || !p.projectHash) return;
    setOpenError(null);
    const target: Project = {
      hash: p.projectHash,
      // Unresolved cwd: the receiver's own project is the one path we know.
      realPath: p.projectPath ?? (p.projectHash === project.hash ? project.realPath : ''),
    };
    try {
      const sessions = await qc.fetchQuery<SessionSummary[]>({
        queryKey: ['sessions:project', p.projectHash],
        queryFn: () => unwrapSessions(p.projectHash!),
      });
      const session = sessions.find(s => s.filename === `${p.sessionId}.jsonl`);
      if (!session) {
        setOpenError(
          `That session is no longer in ${projectDisplayName(target.realPath) || 'its project'} — it may have been deleted since the exchange was read.`
        );
        return;
      }
      onOpenTurn(target, session, uuid);
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} backLabel="Session" crumbs={[{ label: 'Exchange', accent: true }]} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <Lens />
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>Between two sessions</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Exchange</span>
            <span className="glyph">.</span>
          </h1>

          {data && (
            <>
              <div className="cl-exchange-parties">
                {orderedParties(data, sessionId).map(p => (
                  <PartyCard key={p.id} party={p} isHere={p.id === sessionId} />
                ))}
              </div>
              <div className="cl-hband" style={{ marginTop: 20 }}>
                <div className="cl-hcell">
                  <div className="lbl">Messages</div>
                  <div className="num">{data.messages.length}</div>
                  <div className="sub">both directions</div>
                </div>
                <div className="cl-hcell">
                  <div className="lbl">Transcripts read</div>
                  <div className="num">{data.scanned}</div>
                  <div className="sub">every project</div>
                </div>
                <div className="cl-hcell">
                  <div className="lbl">Took</div>
                  <div className="num">{data.elapsedMs}</div>
                  <div className="sub">ms</div>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="cl-section">
          {openError && (
            <div
              role="alert"
              style={{
                fontSize: 13,
                color: 'var(--cl-ink-2)',
                border: '1px solid var(--cl-line)',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 16,
              }}
            >
              {openError}
            </div>
          )}

          {isLoading && (
            <div style={{ fontSize: 13, color: 'var(--cl-ink-3)' }}>
              Reading transcripts across every project…
            </div>
          )}

          {isError && (
            <div role="alert" style={{ fontSize: 13, color: 'var(--cl-ink-2)' }}>
              {error instanceof Error ? error.message : 'The exchange could not be read.'}
            </div>
          )}

          {!isLoading && !isError && data === null && (
            <div style={{ fontSize: 13, color: 'var(--cl-ink-3)' }}>
              This message is not in this transcript — nothing to join on. The session may have been
              rewritten since it was opened.
            </div>
          )}

          {data && (
            <div className="cl-exchange-thread">
              {data.messages.map(m => (
                <MessageRow
                  // The row it landed on is unique by construction; the id is
                  // only as unique as the writer made it.
                  key={m.receivedUuid || m.msgId}
                  message={m}
                  isEntry={m.msgId === data.entryMsgId}
                  isOwn={m.from === sessionId}
                  sender={party(m.from)}
                  receiver={party(m.to)}
                  label={label}
                  onOpenTurn={openTurn}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** The other side first — the party the reader came here to learn about —
 *  then the session the page was opened from. */
function orderedParties(data: ExchangeOutcome, here: string): ExchangeParty[] {
  const entry = data.messages.find(m => m.msgId === data.entryMsgId);
  const ids = entry ? [entry.from, entry.to] : data.parties.map(p => p.id);
  const byId = new Map(data.parties.map(p => [p.id, p]));
  return [...new Set([...ids, here])].map(id => byId.get(id) ?? { id });
}

/** What a party is called on the page: the name it declared, else its
 *  session's title, else the short id. The name is the sender's own claim and
 *  it changes, so the card says what it rests on. */
function partyLabel(p: ExchangeParty): string {
  return p.name ?? p.sessionTitle ?? (p.sessionId ? p.sessionId.slice(0, 8) : 'unknown session');
}

function PartyCard({ party, isHere }: { party: ExchangeParty; isHere: boolean }) {
  const projectName = party.projectPath
    ? projectDisplayName(party.projectPath)
    : (party.projectHash ?? null);
  return (
    <div
      className={`cl-exchange-party${isHere ? ' cl-exchange-party--here' : ''}`}
      data-testid="party"
    >
      <div className="cl-exchange-party-name">{partyLabel(party)}</div>
      <div className="cl-exchange-party-meta">
        {isHere && <span className="cl-exchange-party-here">this session</span>}
        {projectName && <span>{projectName}</span>}
        {party.sessionId ? (
          <span title={party.sessionId}>
            {party.sessionTitle && party.name ? party.sessionTitle : party.sessionId.slice(0, 8)}
          </span>
        ) : (
          <span
            className="cl-exchange-party-missing"
            title={
              party.fingerprint
                ? `Known only by the fingerprint ${party.fingerprint} its messages carry and the name it declared.`
                : 'Known only by the name it declared.'
            }
          >
            transcript not found
          </span>
        )}
      </div>
    </div>
  );
}

function MessageRow({
  message: m,
  isEntry,
  isOwn,
  sender,
  receiver,
  label,
  onOpenTurn,
}: {
  message: ExchangeMessage;
  isEntry: boolean;
  /** Sent by the session the page was opened from — drawn on the other side. */
  isOwn: boolean;
  sender: ExchangeParty;
  receiver: ExchangeParty;
  label: (id: string) => string;
  onOpenTurn: (party: ExchangeParty, uuid: string) => void;
}) {
  const canOpenSender = !!(m.sentTurnUuid && sender.sessionId && sender.projectHash);
  const canOpenReceiver = !!(receiver.sessionId && receiver.projectHash);
  return (
    <article
      className={`cl-exchange-msg${isOwn ? ' cl-exchange-msg--own' : ''}${isEntry ? ' cl-exchange-msg--entry' : ''}`}
      data-msg-id={m.msgId}
      aria-current={isEntry ? 'true' : undefined}
    >
      <div className="cl-exchange-strip">
        <span className="cl-exchange-arrow" aria-hidden>
          ⇢
        </span>
        <span className="cl-exchange-from" data-testid="sender">
          {label(m.from)}
        </span>
        <span className="cl-exchange-to">→ {label(m.to)}</span>
        {m.queued && (
          <span className="cl-exchange-queued" title="It arrived while a turn was running">
            mid-turn
          </span>
        )}
        {isEntry && <span className="cl-exchange-entry">you came from here</span>}
        <time className="cl-exchange-time">{fmtDate(m.timestamp)}</time>
      </div>
      {m.summary && <div className="cl-exchange-summary">{m.summary}</div>}
      <div className="cl-exchange-body">
        <Markdown>{m.text}</Markdown>
      </div>
      {m.hops && m.hops.length > 1 && (
        <div
          className="cl-exchange-hops"
          data-testid="hops"
          title="The sessions this message's chain passed through, in order. A reply sent from inside the turn a message started inherits its chain; one appears twice when it answers an answer."
        >
          via {m.hops.map(label).join(' → ')}
        </div>
      )}
      <div className="cl-exchange-actions">
        {canOpenSender && (
          <button
            type="button"
            className="cl-exchange-open"
            onClick={() => onOpenTurn(sender, m.sentTurnUuid!)}
          >
            Open sending turn
          </button>
        )}
        {canOpenReceiver && (
          <button
            type="button"
            className="cl-exchange-open"
            onClick={() => onOpenTurn(receiver, m.receivedUuid)}
          >
            Open where it arrived
          </button>
        )}
      </div>
    </article>
  );
}

/** The sessions list, unwrapped the way `useIPC` unwraps it — this call goes
 *  through `fetchQuery` (a click, not a mounted query), so it can't reuse the
 *  hook. */
async function unwrapSessions(hash: string): Promise<SessionSummary[]> {
  const res = await window.electronAPI.sessions.listByProject(hash);
  if (res.error) throw new Error(res.error);
  return res.data ?? [];
}
