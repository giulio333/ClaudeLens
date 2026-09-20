import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ExchangeOutcome, ExchangeParty, SessionSummary } from '../../../types';
import { useExchange } from '../../../hooks/useIPC';
import { TopBar } from '../shared/TopBar';
import { Lens } from '../overview/Lens';
import { projectDisplayName } from '../shared/projectName';
import Markdown from '../../Markdown';
import {
  buildThreadRows,
  messageClock,
  summarizeExchange,
  threadDay,
  type ThreadRow,
} from './thread';

type Project = { hash: string; realPath: string };

/** Lines a message shows before it folds. A dispatch between sessions runs
 *  long — the corpus has one of 48 lines — and reading the conversation is not
 *  reading every word of it, so a long one opens summarised, exactly as the
 *  transcript's own bubble does. */
const CLAMP = 14;

/**
 * The exchange a message from another session belongs to (#280).
 *
 * Both halves of every message between the two sessions, in arrival order —
 * the conversation that actually happened, which until now could only be
 * reconstructed by opening each session and reading it in order, knowing which
 * sessions to open. Entered from either bubble — the inbound one on the
 * receiver, the outbound one on the sender — and from Mission Control's
 * messages dock.
 *
 * **It is drawn as a conversation, not as a list of joined rows.** The first
 * version repeated `sender → receiver` on every message, in a two-party
 * conversation where that never changes, and hung two buttons off each: the
 * page said four times what it could say once. Here the pair is stated at the
 * top, each message takes a side (the other party left, this session right),
 * consecutive messages from one party form a run under a single face, and the
 * two turns a message can open are footnotes inside it.
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
  /** The project of the session the page was opened from — either side. */
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
      // Unresolved cwd: the project the page was opened from is the one path
      // we know.
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

  const pair = data ? pairOf(data, sessionId) : null;
  const rows = data ? buildThreadRows(data, sessionId) : [];
  const stats = data ? summarizeExchange(data, sessionId) : null;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} backLabel="Session" crumbs={[{ label: 'Exchange', accent: true }]} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <Lens />
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>Conversation between two sessions</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">{pair ? partyLabel(pair.other) : 'Exchange'}</span>
            <span className="glyph">.</span>
          </h1>

          {pair && stats && (
            <>
              <div className="cl-xfacing">
                <PartyChip party={pair.other} />
                <span className="cl-xfacing-swap" aria-hidden>
                  ⇄
                </span>
                <PartyChip party={pair.here} isHere />
              </div>
              {/* What the page rests on — how many transcripts had to be read
                  for this answer, and how long it took — is a fact about the
                  join, not about the conversation: it belongs in a title, not
                  in three numbers the size of headlines. */}
              <p
                className="cl-xmeta"
                title={`Joined across ${data!.scanned} transcripts in ${data!.elapsedMs} ms`}
              >
                {stats.total} message{stats.total === 1 ? '' : 's'}
                {' · '}
                {stats.other} in · {stats.own} out
                {stats.span && ` · over ${stats.span}`}
              </p>
            </>
          )}
        </section>

        <section className="cl-section">
          {openError && (
            <div role="alert" className="cl-xnotice">
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
              Nothing to join on: the other half of this message is not on disk. It may have gone to
              an agent or to a session whose transcript is gone, or this session was rewritten since
              it was opened.
            </div>
          )}

          {data && (
            <div className="cl-xthread">
              <div className="cl-xday">{threadDay(data.messages)}</div>
              {rows.map(row => (
                <MessageRow
                  // The row it landed on is unique by construction; the id is
                  // only as unique as the writer made it.
                  key={row.message.receivedUuid || row.message.msgId}
                  row={row}
                  sender={party(row.message.from)}
                  receiver={party(row.message.to)}
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

/** The two sessions this conversation is between: the other side first — the
 *  party the reader came here to learn about — then the one the page was
 *  opened from. Hops can name a third session; they are not parties to this
 *  conversation and appear only on the message whose chain passed through. */
function pairOf(
  data: ExchangeOutcome,
  here: string
): { other: ExchangeParty; here: ExchangeParty } {
  const byId = new Map(data.parties.map(p => [p.id, p]));
  const entry = data.messages.find(m => m.msgId === data.entryMsgId) ?? data.messages[0];
  const ids = entry ? [entry.from, entry.to] : data.parties.map(p => p.id);
  const otherId = ids.find(id => id !== here) ?? ids[0] ?? here;
  return {
    other: byId.get(otherId) ?? { id: otherId },
    here: byId.get(here) ?? { id: here },
  };
}

/** What a party is called on the page: the name it declared, else its
 *  session's title, else the short id. The name is the sender's own claim and
 *  it changes, so the chip says what it rests on. */
function partyLabel(p: ExchangeParty): string {
  return p.name ?? p.sessionTitle ?? (p.sessionId ? p.sessionId.slice(0, 8) : 'unknown session');
}

function initial(label: string): string {
  return label.trim().slice(0, 1).toUpperCase() || '?';
}

function PartyChip({ party, isHere }: { party: ExchangeParty; isHere?: boolean }) {
  const name = partyLabel(party);
  const projectName = party.projectPath
    ? projectDisplayName(party.projectPath)
    : (party.projectHash ?? null);
  return (
    <div className={`cl-xparty${isHere ? ' is-here' : ''}`} data-testid="party">
      <span className="cl-xavatar" aria-hidden>
        {initial(name)}
      </span>
      <span className="cl-xparty-id">
        <span className="cl-xparty-name">{name}</span>
        <span className="cl-xparty-meta">
          {isHere && <span className="cl-xparty-here">this session</span>}
          {projectName && <span>{projectName}</span>}
          {party.sessionId ? (
            <span title={party.sessionId}>
              {party.sessionTitle && party.name ? party.sessionTitle : party.sessionId.slice(0, 8)}
            </span>
          ) : (
            <span
              className="cl-xparty-missing"
              title={
                party.fingerprint
                  ? `Known only by the fingerprint ${party.fingerprint} its messages carry and the name it declared.`
                  : 'Known only by the name it declared.'
              }
            >
              transcript not found
            </span>
          )}
        </span>
      </span>
    </div>
  );
}

function MessageRow({
  row,
  sender,
  receiver,
  label,
  onOpenTurn,
}: {
  row: ThreadRow;
  sender: ExchangeParty;
  receiver: ExchangeParty;
  label: (id: string) => string;
  onOpenTurn: (party: ExchangeParty, uuid: string) => void;
}) {
  const [full, setFull] = useState(false);
  const { message: m, isOwn, startsRun, isEntry } = row;
  const canOpenSender = !!(m.sentTurnUuid && sender.sessionId && sender.projectHash);
  const canOpenReceiver = !!(receiver.sessionId && receiver.projectHash);
  const name = label(m.from);
  const lines = m.text.split('\n');
  const clamped = !full && lines.length > CLAMP;
  const shown = clamped ? lines.slice(0, CLAMP).join('\n') : m.text;

  return (
    <article
      className={`cl-xmsg${isOwn ? ' is-own' : ''}${startsRun ? '' : ' is-cont'}${isEntry ? ' is-entry' : ''}`}
      data-msg-id={m.msgId}
      aria-current={isEntry ? 'true' : undefined}
    >
      {/* The face is the party's, and a run of messages from one party wears
          it once: the gutter stays for the rest of the run so the column
          never moves. */}
      <span className="cl-xmsg-face" aria-hidden>
        {startsRun ? initial(name) : ''}
      </span>

      <div className="cl-xbubble">
        <div className="cl-xbubble-head">
          <span className="cl-xbubble-name" data-testid="sender">
            {name}
          </span>
          {m.queued && (
            <span className="cl-xchip" title="It arrived while a turn was running">
              mid-turn
            </span>
          )}
          {isEntry && <span className="cl-xchip is-entry">you came from here</span>}
          <time className="cl-xbubble-time">{messageClock(m.timestamp)}</time>
        </div>

        {m.summary && <div className="cl-xbubble-summary">{m.summary}</div>}
        <div className="cl-xbubble-body">
          <Markdown>{shown}</Markdown>
        </div>
        {lines.length > CLAMP && (
          <button type="button" className="cl-xmore" onClick={() => setFull(f => !f)}>
            {clamped ? `Show all ${lines.length} lines` : 'Collapse'}
          </button>
        )}

        {(canOpenSender || canOpenReceiver) && (
          <div className="cl-xactions">
            {canOpenSender && (
              <button
                type="button"
                className="cl-xopen"
                onClick={() => onOpenTurn(sender, m.sentTurnUuid!)}
              >
                Sending turn ↗
              </button>
            )}
            {canOpenReceiver && (
              <button
                type="button"
                className="cl-xopen"
                onClick={() => onOpenTurn(receiver, m.receivedUuid)}
              >
                Where it arrived ↗
              </button>
            )}
          </div>
        )}
      </div>

      {m.hops && m.hops.length > 1 && (
        <div
          className="cl-xhops"
          data-testid="hops"
          title="The sessions this message's chain passed through, in order. A reply sent from inside the turn a message started inherits its chain; one appears twice when it answers an answer."
        >
          via {m.hops.map(label).join(' → ')}
        </div>
      )}
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
