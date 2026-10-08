import { useCallback, useEffect, useMemo, useState } from 'react';
import { TopBar } from '../shared/TopBar';
import { CloseOverlayButton } from '../shared/CloseOverlayButton';
import { SessionDetailPanel } from '../shared/SessionDetailPanel';
import { overlayCrumb, type SessionOverlay } from '../shared/session-overlay';
import { currentModel, toolRunStatus, type ToolGroup } from './utils';
import { pendingToolThought } from './thoughts';
import { LiveInTerminalBadge } from './atoms';
import { ChatComposer } from './ChatComposer';
import { LiveTurn } from './LiveTurn';
import { TranscriptBody } from './TranscriptBody';
import { VaultLinksProvider } from '../../VaultLinks';
import { useLiveChat } from './useLiveChat';
import { useSideQuestions } from './useSideQuestions';
import { SideQuestionCard } from './SideQuestionCard';
import { sessionTitle } from '../utils';
import { useActiveSessions, useSessionList } from '../../../hooks/useIPC';
import type { Agent, SessionSummary, Skill } from '../../../hooks/useIPC';

/** The in-app SDK chat — a Claude Code conversation driven by the Agent SDK
 *  stream, read with the same column as the Lens (`TranscriptBody`, #304).
 *
 *  Two entry points: a brand-new conversation (no `resumeSession`), or
 *  **continuing an existing session** from the session row's "Chat" action —
 *  the transcript is then seeded from disk and the first send resumes the same
 *  `.jsonl`, so the conversation picks up where the terminal (or a previous
 *  in-app chat) left off. If the session is live in a terminal right now the
 *  composer is locked (replying would race the CLI on the same transcript) and
 *  the transcript follows the disk until the terminal session ends.
 *
 *  All conversation state lives in `useLiveChat` — the single owner of the IPC
 *  subscriptions, the in-flight turn and the committed transcript. This view is
 *  the frame: the top bar, the detail opened over the conversation, and the
 *  composer. The column draws the transcript exactly as the Lens does — MIN
 *  folding with its diffs, skills and agents, find, the pill — with the turn
 *  being streamed (`LiveTurn`) under the list, never as a row of it.
 *
 *  What a streamed turn lacks until the session is reread is what the stream
 *  does not carry: a turn's effort and git branch, and skill expansions. The
 *  tool's structured output (diffs, line numbers, published pages) does
 *  arrive, stamped in the main process (`streamedChatMessage`). */
export function LiveChatView({
  project,
  resumeSession,
  onBack,
}: {
  project: { hash: string; realPath: string };
  /** When set, continue this existing session instead of starting a new one. */
  resumeSession?: SessionSummary;
  onBack: () => void;
}) {
  const resume = useMemo(
    () =>
      resumeSession
        ? { hash: project.hash, sessionId: resumeSession.filename.replace(/\.jsonl$/, '') }
        : undefined,
    [project.hash, resumeSession]
  );

  // A resumed session may be running in a terminal right now (the registry
  // tracks CLI sessions only, so our own SDK session can never self-lock).
  // While it is: the composer locks — replying here would race the CLI on the
  // same transcript — and the transcript follows the disk so the terminal's
  // conversation flows through this view. The CLI updates its registry file on
  // exit, so the watcher push unlocks the composer by itself.
  const { data: activeSessions = [] } = useActiveSessions();
  const liveInTerminal =
    resume !== undefined && activeSessions.some(a => a.sessionId === resume.sessionId);

  const chat = useLiveChat(project.realPath, resume, liveInTerminal);
  // `/btw` from the composer: asked on this chat's own live session, so it
  // reads the session's prompt cache and leaves the conversation as it is.
  // This view is keyed per session in `ProjectOverview`, so another
  // conversation starts with no thread.
  const sideQuestions = useSideQuestions(chat.sessionId);

  // First prompt titles the view once sent (optimistic bubble included).
  const firstPrompt = useMemo(() => {
    for (const m of chat.displayMessages) {
      if (m.role !== 'user') continue;
      const text = m.content.find(b => b.type === 'text');
      if (text && text.type === 'text') return text.text;
    }
    return '';
  }, [chat.displayMessages]);

  const title = resumeSession
    ? sessionTitle(resumeSession)
    : firstPrompt
      ? firstPrompt.length > 48
        ? `${firstPrompt.slice(0, 48)}…`
        : firstPrompt
      : 'New chat';

  // The model the conversation is currently on — seeds the composer's model
  // picker so a reply defaults to the same model, exactly as a resumed terminal
  // session would. Same answer the control pill prints in `ChatView`, from the
  // same helper: two surfaces naming different models for one chat is worse
  // than either of them being wrong.
  const inheritedModel = useMemo(() => currentModel(chat.displayMessages), [chat.displayMessages]);

  // The running tool's own note, for the in-flight chip. `ToolActivity` carries
  // no id (it is emitted before the call's input has streamed), so the note is
  // matched by tool name against the newest call still awaiting a result.
  // Keyed on the tool NAME, not on the ToolActivity object: that one is
  // re-emitted every `tool_progress` heartbeat with a new `elapsedSeconds`, and
  // the sentence does not change when the clock beside it does — otherwise the
  // whole transcript is walked once a second for a value already known.
  const runningTool = chat.liveTool?.toolName ?? null;
  const liveThought = useMemo(
    () => (runningTool ? pendingToolThought(chat.displayMessages, runningTool) : ''),
    [runningTool, chat.displayMessages]
  );

  // The session's own row, as the session list reads it: the same spend the Lens
  // and the list print. A new chat has none until the SDK writes its transcript;
  // the pill says `—` until then rather than a zero nobody measured.
  const { data: projectSessions } = useSessionList(project.hash);
  const summary = useMemo(() => {
    if (!chat.sessionId) return null;
    const filename = `${chat.sessionId}.jsonl`;
    return (
      projectSessions?.find(s => s.filename === filename) ??
      (resumeSession?.filename === filename ? resumeSession : null)
    );
  }, [chat.sessionId, projectSessions, resumeSession]);

  // A tool, a skill or an agent opened from the transcript covers the
  // conversation — composer included, which stays mounted with its draft.
  const [overlay, setOverlay] = useState<SessionOverlay | null>(null);
  const closeOverlay = useCallback(() => setOverlay(null), []);
  const openTool = useCallback((group: ToolGroup) => setOverlay({ kind: 'tool', group }), []);
  const openSkill = useCallback((skill: Skill) => setOverlay({ kind: 'skill-def', skill }), []);
  const openAgent = useCallback((agent: Agent) => setOverlay({ kind: 'agent-def', agent }), []);

  // An approval request closes the detail: the turn waits on it, and it is
  // answered in the composer, which the detail covers.
  const permId = chat.permRequest?.requestId ?? null;
  const [seenPermId, setSeenPermId] = useState(permId);
  if (permId !== seenPermId) {
    setSeenPermId(permId);
    if (permId !== null) setOverlay(null);
  }

  // Esc closes the detail — the keyboard half of the crumb and the ✕.
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverlay(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay]);

  const crumb = overlayCrumb(overlay);
  const showLive =
    chat.streaming &&
    (chat.streamText !== '' || chat.liveTool !== null || chat.liveMessages.length === 0);
  const placeholder = chat.hasConversation
    ? null
    : chat.seedLoading
      ? 'Loading session…'
      : 'Start a new session in this project. Your first message creates the transcript — it streams live here and is saved to disk (readable later in the terminal or as a read-only session), but this view never reloads it from disk.';

  return (
    <VaultLinksProvider root={project.realPath}>
      <div className="cl-chat">
        <TopBar
          // Same stack rule as every frame: with a detail open the arrow returns
          // to the conversation, and only from the conversation does it leave.
          onBack={overlay ? closeOverlay : onBack}
          backLabel={overlay ? 'Back to chat' : 'Sessions'}
          crumbs={[
            {
              label: title,
              accent: !overlay,
              onClick: overlay ? closeOverlay : undefined,
              title: overlay ? 'Back to chat (Esc)' : undefined,
            },
            ...(crumb
              ? [
                  {
                    accent: true,
                    label: (
                      <span className="inline-flex items-center" style={{ gap: 6 }}>
                        {crumb.icon && <span aria-hidden>{crumb.icon}</span>}
                        <span style={{ letterSpacing: '0.1em' }}>
                          {crumb.kind === 'tool'
                            ? crumb.label.toUpperCase()
                            : `${crumb.kind} · ${crumb.label}`}
                        </span>
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
          right={
            overlay ? (
              <>
                {overlay.kind === 'tool' && (
                  <span
                    className={`cl-tool-status ${toolRunStatus(overlay.group.result, overlay.group.use.name).tone}`}
                  >
                    {toolRunStatus(overlay.group.result, overlay.group.use.name).label}
                  </span>
                )}
                <CloseOverlayButton label="Back to chat" onClose={closeOverlay} />
              </>
            ) : liveInTerminal ? (
              <LiveInTerminalBadge />
            ) : undefined
          }
        />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
          }}
        >
          <TranscriptBody
            project={project}
            messages={chat.displayMessages}
            placeholder={placeholder}
            // The session id arrives mid-life and must not re-key the scroller.
            scrollKey={project.hash}
            sessionId={chat.sessionId}
            summary={summary}
            hidden={overlay !== null}
            onOpenTool={openTool}
            onOpenSkill={openSkill}
            onOpenAgent={openAgent}
            // The live turn already prints the running call's note.
            narrate={false}
            tail={
              showLive
                ? n => (
                    <LiveTurn
                      text={chat.streamText}
                      tool={chat.liveTool}
                      thought={liveThought}
                      turnNumber={n}
                    />
                  )
                : undefined
            }
            composer={{
              locked: liveInTerminal,
              node: (
                <ChatComposer
                  projectHash={project.hash}
                  realPath={project.realPath}
                  // Undefined on the first send of a new chat (→ startMessage); set up
                  // front when resuming, and once the SDK reports the id later sends
                  // push into the same live session.
                  sessionId={chat.sessionId ?? undefined}
                  model={inheritedModel}
                  sending={chat.streaming}
                  errorText={chat.errorText}
                  permRequest={chat.permRequest}
                  permPendingCount={chat.permPendingCount}
                  onRespondPermission={chat.respondPermission}
                  onSend={(text, opts) => void chat.send(text, opts)}
                  onStop={chat.stop}
                  onSideQuestion={sideQuestions.ask}
                  above={<SideQuestionCard thread={sideQuestions} />}
                  onEscape={sideQuestions.exchanges.length > 0 ? sideQuestions.clear : undefined}
                  lockNotice={
                    liveInTerminal
                      ? 'This session is live in your terminal — replying here would race it on the same transcript. The composer unlocks when the terminal session ends.'
                      : null
                  }
                />
              ),
            }}
          />

          {overlay && (
            <section
              aria-label="Detail"
              className="absolute z-50 flex flex-col overflow-hidden"
              style={{ inset: 0, background: 'var(--cl-paper)' }}
            >
              <SessionDetailPanel
                overlay={overlay}
                project={project}
                sessionId={chat.sessionId}
                onClose={closeOverlay}
              />
            </section>
          )}
        </div>
      </div>
    </VaultLinksProvider>
  );
}
