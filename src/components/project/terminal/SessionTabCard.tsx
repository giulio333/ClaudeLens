import { createPortal } from 'react-dom';
import type { ActiveSession, SessionActivity } from '../../../types';
import { branchLabel } from '../chat/git-state';
import { spanLabel } from './background-shells';
import { shortArg } from './tab-live';
import { ToneDot } from './ToneDot';
import { useMinuteClock } from './use-minute-clock';
import {
  asksQuestion,
  chipTone,
  instanceProjectName,
  instanceTitle,
  registryEntryFor,
  stateLabel,
  type TerminalInstance,
} from './terminal-instances';

/** What a tab has no room for: the whole title, the project, and what the
 *  session is doing and since when. Nothing the registry and the
 *  transcript tail do not already say. */
export function SessionTabCard({
  inst,
  rect,
  unseen = false,
  activeSessions,
  activity,
}: {
  inst: TerminalInstance;
  rect: DOMRect;
  /** The turn ended while the session was off screen. */
  unseen?: boolean;
  activeSessions: readonly ActiveSession[] | undefined;
  activity: SessionActivity | undefined;
}) {
  const now = useMinuteClock(true);
  const tone = chipTone(inst.report, activeSessions);
  const entry = registryEntryFor(inst.report, activeSessions);
  const state = stateLabel(tone, entry);
  const since = entry?.startedAt && tone !== 'ended' ? spanLabel(now - entry.startedAt) : null;
  const tool = tone === 'busy' ? activity?.lastTool : null;
  const subject = tool ? shortArg(tool) : '';
  const color = inst.report.color;
  return createPortal(
    <div
      role="tooltip"
      className="cl-stab-card"
      style={{ top: rect.bottom + 6, left: Math.max(8, rect.left) }}
    >
      <div className={`cl-stab-card-title${color ? ` cl-session-identity ${color}` : ''}`}>
        {instanceTitle(inst)}
      </div>
      <div className="cl-stab-card-project">{instanceProjectName(inst)}</div>
      {/* Two tabs of one project in two worktrees read the same until here. */}
      {inst.report.gitBranch && (
        <div className="cl-stab-card-branch">{branchLabel(inst.report.gitBranch)}</div>
      )}
      <div className="cl-stab-card-state cl-parked-state" data-tone={tone}>
        <ToneDot tone={tone} question={asksQuestion(entry?.waitingFor)} unseen={unseen} />
        <span>
          {since ? `${state} · open ${since}` : state}
          {unseen && ' · not seen yet'}
        </span>
      </div>
      {tool && (
        <div className="cl-stab-card-tool">
          <span>{tool.name}</span>
          {subject && <span className="cl-stab-card-arg">{subject}</span>}
        </div>
      )}
    </div>,
    document.body
  );
}
