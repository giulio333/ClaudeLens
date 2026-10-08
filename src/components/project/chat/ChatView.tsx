import { useEffect, useMemo, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { useActiveSessions, useChatSession } from '../../../hooks/useIPC';
import { SessionSummary, Skill, Agent } from '../../../hooks/useIPC';
import { sessionTitle } from '../utils';
import { buildProcessedMessages, ToolGroup, resolveToolIcon, toolRunStatus } from './utils';
import { LiveInTerminalBadge } from './atoms';
import { ToolDetailPanel } from './ToolDetailPanel';
import { VaultLinksProvider } from '../../VaultLinks';
import type { RemoteTranscript } from '../../remote-origin';
import { withBranchMarkers } from './git-state';
import { TopBar } from '../shared/TopBar';
import { CloseOverlayButton } from '../shared/CloseOverlayButton';
import { DeleteSessionDialog } from '../shared/DeleteSessionDialog';
import { SessionColorIdentity } from '../shared/SessionColorIdentity';
import { SessionGraphView } from './graph/SessionGraphView';
import { QueryError } from '../../QueryError';
import { useSessionTags } from '../../../hooks/useSessionTags';
import { ManagedTagChip } from '../sessions/ManagedTagChip';
import { TagPicker } from '../sessions/TagPicker';
import type { SessionWaiting } from './WaitingLine';
import { TranscriptBody } from './TranscriptBody';

type ViewMode = 'chat' | 'timeline';

export function ChatView({
  project,
  session,
  onBack,
  onOpenSkill,
  onOpenAgent,
  onOpenTool,
  fileOpenerFor,
  embedded = false,
  jumpToTurnRef,
  focusMessageUuid,
  remote,
  waiting,
}: {
  project: { hash: string; realPath: string };
  session: SessionSummary;
  onBack: () => void;
  /** Deep-link to a skill detail view (from an inline skill card or the dock). */
  onOpenSkill?: (skill: Skill) => void;
  /** Deep-link to an agent detail view (from an inline agent card). */
  onOpenAgent?: (agent: Agent) => void;
  /** Open the exchange an inbound message belongs to (#280): this session is
   *  the receiver, `msgId` the join key the bubble carries. */
  /** Hand a tool detail to the host frame instead of opening it here. Set by the
   *  unified Terminal/Lens view, whose own top bar carries the crumb and the way
   *  back: opened locally, the panel would sit under a bar that doesn't know it
   *  exists. Unset (standalone ChatView) the panel opens in place. */
  onOpenTool?: (group: ToolGroup) => void;
  /** Opens a file the session read in the Files viewer of the frame around the
   *  embedded view; undefined for a path it cannot open. */
  fileOpenerFor?: (path: string) => (() => void) | undefined;
  /** Imperative handle exposed to an outside navigator (the v2 Outline column):
   *  set to this view's `jumpToTurn` so a session-outline row can scroll the
   *  embedded transcript to a turn. Null while unmounted / Terminal mode. */
  jumpToTurnRef?: MutableRefObject<((n: number) => void) | null>;
  /** Rendered inside the unified Terminal/Lens view: drop the own TopBar (the
   *  unified frame provides chrome + the Terminal↔Lens switch) and the composer
   *  — this surface is read-only, the live session belongs to the terminal's
   *  PTY. The floating control pill and the left TURNS capsule stay — they
   *  anchor to the chat column. */
  embedded?: boolean;
  /** Open scrolled to the turn holding this message (a search hit). Matched by
   *  uuid, not by index: this view loads through the SDK, which truncates at the
   *  compaction boundary, so the message may simply not be here — and then the
   *  view says so instead of landing on whatever turn an index happened to hit. */
  focusMessageUuid?: string;
  /** A session read from another machine (#294): its messages come from here
   *  instead of this machine's disk, and nothing about the project is read
   *  locally — definitions, configuration, wikilinks — nor can the transcript
   *  be exported, highlighted or deleted from here. Unset, nothing changes. */
  remote?: RemoteTranscript;
  /** The session waits on the user, as the frame read it off the registry: the
   *  transcript cannot show it (see `WaitingLine`). */
  waiting?: SessionWaiting | null;
}) {
  const chat = useChatSession(project.hash, remote ? null : session.filename);
  const messages = remote ? remote.messages : chat.data;
  const isLoading = !remote && chat.isLoading;
  const isError = !remote && chat.isError;
  const { error, refetch } = chat;
  const [viewMode, setViewMode] = useState<ViewMode>('chat');
  const [selectedTool, setSelectedTool] = useState<ToolGroup | null>(null);
  // One entry point for every "open this tool" in the view — inline card, session
  // graph, skill output. The host frame takes it when it owns the chrome.
  const openTool = useMemo(() => onOpenTool ?? setSelectedTool, [onOpenTool]);
  const [showDelete, setShowDelete] = useState(false);
  // Session tags, editable from inside the session (mirrors the topic view):
  // assign/create via the picker, manage each chip via the shared menu.
  const {
    tags: allTags,
    tagsForSession,
    toggleTagOnSession,
    removeTagFromSession,
    renameTag,
    deleteTag,
  } = useSessionTags(project.hash);
  const sessionTags = tagsForSession(session.filename);
  const [tagPickerAnchor, setTagPickerAnchor] = useState<DOMRect | null>(null);
  // Read-only, disk-backed viewer: `displayMessages` is whatever the session
  // transcript holds, kept fresh by the file watcher. Memoized so the
  // empty-fallback array stays referentially stable (the reading column derives
  // everything from it).
  const displayMessages = useMemo(() => messages ?? [], [messages]);
  // The timeline draws from its own processed transcript, and only while it is
  // up: the reading column derives its own inside `TranscriptBody`.
  const timelineProcessed = useMemo(
    () =>
      viewMode === 'timeline' ? buildProcessedMessages(withBranchMarkers(displayMessages)) : [],
    [viewMode, displayMessages]
  );

  const sessionId = useMemo(() => session.filename.replace(/\.jsonl$/, ''), [session.filename]);

  // Live in a terminal right now? (Active-sessions registry; SDK-spawned
  // sessions — including this view's own composer — are excluded from it.)
  const { data: activeSessions = [] } = useActiveSessions();
  const liveInTerminal = activeSessions.some(a => a.sessionId === sessionId);

  // Esc closes whatever covers the transcript — the keyboard half of the crumb
  // and the ✕ in the top bar, now that the panels carry no back button of their
  // own. Embedded, the frame owns both the panels and its Esc: stay out of it.
  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedTool) setSelectedTool(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [embedded, selectedTool]);

  const title = sessionTitle(session);
  // The detail covering the transcript, if any, and the one step back out of it.
  // The top bar's arrow, the session crumb and Esc all walk this — the panels
  // themselves draw no back button when this view owns the chrome.
  const detailBack = selectedTool ? () => setSelectedTool(null) : null;
  // Whether an overlay / alternate mode is covering the chat workspace. The
  // workspace is then hidden (display:none) but never unmounted — see the
  // comment at the render site.
  const chatHidden = Boolean(selectedTool) || isError || viewMode !== 'chat';

  const placeholder = isLoading
    ? 'Loading transcript…'
    : messages?.length === 0
      ? 'No messages found in this session.'
      : null;

  return (
    // The `[[wikilinks]]` in this transcript resolve against THIS project's
    // files. Mounted here rather than higher up on purpose: the memory views
    // carry wikilinks of their own that point at topics under `~/.claude`, and
    // resolving those against the project tree would mark every one missing.
    <TranscriptLinks root={remote ? null : project.realPath}>
      <div className="cl-chat">
        {!embedded && (
          <TopBar
            // Same stack rule as the unified frame: with a detail open the arrow
            // returns to the transcript, and only from the transcript does it go
            // back to Sessions — a lone back arrow has to go back one step.
            onBack={detailBack ?? onBack}
            backLabel={detailBack ? 'Back to chat' : 'Sessions'}
            crumbs={[
              // The session title is the same step back for the hand already up
              // here; the detail takes the "you are here" accent.
              {
                // The session's `/color` dot rides the crumb, so the colour the
                // user set to tell two runs apart is on screen while reading one
                // of them — not only in the list they picked it from.
                // `flex`, not `inline-flex`: the crumb button truncates, and an
                // inline box sized to its own content would be clipped mid-word
                // instead of ellipsised. A block-level flex row takes the
                // button's width and hands the truncation to the title span.
                label: <SessionColorIdentity color={session.agentColor} title={title} />,
                accent: !detailBack,
                onClick: detailBack ?? undefined,
                title: detailBack ? 'Back to chat (Esc)' : undefined,
              },
              ...(selectedTool
                ? [
                    {
                      accent: true,
                      label: (
                        <span className="inline-flex items-center" style={{ gap: 6 }}>
                          <span aria-hidden>
                            {resolveToolIcon(
                              selectedTool.use.name,
                              selectedTool.use.input as Record<string, unknown>
                            )}
                          </span>
                          <span style={{ letterSpacing: '0.1em' }}>
                            {selectedTool.use.name.toUpperCase()}
                          </span>
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
            right={
              detailBack ? (
                // The detail owns the bar while it is open: the session's own
                // controls (tags, Chat/Timeline) act on what is behind it.
                <>
                  {selectedTool && (
                    <span
                      className={`cl-tool-status ${toolRunStatus(selectedTool.result, selectedTool.use.name).tone}`}
                    >
                      {toolRunStatus(selectedTool.result, selectedTool.use.name).label}
                    </span>
                  )}
                  <CloseOverlayButton label="Back to chat" onClose={detailBack} />
                </>
              ) : (
                <>
                  {liveInTerminal && <LiveInTerminalBadge />}
                  <div className="cl-chat-tags" onClick={e => e.stopPropagation()}>
                    {sessionTags.map(name => (
                      <ManagedTagChip
                        key={name}
                        name={name}
                        onRemoveFromItem={() => removeTagFromSession(session.filename, name)}
                        removeLabel="Remove from this session"
                        onRename={renameTag}
                        onDelete={() => deleteTag(name)}
                      />
                    ))}
                    <button
                      type="button"
                      className="cl-chat-tag-add"
                      aria-label="Add tag"
                      title="Add tag"
                      data-haspicker={!!tagPickerAnchor}
                      onClick={e => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTagPickerAnchor(prev => (prev ? null : rect));
                      }}
                    >
                      + tag
                    </button>
                    {tagPickerAnchor && (
                      <TagPicker
                        anchorRect={tagPickerAnchor}
                        allTags={allTags}
                        selected={sessionTags}
                        onToggle={name => toggleTagOnSession(session.filename, name)}
                        onClose={() => setTagPickerAnchor(null)}
                      />
                    )}
                  </div>
                  <div className="cl-view-mode" aria-label="View mode">
                    {(['chat', 'timeline'] as ViewMode[]).map(v => (
                      <button
                        key={v}
                        type="button"
                        className={viewMode === v ? 'on' : ''}
                        onClick={() => setViewMode(v)}
                        title={
                          v === 'timeline'
                            ? 'Session timeline (swimlanes by file/tool)'
                            : 'Linear transcript'
                        }
                      >
                        {v === 'chat' ? 'Chat' : 'Timeline'}
                      </button>
                    ))}
                  </div>
                </>
              )
            }
          />
        )}

        {showDelete && (
          <DeleteSessionDialog
            hash={project.hash}
            sessionFilename={session.filename}
            title={title}
            onCancel={() => setShowDelete(false)}
            onDeleted={() => {
              setShowDelete(false);
              onBack();
            }}
          />
        )}

        {/* Overlays and alternate modes visually replace the reading column, which
            stays MOUNTED underneath (hidden via display:none) so its scroll
            position, highlight layer and scroll-spy state survive being covered. */}
        {selectedTool ? (
          // Chromeless when this view draws its own bar (the crumb + ✕ up there are
          // the way back); embedded, the frame above owns the chrome instead — and
          // there `openTool` has already handed the tool to it, so this branch is
          // only reached standalone.
          <ToolDetailPanel
            group={selectedTool}
            onBack={() => setSelectedTool(null)}
            chromeless={!embedded}
          />
        ) : isError ? (
          <div className="cl-chat-workspace">
            <QueryError title="Failed to load transcript" error={error} onRetry={() => refetch()} />
          </div>
        ) : viewMode === 'timeline' ? (
          <div className="cl-chat-workspace cl-chat-workspace--tl">
            {isLoading ? (
              <p className="cl-transcript-state">Loading transcript…</p>
            ) : (
              <SessionGraphView processed={timelineProcessed} onSelectTool={openTool} />
            )}
          </div>
        ) : null}

        <TranscriptBody
          project={project}
          messages={displayMessages}
          placeholder={placeholder}
          scrollKey={session.filename}
          sessionId={sessionId}
          summary={session}
          remote={remote}
          hidden={chatHidden}
          onOpenTool={openTool}
          onOpenSkill={onOpenSkill}
          onOpenAgent={onOpenAgent}
          fileOpenerFor={fileOpenerFor}
          jumpToTurnRef={jumpToTurnRef}
          focusMessageUuid={focusMessageUuid}
          waiting={waiting}
          onDelete={remote ? undefined : () => setShowDelete(true)}
          contextRail={embedded}
        />
      </div>
    </TranscriptLinks>
  );
}

/** The `[[wikilinks]]` resolve against the project's files, which only exist
 *  here for a local session: a remote one renders them as text, as any
 *  markdown outside a `VaultLinksProvider` does. */
function TranscriptLinks({ root, children }: { root: string | null; children: ReactNode }) {
  if (root === null) return <>{children}</>;
  return <VaultLinksProvider root={root}>{children}</VaultLinksProvider>;
}
