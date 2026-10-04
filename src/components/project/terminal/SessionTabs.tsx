import { useActiveSessions, useSessionActivity } from '../../../hooks/useIPC';
import type { ActiveSession } from '../../../types';
import { LiveOrb } from '../../LiveOrb';
import { inFlightTool } from '../../live-orb';
import { OpenSessionsButton } from './ParkedTerminals';
import { SessionTabCard } from './SessionTabCard';
import { useTabHover } from './use-tab-hover';
import {
  TONE_LABEL,
  chipTone,
  endNeedsConfirm,
  instanceProjectName,
  instanceTitle,
  type TerminalInstance,
} from './terminal-instances';

/**
 * The first row of Mission Control: every open session as a tab. A click on a
 * tab brings that session on screen and keeps the one it replaces running; its
 * ✕ ends it. `+` opens a new session in the project on screen, and the grid
 * button before the tabs lists every one of them — the way out when they no
 * longer fit — once there are two.
 *
 * A tab says which session it is (its title, in the session's colour, and the
 * project) and what state it is in: the dot of the background badge, or the
 * thinking orb while Claude works — the orb that the old top bar's WORKING
 * carried, now on the session it belongs to.
 *
 * `activeSessions` stands in for the registry where the instances are not real
 * ones (the "What's new" preview), as on `ParkedTerminals`.
 */
export function SessionTabs({
  instances,
  currentId,
  onSelect,
  onClose,
  onNew,
  activeSessions: registryOverride,
}: {
  instances: readonly TerminalInstance[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  activeSessions?: readonly ActiveSession[];
}) {
  const { data: registry } = useActiveSessions();
  const activeSessions = registryOverride ?? registry;
  const { data: activity } = useSessionActivity();
  const { hover, enter, leave } = useTabHover();
  const hovered = hover && instances.find(i => i.id === hover.id);

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
      <nav className="cl-stabs" aria-label="Open sessions" onMouseLeave={leave}>
        {instances.map(inst => {
          const on = inst.id === currentId;
          const tone = chipTone(inst.report, activeSessions);
          const project = instanceProjectName(inst);
          const title = instanceTitle(inst);
          const color = inst.report.color;
          const sessionId = inst.report.sessionId;
          return (
            <div
              key={inst.id}
              className="cl-stab"
              data-on={on}
              onMouseEnter={e => enter(inst.id, e.currentTarget)}
            >
              <button
                type="button"
                className="cl-stab-main"
                aria-current={on ? 'page' : undefined}
                aria-label={`${title} · ${project} — ${TONE_LABEL[tone]}`}
                onClick={() => {
                  leave();
                  if (!on) onSelect(inst.id);
                }}
              >
                {tone === 'busy' ? (
                  <span className="cl-stab-orb">
                    <LiveOrb
                      tone="violet"
                      tool={inFlightTool(activity?.find(a => a.sessionId === sessionId))}
                    />
                  </span>
                ) : (
                  <span className="cl-parked-dot" data-tone={tone} aria-hidden />
                )}
                <span className={`cl-stab-title${color ? ` cl-session-identity ${color}` : ''}`}>
                  {title}
                </span>
                <span className="cl-stab-project">{project}</span>
              </button>
              <button
                type="button"
                className="cl-stab-close"
                aria-label={`Close ${project} · ${title}`}
                title="End this session"
                onClick={() => close(inst)}
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
            </div>
          );
        })}
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
          activeSessions={activeSessions}
          activity={activity?.find(a => a.sessionId === hovered.report.sessionId)}
        />
      )}
    </>
  );
}
