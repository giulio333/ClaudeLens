import {
  ClaudeMdLayer,
  SessionSummary,
  MemoryTopic,
  Skill,
  Agent,
  McpServer,
  Plan,
  InstalledPlugin,
} from '../../hooks/useIPC';

export type View =
  | { type: 'global-home' }
  | { type: 'overview' }
  | { type: 'global-claudemd' }
  | { type: 'global-skills' }
  | { type: 'skill-detail'; skill: Skill }
  | { type: 'skill-create'; project?: { hash: string; realPath: string } }
  | { type: 'global-agents' }
  | { type: 'agent-detail'; agent: Agent }
  | { type: 'agent-create'; project?: { hash: string; realPath: string } }
  | { type: 'global-mcp' }
  | { type: 'mcp-detail'; server: McpServer; totalProjects: number }
  | { type: 'plugins' }
  | { type: 'plugin-detail'; plugin: InstalledPlugin }
  | { type: 'studio' }
  | { type: 'studio-create' }
  | { type: 'studio-blueprint'; name: string; projectPath?: string }
  | { type: 'project-skills'; project: { hash: string; realPath: string } }
  | { type: 'project-agents'; project: { hash: string; realPath: string } }
  | { type: 'project-mcp'; project: { hash: string; realPath: string } }
  | { type: 'project-tasks'; project: { hash: string; realPath: string } }
  | { type: 'project-config'; project: { hash: string; realPath: string } }
  | { type: 'project-plans'; project: { hash: string; realPath: string } }
  | { type: 'plan-detail'; project: { hash: string; realPath: string }; plan: Plan }
  | { type: 'project-workflows'; project: { hash: string; realPath: string } }
  | {
      type: 'workflow-detail';
      project: { hash: string; realPath: string };
      sessionId: string;
      runId: string;
    }
  | { type: 'project-teams'; project: { hash: string; realPath: string } }
  | { type: 'team-detail'; project: { hash: string; realPath: string }; teamName: string }
  | { type: 'project-claudemd'; project: { hash: string; realPath: string }; layer: ClaudeMdLayer }
  | { type: 'project-memory'; project: { hash: string; realPath: string } }
  | { type: 'sessions'; project: { hash: string; realPath: string } }
  | { type: 'analytics'; project: { hash: string; realPath: string } }
  | {
      type: 'chat';
      project: { hash: string; realPath: string };
      session: SessionSummary;
      from?: 'agents-live' | 'sessions' | 'search';
      /** Scroll to the turn holding this message on open (a search hit). By uuid,
       *  never by position: the transcript view reads through the SDK, which
       *  truncates at the compaction boundary, so a hit found on disk may have no
       *  turn here — and an index would have jumped to the wrong one instead of
       *  saying so. */
      focusMessageUuid?: string;
      /** The query that led here, so Back returns to the results instead of an
       *  empty search field. */
      searchQuery?: string;
    }
  /** Full-text search over the transcripts. `scope` set = started from inside a
   *  project, so the scan begins narrowed to it. */
  | { type: 'search'; query: string; scope?: { hash: string; realPath: string } }
  | {
      type: 'new-chat';
      project: { hash: string; realPath: string };
      resumeSession?: SessionSummary;
    }
  | {
      type: 'terminal';
      project: { hash: string; realPath: string };
      resumeSessionId?: string;
      attachJobId?: string;
      from?: 'agents-live';
    }
  | { type: 'memory-topic'; topic: MemoryTopic; content: string; hash: string }
  | { type: 'ai-assistant'; project: { hash: string; realPath: string } }
  | { type: 'live-monitor'; project: { hash: string; realPath: string } }
  | { type: 'agents-live'; project?: { hash: string; realPath: string } }
  /** Global "what is running right now": live CLI sessions across every project
   *  plus the background agents that are actually alive. */
  | { type: 'monitor' }
  | { type: 'duplicates' }
  | { type: 'settings' };
