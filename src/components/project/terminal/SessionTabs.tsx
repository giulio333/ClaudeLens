import { useRef, useState, type CSSProperties } from 'react';
import { useActiveSessions, useSessionActivity } from '../../../hooks/useIPC';
import type { ActiveSession, SessionActivity } from '../../../types';
import { LiveOrb } from '../../LiveOrb';
import { inFlightTool } from '../../live-orb';
import { OpenSessionsButton } from './ParkedTerminals';
import { SessionTabCard } from './SessionTabCard';
import { useStripOverflow } from './strip-overflow';
import { CONTEXT_HIGH, contextShare, liveLine, newestWrite } from './tab-live';
import { useBump } from './use-bump';
import { ToneDot } from './ToneDot';
import {
  justAsked,
  justSettled,
  showsUnseen,
  waitingLong,
  type TabAttention,
} from './tab-attention';
import { useMinuteClock } from './use-minute-clock';
import { useTabAttention } from './use-tab-attention';
import { useTabHover } from './use-tab-hover';
import {
  asksQuestion,
  chipTone,
  endNeedsConfirm,
  instanceProjectName,
  instanceTitle,
  registryEntryFor,
  stateLabel,
  tabGroups,
  type ChipTone,
  type TerminalInstance,
} from './terminal-instances';

/**
 * The first row of Mission Control: every open session as a tab. A click on a
 * tab brings that session on screen and keeps the one it replaces running; its
 * ✕ ends it. `+` opens a new session in the project on screen, and the grid
 * button before the tabs lists every one of them — the way out when they no
 * longer fit — once there are two.
 *
 * A tab says which session it is (its title, in the session's colour, under
 * its project's name, printed once per group) and what state it is in: the dot of the background badge, or the
 * thinking orb while Claude works — the orb that the old top bar's WORKING
 * carried, now on the session it belongs to.
 *
 * When the tabs no longer fit they scroll (`useStripOverflow`) behind faded
 * edges, `+` kept outside the row so it never scrolls away, the tab on screen
 * kept in sight, and a mark on an edge past which a session waits for the user
 * or finished unseen — a click on it brings that tab into view.
 *
 * The pointer on a tab slides in a line beside its title — what the session is
 * doing, what it waits on, how long it has been idle — with how full its
 * context window is, which the tab wears at rest as a faint fill from the left
 * (`tab-live.ts`), turning to the accent near compaction.
 *
 * What a tab remembers between two looks (`TabAttentionProvider`) is drawn on
 * it too: a ring on the dot of a session whose turn ended out of sight, the orb
 * settling into the dot and the `?` arriving — each only for a change newer
 * than this strip, which remounts on every switch — a tint on a tab whose
 * question has gone unanswered for minutes, and a grey on an ended one.
 *
 * `activeSessions` and `activity` stand in for the registry and the transcript
 * tails where the instances are not real ones (the "What's new" preview), as on
 * `ParkedTerminals`.
 */
export function SessionTabs({
  instances,
  currentId,
  onSelect,
  onClose,
  onNew,
  activeSessions: registryOverride,
  activity: activityOverride,
}: {
  instances: readonly TerminalInstance[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  activeSessions?: readonly ActiveSession[];
  activity?: readonly SessionActivity[];
}) {
  const { data: registry } = useActiveSessions();
  const activeSessions = registryOverride ?? registry;
  const { data: liveActivity } = useSessionActivity();
  const activity = activityOverride ?? liveActivity;
  const { hover, enter, leave } = useTabHover();
  const hovered = hover && instances.find(i => i.id === hover.id);
  const attention = useTabAttention();
  // The changes this strip has already been drawn after: anything older is
  // history, and replaying its animation on a switch of tab would be noise.
  const [mountedSeq] = useState(() => attention.seq);
  const toneOf = new Map(instances.map(i => [i.id, chipTone(i.report, activeSessions)]));
  // "Idle · 4 min" on hover and the tint of a long wait both age without a
  // write anywhere: the clock ticks while there is a tab to age.
  const now = useMinuteClock(instances.length > 0);
  const groups = tabGroups(instances);
  const rowRef = useRef<HTMLDivElement>(null);
  const rowKey = instances.map(i => `${i.id}:${i.report.title ?? ''}`).join('|');
  const { overflow, reveal } = useStripOverflow(rowRef, currentId, rowKey);
  // What a tab out of sight must not hide: a wait, or a turn finished unseen.
  const needsYou = (id: string) => {
    const tone = toneOf.get(id) ?? 'idle';
    return tone === 'waiting' || (id !== currentId && showsUnseen(attention.byId[id], tone));
  };

  const close = (inst: TerminalInstance) => {
    const tone = chipTone(inst.report, activeSessions);
    if (
      endNeedsConfirm(tone, inst.report) &&
      !window.confirm('Claude is still working in this session. Close it anyway?')
    ) {
      return;
    }
    onClose(inst.id);
  };

  return (
    <>
      {/* Before the tabs, not after `+`: it stays put however many tabs there
          are, and with one session there is nothing to list. */}
      {instances.length > 1 && (
        <OpenSessionsButton
          instances={instances}
          currentId={currentId}
          onRestore={onSelect}
          onClose={onClose}
          activeSessions={registryOverride}
        />
      )}
      <nav
        className="cl-stabs"
        aria-label="Open sessions"
        data-grouped={groups.length > 1 || undefined}
        onMouseLeave={leave}
      >
        <div className="cl-stabs-viewport">
          <div
            ref={rowRef}
            className="cl-stabs-scroll"
            data-more-left={overflow.moreLeft || undefined}
            data-more-right={overflow.moreRight || undefined}
            onScroll={leave}
          >
            {/* The project is named once, before its tabs: the reducer keeps a
                project's sessions together (`tabGroups`). */}
            {groups.map(group => (
              <div
                key={group.id}
                className="cl-stabs-group"
                role="group"
                aria-label={group.project}
              >
                <span className="cl-stabs-group-label" aria-hidden>
                  {group.project}
                </span>
                {group.instances.map(inst => {
                  const entry = registryEntryFor(inst.report, activeSessions);
                  return (
                    <SessionTab
                      key={inst.id}
                      inst={inst}
                      on={inst.id === currentId}
                      tone={toneOf.get(inst.id) ?? 'idle'}
                      entry={entry}
                      attention={attention.byId[inst.id]}
                      mountedSeq={mountedSeq}
                      now={now}
                      activity={activity?.find(a => a.sessionId === inst.report.sessionId)}
                      onEnter={el => enter(inst.id, el)}
                      onPick={() => {
                        leave();
                        if (inst.id !== currentId) onSelect(inst.id);
                      }}
                      onClose={() => close(inst)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <EdgeMark side="left" ids={overflow.left.filter(needsYou)} onReveal={reveal} />
          <EdgeMark side="right" ids={overflow.right.filter(needsYou)} onReveal={reveal} />
        </div>
        <button
          type="button"
          className="cl-stabs-icon cl-stabs-new"
          aria-label="New session"
          title="New session in this project"
          onClick={onNew}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </button>
      </nav>
      {hovered && hover && (
        <SessionTabCard
          inst={hovered}
          rect={hover.rect}
          unseen={
            hovered.id !== currentId &&
            showsUnseen(attention.byId[hovered.id], chipTone(hovered.report, activeSessions))
          }
          activeSessions={activeSessions}
          activity={activity?.find(a => a.sessionId === hovered.report.sessionId)}
        />
      )}
    </>
  );
}

/** One tab: the session's state, its title in its colour, and its ✕. The
 *  project is not repeated here — its group names it once. */
function SessionTab({
  inst,
  on,
  tone,
  entry,
  attention,
  mountedSeq,
  now,
  activity,
  onEnter,
  onPick,
  onClose,
}: {
  inst: TerminalInstance;
  on: boolean;
  tone: ChipTone;
  entry: ActiveSession | undefined;
  attention: TabAttention | undefined;
  mountedSeq: number;
  now: number;
  activity: SessionActivity | undefined;
  onEnter: (el: HTMLElement) => void;
  onPick: () => void;
  onClose: () => void;
}) {
  const project = instanceProjectName(inst);
  const title = instanceTitle(inst);
  const color = inst.report.color;
  const unseen = !on && showsUnseen(attention, tone);
  const motion = justAsked(attention, mountedSeq)
    ? 'ask'
    : justSettled(attention, mountedSeq)
      ? 'settle'
      : null;
  // An ended session's window says nothing any more.
  const share = tone === 'ended' ? null : contextShare(activity);
  // The rhythm of the work, each a count of changes since the tab mounted, so
  // a switch of tab replays none of them: a call made, a file written, a
  // result that came back an error.
  const ready = activity !== undefined;
  const beat = useBump(activity?.toolCount, ready);
  const write = newestWrite(activity);
  const wrote = useBump(write?.key, ready);
  const fault = useBump(activity?.errorCount, ready);
  return (
    <div
      className="cl-stab"
      data-tab-id={inst.id}
      data-on={on}
      data-tone={tone}
      data-unseen={unseen || undefined}
      data-long-wait={waitingLong(tone, entry?.statusUpdatedAt, now) || undefined}
      data-ctx={share === null ? undefined : share >= CONTEXT_HIGH ? 'high' : 'some'}
      data-fault={alternate(fault)}
      style={share === null ? undefined : ({ '--cl-ctx': share } as CSSProperties)}
      onMouseEnter={e => onEnter(e.currentTarget)}
    >
      <button
        type="button"
        className="cl-stab-main"
        aria-current={on ? 'page' : undefined}
        aria-label={`${title} · ${project} — ${stateLabel(tone, entry)}${
          unseen ? ', not seen yet' : ''
        }`}
        onClick={onPick}
      >
        {tone === 'busy' ? (
          <span className="cl-stab-orb">
            <LiveOrb tone="violet" tool={inFlightTool(activity)} />
            {/* One satellite per sub-agent at work, three at most: DOM, not
                the orb's canvas, which takes its colours in hex only. */}
            {(activity?.delegates ?? []).slice(0, 3).map((d, i) => (
              <span
                key={d.id}
                className="cl-stab-sat"
                style={{ '--i': i } as CSSProperties}
                aria-hidden
              />
            ))}
          </span>
        ) : (
          <ToneDot
            tone={tone}
            question={asksQuestion(entry?.waitingFor)}
            unseen={unseen}
            motion={motion}
          />
        )}
        {/* One slot, three faces: the title at rest; under the pointer the
            live line rolls in over it and gets the tab's whole width (sharing
            it, both were cut to a few letters); a file written rolls its name
            in for a moment. The label above says all of it already. */}
        <span className="cl-stab-slot" data-wrote={alternate(wrote)}>
          <span className={`cl-stab-title${color ? ` cl-session-identity ${color}` : ''}`}>
            {title}
          </span>
          <span className="cl-stab-live" aria-hidden>
            <span className="cl-stab-live-text">{liveLine(tone, entry, activity, now)}</span>
            {share !== null && <span className="cl-stab-ctx">{Math.round(share * 100)}%</span>}
          </span>
          {wrote > 0 && write && (
            <span key={wrote} className="cl-stab-wrote" aria-hidden>
              {write.name}
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        className="cl-stab-close"
        aria-label={`Close ${project} · ${title}`}
        title="End this session"
        onClick={onClose}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      </button>
      {/* Keyed on their counts: a new key is a new element, and its animation
          plays once more. */}
      {beat > 0 && <span key={`beat-${beat}`} className="cl-stab-beat" aria-hidden />}
      {wrote > 0 && <span key={`flash-${wrote}`} className="cl-stab-flash" aria-hidden />}
      {fault > 0 && <span key={`fault-${fault}`} className="cl-stab-fault" aria-hidden />}
    </div>
  );
}

/** Two names for one animation, taken in turn: an element keeps its
 *  attribute, and only a change of animation name plays it again. */
function alternate(count: number): 'a' | 'b' | undefined {
  return count === 0 ? undefined : count % 2 ? 'a' : 'b';
}

/** The mark on an edge past which a session needs the user: it waits, or its
 *  turn finished unseen. A click brings the nearest such tab into view. */
function EdgeMark({
  side,
  ids,
  onReveal,
}: {
  side: 'left' | 'right';
  ids: string[];
  onReveal: (id: string) => void;
}) {
  if (ids.length === 0) return null;
  const n = ids.length;
  const label = `${n} ${n === 1 ? 'session needs' : 'sessions need'} you, to the ${side}`;
  return (
    <button
      type="button"
      className="cl-stabs-edge"
      data-side={side}
      aria-label={label}
      title={label}
      onClick={() => onReveal(side === 'left' ? ids[n - 1] : ids[0])}
    >
      <span className="cl-stabs-edge-dot" aria-hidden />
    </button>
  );
}
