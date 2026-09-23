import {
  ClaudeMdLayer,
  SessionSummary,
  MemoryTopic,
  Skill,
  Agent,
  McpServer,
  Plan,
} from '../../hooks/useIPC';

/** What identifies an exchange page: the receiving session and the message id
 *  the two transcripts are joined on. */
export interface ExchangeEntry {
  project: { hash: string; realPath: string };
  sessionId: string;
  msgId: string;
}

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
  /** A session read on its own, outside Mission Control.
   *
   *  **Nothing navigates here any more.** The two entry points that did — a
   *  search hit and a memory topic's origin session — go to `terminal` now: a
   *  bare `ChatView` has no rail, and the rail is where a session's agents,
   *  skills and questions are listed since the control pill stopped carrying
   *  them. The case is kept (rather than deleted with `ChatView`'s whole
   *  `!embedded` half) so that removal can be read as its own diff. */
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
      from?: 'agents-live' | 'search' | 'memory-topic' | 'exchange';
      /** Scroll the Lens to the turn holding this message on open (a search hit).
       *  By uuid, never by position: the transcript reads through the SDK, which
       *  truncates at the compaction boundary, so a hit found on disk may have no
       *  turn here — and an index would have jumped to the wrong one instead of
       *  saying so. */
      focusMessageUuid?: string;
      /** The query that led here, so Back returns to the results instead of an
       *  empty search field. */
      searchQuery?: string;
      /** Set when `from` is `memory-topic`: Back walks to that topic, not to the
       *  project's session list. */
      memoryTopic?: { topic: MemoryTopic; content: string; hash: string };
      /** Set when `from` is `exchange`: Back returns to that exchange, which may
       *  belong to another project than the session on screen. */
      exchange?: ExchangeEntry;
    }
  /** The conversation a message from another session belongs to (#280), opened
   *  from the inbound bubble that carries its `msgId`. `project` and `sessionId`
   *  are the RECEIVER's — the chat the page was opened from — and where Back
   *  returns. */
  | ({ type: 'exchange' } & ExchangeEntry)
  | { type: 'memory-topic'; topic: MemoryTopic; content: string; hash: string }
  | { type: 'ai-assistant'; project: { hash: string; realPath: string } }
  | { type: 'live-monitor'; project: { hash: string; realPath: string } }
  | { type: 'agents-live'; project?: { hash: string; realPath: string } }
  /** Global "what is running right now": live CLI sessions across every project
   *  plus the background agents that are actually alive. */
  | { type: 'monitor' }
  | { type: 'duplicates' }
  | { type: 'settings' }
  /** Claude Code on another machine, over the system ssh (#242). */
  | { type: 'remote' };
