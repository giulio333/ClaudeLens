import { useMemo, useState } from 'react';
import { useTeamDetail, useSessionList, useActiveSessions } from '../../../hooks/useIPC';
import type {
  SessionSummary,
  TeamDetail,
  TeamEvent,
  TeamMemberInfo,
  TeamMemberTranscript,
} from '../../../types';
import { TopBar } from '../shared/TopBar';
import { SubagentTranscriptPanel } from '../chat/SubagentTranscriptPanel';
import { QueryError } from '../../QueryError';
import Markdown from '../../Markdown';
import { fmtDate, fmtModel, formatTokens, modelColor, sessionTitle } from '../utils';
import { eventTime, fmtRelative, isTeamLive, memberColor } from './utils';
import { TeamSwimlanes } from './TeamSwimlanes';

type Project = { hash: string; realPath: string };

function meaningfulSessionTitle(session: SessionSummary | undefined): string | null {
  const hasTitle = Boolean(
    session?.customTitle?.trim() || session?.aiTitle?.trim() || session?.firstUserMessage?.trim()
  );
  return hasTitle && session ? sessionTitle(session) : null;
}

function teamTitle(team: TeamDetail, sessionByFilename: Map<string, SessionSummary>): string {
  // `sessionId`/`filename` are transcript-backed and therefore safer than the
  // config's lead id, which can become stale after a resumed lead session.
  const leadSession =
    sessionByFilename.get(team.filename) ??
    team.sessionIds
      .map(id => sessionByFilename.get(`${id}.jsonl`))
      .find((session): session is SessionSummary => Boolean(session));

  return meaningfulSessionTitle(leadSession) || team.displayName || team.teamName;
}

function permissionLabel(mode: string): string {
  if (mode === 'bypassPermissions') return 'auto-approve';
  if (mode === 'acceptEdits') return 'accept edits';
  if (mode === 'plan') return 'plan mode';
  return mode;
}

function fmtTok(n: number): string {
  const { value, unit } = formatTokens(n);
  return `${value}${unit}`;
}

/** Sender dot color: teammates keep their named data color, the lead (which
 *  has no named color) gets the brand accent. */
function senderColor(name: string, colorByName: Map<string, string>): string {
  return colorByName.has(name) ? memberColor(colorByName.get(name)!) : 'var(--cl-accent)';
}

export function TeamDetailView({
  project,
  teamName,
  onBack,
  backLabel = 'Teams',
  onOpenChat,
}: {
  project: Project;
  teamName: string;
  onBack: () => void;
  /** Back-button label — 'Close' when hosted in the Mission Control overlay. */
  backLabel?: string;
  onOpenChat: (session: SessionSummary) => void;
}) {
  const { data: team, isLoading, isError, error, refetch } = useTeamDetail(project.hash, teamName);
  const { data: sessions = [] } = useSessionList(project.hash);
  const { data: activeSessions = [] } = useActiveSessions();
  const [transcript, setTranscript] = useState<{
    member: TeamMemberInfo;
    entry: TeamMemberTranscript;
  } | null>(null);
  // Secondary body layout (design 1g): the conversation plotted across member
  // lanes. Overview (constellation + dossiers + activity) stays the default.
  const [mode, setMode] = useState<'overview' | 'lanes'>('overview');

  const sessionByFilename = useMemo(() => {
    const map = new Map<string, SessionSummary>();
    for (const s of sessions) map.set(s.filename, s);
    return map;
  }, [sessions]);
  const title = team ? teamTitle(team, sessionByFilename) : teamName;

  if (transcript) {
    // Host wrapper: same rationale as WorkflowRunDetailView — the panel needs a
    // full-height flex context to scroll when mounted outside ChatView.
    return (
      <div
        className="cl-wf-transcript-host h-full flex flex-col"
        style={{ background: 'var(--cl-paper)' }}
      >
        <SubagentTranscriptPanel
          hash={project.hash}
          sessionFilename={transcript.entry.filename}
          agentId={transcript.entry.agentId}
          subagentType={transcript.member.name}
          description={transcript.member.description || transcript.member.name}
          prompt={transcript.member.prompt || undefined}
          onBack={() => setTranscript(null)}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar
        onBack={onBack}
        backLabel={backLabel}
        crumbs={[{ label: title, accent: true }]}
        right={
          team && team.members.length > 0 ? (
            <div className="cl-view-mode" aria-label="Team view mode">
              {(['overview', 'lanes'] as const).map(v => (
                <button
                  key={v}
                  type="button"
                  className={mode === v ? 'on' : ''}
                  onClick={() => setMode(v)}
                  title={
                    v === 'lanes'
                      ? 'Conversation plotted across member lanes'
                      : 'Constellation, member dossiers and activity'
                  }
                >
                  {v === 'overview' ? 'Overview' : 'Swimlanes'}
                </button>
              ))}
            </div>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-y-auto">
        {isError ? (
          <div className="cl-section" style={{ paddingTop: 32 }}>
            <QueryError title="Failed to load team" error={error} onRetry={() => refetch()} />
          </div>
        ) : isLoading ? (
          <div className="cl-section">
            <div className="cl-empty">Loading team…</div>
          </div>
        ) : !team ? (
          <div className="cl-section">
            <div className="cl-empty">Team not found.</div>
          </div>
        ) : (
          <TeamBody
            team={team}
            title={title}
            live={isTeamLive(team, activeSessions)}
            mode={mode}
            sessionByFilename={sessionByFilename}
            onOpenChat={onOpenChat}
            onOpenTranscript={(member, entry) => setTranscript({ member, entry })}
          />
        )}
      </div>
    </div>
  );
}

function TeamBody({
  team,
  title,
  live,
  mode,
  sessionByFilename,
  onOpenChat,
  onOpenTranscript,
}: {
  team: TeamDetail;
  title: string;
  live: boolean;
  mode: 'overview' | 'lanes';
  sessionByFilename: Map<string, SessionSummary>;
  onOpenChat: (session: SessionSummary) => void;
  onOpenTranscript: (member: TeamMemberInfo, entry: TeamMemberTranscript) => void;
}) {
  // The registry keeps the lead session id from team CREATION; a resumed lead
  // rotates its id, so the transcripts can live under a different session.
  const staleLeadId = Boolean(
    team.leadSessionIdFromConfig && !team.sessionIds.includes(team.leadSessionIdFromConfig)
  );
  const messageEvents = team.events.filter(e => e.kind === 'message');
  const teamTokens = team.members.reduce((n, m) => n + m.totalTokens, 0);
  const status = live ? 'Live' : team.hasConfig ? 'Ended' : 'Historical';
  const statusHint = live
    ? 'A related Claude Code session is active'
    : team.hasConfig
      ? undefined
      : 'Team configuration is unavailable; transcript history is preserved';

  const colorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of team.members) map.set(m.name, m.color);
    return map;
  }, [team.members]);

  // Messages exchanged on each lead ↔ member route (the graph edge labels).
  const routeMessages = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of team.events) {
      if (e.kind !== 'message') continue;
      const member = e.from === 'team-lead' ? e.to : e.from;
      map.set(member, (map.get(member) ?? 0) + 1);
    }
    return map;
  }, [team.events]);

  const leadSession =
    sessionByFilename.get(team.filename) ??
    team.sessionIds
      .map(id => sessionByFilename.get(`${id}.jsonl`))
      .find((session): session is SessionSummary => Boolean(session));

  const metaParts: string[] = [];
  if (team.createdAt > 0)
    metaParts.push(`created ${fmtDate(new Date(team.createdAt).toISOString())}`);
  if (team.lastActivity > 0) metaParts.push(`last activity ${fmtRelative(team.lastActivity)}`);
  metaParts.push(`lead ${team.sessionId.slice(0, 8)}`);

  const firstEvent = team.events[0];
  const lastEvent = team.events[team.events.length - 1];

  return (
    <div className="cl-team-detail">
      <header className="cl-tc-head">
        <div className="cl-tc-head-main">
          <div className="cl-tc-eyebrow cl-mono" title={statusHint}>
            <i className={live ? 'cl-live-dot is-live' : undefined} />
            Agent team · {status}
          </div>
          <h1>{title}</h1>
          <div className="cl-tc-head-meta cl-mono">{metaParts.join(' · ')}</div>
          {staleLeadId && (
            <div className="cl-tc-stale cl-mono">
              registry lead id {team.leadSessionIdFromConfig!.slice(0, 8)} is stale — the lead
              session rotated its id after a resume
            </div>
          )}
        </div>
        <div className="cl-tc-head-stats cl-mono">
          <span>
            <b>{team.memberCount}</b>members
          </span>
          <span>
            <b>{messageEvents.length}</b>messages
          </span>
          {teamTokens > 0 && (
            <span>
              <b>{fmtTok(teamTokens)}</b>tokens
            </span>
          )}
        </div>
      </header>

      {team.members.length === 0 ? (
        <div className="cl-section">
          <div className="cl-empty">No members recorded for this team.</div>
        </div>
      ) : mode === 'lanes' ? (
        <TeamSwimlanes
          team={team}
          leadSession={leadSession}
          onOpenChat={onOpenChat}
          onOpenTranscript={onOpenTranscript}
        />
      ) : (
        <>
          <ConstellationGraph
            team={team}
            leadSession={leadSession}
            routeMessages={routeMessages}
            sessionByFilename={sessionByFilename}
            onOpenChat={onOpenChat}
            onOpenTranscript={onOpenTranscript}
          />
          <section className="cl-tc-grid">
            {team.members.map(m => (
              <MemberDossier key={m.name} member={m} onOpenTranscript={onOpenTranscript} />
            ))}
          </section>
        </>
      )}

      {mode === 'overview' && team.events.length > 0 && (
        <section className="cl-tc-strip">
          <div className="cl-tc-strip-head cl-mono">
            <span>Team activity</span>
            <span>
              {team.events.length} {team.events.length === 1 ? 'event' : 'events'}
              {firstEvent.timestamp > 0 &&
                lastEvent.timestamp > 0 &&
                ` · ${eventTime(firstEvent.timestamp)} → ${eventTime(lastEvent.timestamp)}`}
            </span>
          </div>
          <ol className="cl-team-timeline">
            {team.events.map((e, i) => (
              <TimelineEvent key={i} event={e} colorByName={colorByName} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

// Constellation graph geometry (design 1f). The SVG stretches horizontally
// (preserveAspectRatio="none") while the height matches the member count, so
// every coordinate lives in viewBox units and the HTML overlays reuse the
// same fractions as percentages.
const GRAPH_W = 1000;
const LEAD_X = 260;
const MEMBER_X = 700;
const CTRL_X1 = 460;
const CTRL_X2 = 540;
const ROW_STEP = 79;
const PAD_Y = 47;

function cubicAt(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function memberInitial(name: string): string {
  return (
    name
      .replace(/[^a-z0-9]/gi, '')
      .charAt(0)
      .toUpperCase() || '?'
  );
}

function ConstellationGraph({
  team,
  leadSession,
  routeMessages,
  sessionByFilename,
  onOpenChat,
  onOpenTranscript,
}: {
  team: TeamDetail;
  leadSession: SessionSummary | undefined;
  routeMessages: Map<string, number>;
  sessionByFilename: Map<string, SessionSummary>;
  onOpenChat: (session: SessionSummary) => void;
  onOpenTranscript: (member: TeamMemberInfo, entry: TeamMemberTranscript) => void;
}) {
  const members = team.members;
  const n = members.length;
  const height = n === 1 ? 170 : PAD_Y * 2 + (n - 1) * ROW_STEP;
  const leadY = height / 2;
  const memberY = (i: number) => (n === 1 ? leadY : PAD_Y + i * ROW_STEP);
  const pctY = (y: number) => `${((y / height) * 100).toFixed(2)}%`;

  return (
    <div className="cl-tc-graph" style={{ height }}>
      <svg viewBox={`0 0 ${GRAPH_W} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {members.map((m, i) => (
          <path
            key={m.name}
            d={`M ${LEAD_X} ${leadY} C ${CTRL_X1} ${leadY}, ${CTRL_X2} ${memberY(i)}, ${MEMBER_X} ${memberY(i)}`}
            stroke={memberColor(m.color)}
            strokeWidth={1.5}
            fill="none"
            opacity={0.75}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {members.map((m, i) => (
          <circle key={m.name} cx={MEMBER_X} cy={memberY(i)} r={2.5} fill={memberColor(m.color)} />
        ))}
        <circle cx={LEAD_X} cy={leadY} r={2.5} fill="var(--cl-accent)" />
      </svg>

      {members.map((m, i) => {
        const parts: string[] = [];
        const msgs = routeMessages.get(m.name) ?? 0;
        if (msgs > 0) parts.push(`${msgs} msg`);
        if (m.totalTokens > 0) parts.push(fmtTok(m.totalTokens));
        if (parts.length === 0) return null;
        const x = (cubicAt(0.55, LEAD_X, CTRL_X1, CTRL_X2, MEMBER_X) / GRAPH_W) * 100;
        const y = cubicAt(0.55, leadY, leadY, memberY(i), memberY(i));
        return (
          <span
            key={m.name}
            className="cl-tc-edge cl-mono"
            style={{ left: `${x.toFixed(2)}%`, top: pctY(y) }}
          >
            {parts.join(' · ')}
          </span>
        );
      })}

      <div className="cl-tc-lead" style={{ top: pctY(leadY) }}>
        <span className="cl-tc-lead-glyph">L</span>
        <span className="cl-tc-node-text">
          <span className="cl-tc-node-name">team-lead</span>
          <span className="cl-tc-node-sub cl-mono">
            orchestrator · {team.sessionId.slice(0, 8)}
          </span>
          {leadSession && (
            <button
              type="button"
              className="cl-tc-node-cta cl-mono"
              onClick={() => onOpenChat(leadSession)}
            >
              open chat →
            </button>
          )}
        </span>
      </div>

      {members.map((m, i) => {
        const transcript: TeamMemberTranscript | undefined = m.transcripts[0];
        const sub = [
          m.model ? fmtModel(m.model) : '',
          m.messageCount > 0 ? `${m.messageCount} msg` : '',
          m.toolCallCount > 0 ? `${m.toolCallCount} tools` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        const body = (
          <>
            <span
              className="cl-tc-node-glyph"
              style={{ borderColor: memberColor(m.color), color: memberColor(m.color) }}
            >
              {memberInitial(m.name)}
            </span>
            <span className="cl-tc-node-text">
              <span className="cl-tc-node-name">{m.name}</span>
              {(sub || m.source === 'config-only') && (
                <span className="cl-tc-node-sub cl-mono">
                  {sub || 'never produced a transcript'}
                </span>
              )}
            </span>
          </>
        );
        const top = pctY(memberY(i));
        return transcript ? (
          <button
            key={m.name}
            type="button"
            className="cl-tc-node is-link"
            style={{ top }}
            title={`Open ${m.name} transcript`}
            onClick={() => onOpenTranscript(m, transcript)}
          >
            {body}
          </button>
        ) : (
          <div key={m.name} className="cl-tc-node" style={{ top }}>
            {body}
          </div>
        );
      })}

      <div className="cl-tc-caption cl-mono">
        <span>Message routes · lead ↔ teammates</span>
        {team.sessionIds.length > 1 && (
          <span className="cl-tc-sessions">
            sessions
            {team.sessionIds.map(id => {
              const session = sessionByFilename.get(`${id}.jsonl`);
              const current = id === team.sessionId;
              const cls = `cl-tc-session-chip${current ? ' is-current' : ''}`;
              return session ? (
                <button
                  key={id}
                  type="button"
                  className={cls}
                  title={sessionTitle(session)}
                  onClick={() => onOpenChat(session)}
                >
                  {id.slice(0, 8)}
                </button>
              ) : (
                <span key={id} className={cls}>
                  {id.slice(0, 8)}
                </span>
              );
            })}
          </span>
        )}
      </div>
    </div>
  );
}

function promptExcerpt(prompt: string): string {
  const firstLine = prompt.split('\n')[0]?.trim() ?? '';
  if (firstLine.length <= 140) return firstLine;
  return firstLine.slice(0, 139).trimEnd() + '…';
}

function MemberDossier({
  member,
  onOpenTranscript,
}: {
  member: TeamMemberInfo;
  onOpenTranscript: (member: TeamMemberInfo, entry: TeamMemberTranscript) => void;
}) {
  const color = memberColor(member.color);
  const configOnly = member.source === 'config-only';
  const description = member.description || promptExcerpt(member.prompt);
  const permission = member.planModeRequired
    ? 'plan mode'
    : member.permissionMode && member.permissionMode !== 'default'
      ? permissionLabel(member.permissionMode)
      : '';
  const hasStats =
    member.totalTokens > 0 ||
    member.messageCount > 0 ||
    member.toolCallCount > 0 ||
    Boolean(permission);

  return (
    <article className="cl-tc-dossier">
      <div className="cl-tc-dossier-head">
        <i style={{ background: color }} />
        <span className="cl-tc-dossier-name">{member.name}</span>
        {member.model && (
          <span
            className="cl-tc-model cl-mono"
            style={{
              color: modelColor(member.model),
              borderColor: `color-mix(in oklch, ${modelColor(member.model)} 35%, var(--cl-line))`,
            }}
          >
            {fmtModel(member.model).toUpperCase()}
          </span>
        )}
      </div>
      {description && <p className="cl-tc-dossier-desc">{description}</p>}
      {configOnly && <p className="cl-tc-dossier-desc is-muted">Never produced a transcript.</p>}
      {hasStats && (
        <div className="cl-tc-dossier-stats cl-mono">
          {member.totalTokens > 0 && (
            <span>
              <b>{fmtTok(member.totalTokens)}</b> tok
            </span>
          )}
          {member.messageCount > 0 && (
            <span>
              <b>{member.messageCount}</b> msg
            </span>
          )}
          {member.toolCallCount > 0 && (
            <span>
              <b>{member.toolCallCount}</b> tools
            </span>
          )}
          {permission && <span className="perm">{permission}</span>}
        </div>
      )}
      {(member.prompt || member.cwd) && (
        <details className="cl-tc-dossier-more">
          <summary className="cl-mono">prompt & context</summary>
          {member.cwd && (
            <div className="cl-wf-kv cl-mono">
              <span className="k">cwd</span>
              <span className="v">{member.cwd}</span>
            </div>
          )}
          {member.prompt && <pre className="cl-wf-pre cl-mono">{member.prompt}</pre>}
        </details>
      )}
      {member.transcripts.map((t, i) => (
        <button
          key={t.agentId}
          type="button"
          className="cl-tc-open cl-mono"
          onClick={() => onOpenTranscript(member, t)}
        >
          {member.transcripts.length === 1
            ? 'Open transcript →'
            : `Transcript ${i + 1} · ${fmtRelative(t.mtimeMs)} →`}
        </button>
      ))}
    </article>
  );
}

function TimelineEvent({
  event,
  colorByName,
}: {
  event: TeamEvent;
  colorByName: Map<string, string>;
}) {
  const dispatch = event.kind === 'dispatch';
  const headline = event.summary || (dispatch ? 'dispatched' : '');

  return (
    <li className={`cl-team-event${dispatch ? ' is-dispatch' : ''}`}>
      <span className="cl-team-event-time cl-mono">{eventTime(event.timestamp)}</span>
      <span
        className="cl-team-event-dot"
        style={{ background: senderColor(event.from, colorByName) }}
      />
      <div className="cl-team-event-body">
        <div className="cl-team-event-route cl-mono">
          <span className="who">{event.from}</span>
          <span className="arrow">→</span>
          <span className="who">{event.to}</span>
          {dispatch && <span className="cl-team-event-kind">dispatched</span>}
        </div>
        {headline && !dispatch && <p className="cl-team-event-summary">{headline}</p>}
        {event.text && (
          <details className="cl-team-event-text">
            <summary className="cl-mono">show full message</summary>
            <div className="cl-team-event-md">
              <Markdown>{event.text}</Markdown>
            </div>
          </details>
        )}
      </div>
    </li>
  );
}
