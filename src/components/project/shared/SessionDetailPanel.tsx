import type { SessionSummary } from '../../../hooks/useIPC';
import { ToolDetailPanel } from '../chat/ToolDetailPanel';
import { SubagentTranscriptPanel } from '../chat/SubagentTranscriptPanel';
import { FileChangePage } from '../chat/FileChangesStrip';
import { SkillDetailView } from '../skills/SkillDetailView';
import { AgentDetailView } from '../agents/AgentDetailView';
import { TeamDetailView } from '../teams/TeamDetailView';
import { FileViewer } from '../files/FileViewer';
import type { SessionMarks } from '../files/session-marks';
import type { SessionOverlay } from './session-overlay';

/**
 * The detail a session's frame opens over its reading column: a tool call, a
 * file change, a sub-agent's transcript, a skill or agent definition, a team, a
 * project file. Every panel renders `chromeless`, since the crumb, the ✕ and
 * Esc belong to the frame, and a panel drawing its own bar would repeat them
 * one line lower.
 *
 * The host positions it. Mission Control scopes it to the pane area beside the
 * rail; the SDK chat covers its workspace. A kind whose inputs the host did not
 * pass renders nothing: a team needs `onOpenChat`, a sub-agent a session id.
 */
export function SessionDetailPanel({
  overlay,
  project,
  sessionId,
  onClose,
  fileOpenerFor,
  fileMarks,
  onOpenChat,
}: {
  overlay: SessionOverlay;
  project: { hash: string; realPath: string };
  sessionId: string | null;
  onClose: () => void;
  /** Opens a file of this project in the frame's Files viewer. */
  fileOpenerFor?: (path: string) => (() => void) | undefined;
  /** What this session did to each file, for the Files viewer's mark. */
  fileMarks?: SessionMarks | null;
  /** "Open chat" from a team's detail. */
  onOpenChat?: (session: SessionSummary) => void;
}) {
  switch (overlay.kind) {
    case 'tool':
      return <ToolDetailPanel group={overlay.group} onBack={onClose} chromeless />;
    case 'change':
      return (
        <div className="cl-file-change-scroll">
          <FileChangePage
            file={overlay.change.file}
            onOpenFile={overlay.change.deleted ? undefined : fileOpenerFor?.(overlay.change.path)}
          />
        </div>
      );
    case 'skill-def':
      return (
        <SkillDetailView
          skill={overlay.skill}
          project={project}
          onBack={onClose}
          readOnly
          chromeless
        />
      );
    case 'agent-def':
      return (
        <AgentDetailView
          agent={overlay.agent}
          project={project}
          onBack={onClose}
          readOnly
          chromeless
        />
      );
    case 'team':
      return onOpenChat ? (
        <TeamDetailView
          project={project}
          teamName={overlay.teamName}
          onBack={onClose}
          backLabel="Close"
          onOpenChat={onOpenChat}
          chromeless
        />
      ) : null;
    case 'file':
      return (
        <FileViewer
          key={overlay.rel}
          root={project.realPath}
          rel={overlay.rel}
          version={fileMarks?.writes.get(overlay.rel) ?? 0}
          mark={fileMarks?.files.get(overlay.rel)}
          onClose={onClose}
        />
      );
    case 'agent':
      return overlay.agent.agentId && sessionId ? (
        <SubagentTranscriptPanel
          hash={project.hash}
          sessionFilename={`${sessionId}.jsonl`}
          agentId={overlay.agent.agentId}
          subagentType={overlay.agent.subagentType}
          description={overlay.agent.description}
          onBack={onClose}
          chromeless
        />
      ) : null;
  }
}
