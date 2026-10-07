import { createPortal } from 'react-dom';
import type { ActiveSession, SessionActivity } from '../../../types';
import { spanLabel } from './background-shells';
import { ToneDot } from './ToneDot';
import { useMinuteClock } from './use-minute-clock';
import {
  TONE_LABEL,
  chipTone,
  instanceProjectName,
  instanceTitle,
  registryEntryFor,
  type TerminalInstance,
} from './terminal-instances';

/** What a tab has no room for: the whole title, the project, and what the
 *  session is doing and since when. Nothing the registry and the
 *  transcript tail do not already say. */
export function SessionTabCard({
  inst,
  rect,
  activeSessions,
  activity,
}: {
  inst: TerminalInstance;
  rect: DOMRect;
  activeSessions: readonly ActiveSession[] | undefined;
  activity: SessionActivity | undefined;
}) {
  const now = useMinuteClock(true);
  const tone = chipTone(inst.report, activeSessions);
  const entry = registryEntryFor(inst.report, activeSessions);
  const state =
    tone === 'waiting' && entry?.waitingFor
      ? `${TONE_LABEL[tone]}: ${entry.waitingFor}`
      : TONE_LABEL[tone];
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
      <div className="cl-stab-card-state cl-parked-state" data-tone={tone}>
        <ToneDot tone={tone} />
        <span>{since ? `${state} · open ${since}` : state}</span>
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

/** The subject of the call in a word: a command is the program its last
 *  statement runs (past `cd … &&` and `VAR=…`), a path its file name. The whole
 *  command does not fit a card, and half of one is noise. */
function shortArg(tool: { name: string; arg: string }): string {
  const arg = tool.arg.trim();
  if (tool.name === 'Bash') {
    const last = arg.split(/&&|\|\||;/).pop() ?? '';
    return (
      last
        .trim()
        .split(/\s+/)
        .find(w => !w.includes('=')) ?? ''
    );
  }
  if (/[\\/]/.test(arg) && !/\s/.test(arg)) return arg.split(/[\\/]/).filter(Boolean).pop() ?? arg;
  return arg;
}
