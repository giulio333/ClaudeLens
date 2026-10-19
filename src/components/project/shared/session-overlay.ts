import type { Agent, Skill } from '../../../hooks/useIPC';
import { resolveToolIcon, type SessionAgent, type ToolGroup } from '../chat/utils';
import type { FileChange } from '../terminal/mission-feed';
import { fileName } from '../chat/file-view';

/** A detail opened over a session — from its transcript, or from the Mission
 *  Control rail. One switch renders them all (`SessionDetailPanel`), so a tool
 *  or a skill reads the same whichever host opened it. */
export type SessionOverlay =
  | { kind: 'tool'; group: ToolGroup }
  | { kind: 'change'; change: FileChange }
  | { kind: 'agent'; agent: SessionAgent }
  | { kind: 'skill-def'; skill: Skill }
  | { kind: 'agent-def'; agent: Agent }
  | { kind: 'team'; teamName: string }
  | { kind: 'file'; rel: string }
  /** A memory topic, on the Files page. `fallback` is the operation that opens
   *  instead when the topic is no longer there to read. */
  | { kind: 'memory'; path: string; fallback?: ToolGroup };

export type OverlayCrumb = { icon?: string; kind: string; label: string };

/** What the open overlay is called in the top bar. The detail views do not say
 *  it themselves: they render `chromeless`, so this crumb is the only place the
 *  frame states which of the session's units is on screen. */
export function overlayCrumb(overlay: SessionOverlay | null): OverlayCrumb | null {
  if (!overlay) return null;
  switch (overlay.kind) {
    case 'tool':
      return {
        icon: resolveToolIcon(
          overlay.group.use.name,
          overlay.group.use.input as Record<string, unknown>
        ),
        kind: 'tool',
        label: overlay.group.use.name,
      };
    case 'change':
      return { kind: 'change', label: overlay.change.name };
    case 'agent':
      return { kind: 'agent', label: overlay.agent.subagentType || 'agent' };
    case 'skill-def':
      return { kind: 'skill', label: overlay.skill.name };
    case 'agent-def':
      return { kind: 'agent', label: overlay.agent.name };
    case 'team':
      return { kind: 'team', label: overlay.teamName };
    // Named here like every other detail, so every overlay closes from the
    // same place: the page's own ✕ beside its name was a second spot for it.
    case 'file':
      return { kind: 'file', label: fileName(overlay.rel) };
    case 'memory':
      return { kind: 'memory', label: fileName(overlay.path) };
  }
}
