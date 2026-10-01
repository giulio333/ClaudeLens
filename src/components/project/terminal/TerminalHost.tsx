import { memo, useCallback, type ReactNode } from 'react';
import { ErrorBoundary } from '../../ErrorBoundary';
import { TerminalMissionControl } from './TerminalMissionControl';
import type { InstanceReport, TerminalInstance } from './terminal-instances';

type Project = { hash: string; realPath: string };

/**
 * Every embedded terminal that is alive, the one on screen and the parked ones.
 *
 * A `claude` in a terminal lives exactly as long as its Mission Control is
 * mounted, so keeping a session running while the user is elsewhere means
 * keeping it mounted: this host sits outside ProjectOverview's view switch and
 * hides what is not on screen (`display: none`, which TerminalPane already
 * survives — its fit skips a 0×0 box and catches up when shown again).
 *
 * Each instance has its own error boundary, keyed by the instance and not by the
 * view: a boundary keyed by the whole view object remounted Mission Control —
 * killing the process — whenever any field of the view changed, even the
 * project's provisional hash being swapped for the real one.
 */
export function TerminalHost({
  instances,
  currentId,
  projects,
  chips,
  onBack,
  onPark,
  onReport,
  onOpenSession,
  onOpenExchange,
}: {
  instances: readonly TerminalInstance[];
  currentId: string | null;
  /** The known projects, to read a parked instance's project under its real
   *  hash once Claude Code has created its folder. */
  projects: readonly Project[] | undefined;
  /** The other sessions' chips, for the top bar of the one on screen. */
  chips: ReactNode;
  onBack: (inst: TerminalInstance) => void;
  onPark: (inst: TerminalInstance) => void;
  onReport: (id: string, report: Partial<InstanceReport>) => void;
  onOpenSession: (inst: TerminalInstance, resumeSessionId: string) => void;
  onOpenExchange: (inst: TerminalInstance, entry: { sessionId: string; msgId: string }) => void;
}) {
  if (instances.length === 0) return null;
  return (
    <div className="cl-app" style={{ display: currentId ? undefined : 'none' }}>
      {instances.map(inst => {
        const on = inst.id === currentId;
        const project =
          projects?.find(p => p.realPath === inst.view.project.realPath) ?? inst.view.project;
        return (
          <div
            key={inst.id}
            style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: on ? undefined : 'none' }}
          >
            <ErrorBoundary>
              <TerminalSlot
                inst={inst}
                project={project}
                active={on}
                chips={on ? chips : null}
                onBack={onBack}
                onPark={onPark}
                onReport={onReport}
                onOpenSession={onOpenSession}
                onOpenExchange={onOpenExchange}
              />
            </ErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}

/** One Mission Control, with the host's callbacks bound to its instance. Memoised
 *  so a report from one instance does not re-render every other one. */
const TerminalSlot = memo(function TerminalSlot({
  inst,
  project,
  active,
  chips,
  onBack,
  onPark,
  onReport,
  onOpenSession,
  onOpenExchange,
}: {
  inst: TerminalInstance;
  project: Project;
  active: boolean;
  chips: ReactNode;
  onBack: (inst: TerminalInstance) => void;
  onPark: (inst: TerminalInstance) => void;
  onReport: (id: string, report: Partial<InstanceReport>) => void;
  onOpenSession: (inst: TerminalInstance, resumeSessionId: string) => void;
  onOpenExchange: (inst: TerminalInstance, entry: { sessionId: string; msgId: string }) => void;
}) {
  const { id } = inst;
  const back = useCallback(() => onBack(inst), [onBack, inst]);
  const park = useCallback(() => onPark(inst), [onPark, inst]);
  const report = useCallback((r: InstanceReport) => onReport(id, r), [onReport, id]);
  const openSession = useCallback(
    (sessionId: string) => onOpenSession(inst, sessionId),
    [onOpenSession, inst]
  );
  const openExchange = useCallback(
    (entry: { sessionId: string; msgId: string }) => onOpenExchange(inst, entry),
    [onOpenExchange, inst]
  );
  return (
    <TerminalMissionControl
      project={project}
      resumeSessionId={inst.view.resumeSessionId}
      attachJobId={inst.view.attachJobId}
      focusMessageUuid={inst.view.focusMessageUuid}
      onBack={back}
      onOpenSession={openSession}
      onOpenExchange={openExchange}
      active={active}
      onPark={park}
      onReport={report}
      topBarExtra={chips}
    />
  );
});
