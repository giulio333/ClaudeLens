import { useMemo } from 'react';
import { useProjectTeams, useSessionList, useActiveSessions } from '../../../hooks/useIPC';
import type { SessionSummary, TeamSummary } from '../../../types';
import { QueryError } from '../../QueryError';
import { fmtRelative, fmtTokens, isTeamLive, memberColor, teamLabel } from './utils';

type Project = { hash: string; realPath: string };

const MAX_MEMBER_CHIPS = 6;

export function TeamsSection({
  project,
  onOpenChat,
  onOpenTeam,
}: {
  project: Project;
  onOpenChat: (session: SessionSummary) => void;
  onOpenTeam: (teamName: string) => void;
}) {
  const { data: teams = [], isLoading, isError, error, refetch } = useProjectTeams(project.hash);
  const { data: sessions = [] } = useSessionList(project.hash);
  const { data: activeSessions = [] } = useActiveSessions();

  const sessionByFilename = useMemo(() => {
    const map = new Map<string, SessionSummary>();
    for (const s of sessions) map.set(s.filename, s);
    return map;
  }, [sessions]);

  return (
    <section className="cl-section cl-teams">
      <div className="cl-team-heading">
        <div>
          <span className="cl-team-kicker cl-mono">Agent teams</span>
          <h2>Teams</h2>
        </div>
        <span className="cl-team-count cl-mono">
          {teams.length} {teams.length === 1 ? 'team' : 'teams'}
        </span>
      </div>

      {isError ? (
        <div className="cl-team-query-error">
          <QueryError title="Failed to load teams" error={error} onRetry={() => refetch()} />
        </div>
      ) : isLoading ? (
        <div className="cl-empty">Loading teams…</div>
      ) : teams.length === 0 ? (
        <div className="cl-empty">
          No agent teams recorded for this project. Teams are created when a Claude Code session
          spawns named teammates that work and message each other in-process.
        </div>
      ) : (
        <div className="cl-team-list">
          {teams.map(team => {
            const session = sessionByFilename.get(team.filename);
            return (
              <TeamCard
                key={team.teamName}
                team={team}
                leadSession={session}
                live={isTeamLive(team, activeSessions)}
                onOpenTeam={() => onOpenTeam(team.teamName)}
                onOpenChat={session ? () => onOpenChat(session) : undefined}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

/** "Slab card": dark member slab on the left (count, color dots, status),
 *  editorial body on the right with a token-distribution footer. */
function TeamCard({
  team,
  leadSession,
  live,
  onOpenTeam,
  onOpenChat,
}: {
  team: TeamSummary;
  leadSession?: SessionSummary;
  live: boolean;
  onOpenTeam: () => void;
  onOpenChat?: () => void;
}) {
  const title = teamLabel(team, leadSession);
  const visibleMembers = team.memberNames.slice(0, MAX_MEMBER_CHIPS);
  const hiddenMemberCount = team.memberNames.length - visibleMembers.length;
  // The slab status mirrors Mission Control's honest wording: LIVE (a related
  // session is in the registry) / ENDED (config still present) / HISTORICAL
  // (registry entry gone, transcripts preserved).
  const status = live ? 'Live' : team.hasConfig ? 'Ended' : 'Historical';

  return (
    <article className={`cl-team-card${live ? ' is-live' : ''}`} onClick={onOpenTeam}>
      <div className="cl-team-slab">
        <div>
          <span className="cl-team-slab-label cl-mono">Members</span>
          <span className="cl-team-slab-count">{team.memberCount}</span>
        </div>
        <div className="cl-team-slab-foot">
          <span className="cl-team-slab-dots" aria-hidden="true">
            {team.memberNames.map((name, i) => (
              <i key={name} style={{ background: memberColor(team.memberColors[i] ?? '') }} />
            ))}
          </span>
          <span
            className={`cl-team-slab-state cl-mono${live ? ' is-live' : ''}`}
            title={
              live
                ? 'A related Claude Code session is active'
                : team.hasConfig
                  ? 'No related session is currently running'
                  : 'Team configuration is unavailable; transcript history is preserved'
            }
          >
            {live && <i />}
            {status}
          </span>
        </div>
      </div>

      <div className="cl-team-card-body">
        <div className="cl-team-card-head">
          <div className="cl-team-card-id">
            <span className="cl-team-card-kicker cl-mono">Agent team</span>
            <h3 className="cl-team-card-title">{title}</h3>
            <span className="cl-team-card-meta cl-mono">
              <span>Lead {team.sessionId.slice(0, 8)}</span>
              <span>
                {team.transcriptCount} {team.transcriptCount === 1 ? 'transcript' : 'transcripts'}
              </span>
              {team.messageCount > 0 && (
                <span>
                  {team.messageCount} {team.messageCount === 1 ? 'message' : 'messages'}
                </span>
              )}
              {team.lastActivity > 0 && <span>last activity {fmtRelative(team.lastActivity)}</span>}
            </span>
          </div>
          <div className="cl-team-card-actions">
            {onOpenChat && (
              <button
                type="button"
                className="cl-team-card-link cl-mono"
                onClick={e => {
                  e.stopPropagation();
                  onOpenChat();
                }}
              >
                Open chat ↗
              </button>
            )}
            <button
              type="button"
              className="cl-team-card-cta cl-mono"
              onClick={e => {
                e.stopPropagation();
                onOpenTeam();
              }}
            >
              Open team →
            </button>
          </div>
        </div>

        <div className="cl-team-card-members" aria-label={`${team.memberCount} team members`}>
          {visibleMembers.map((name, i) => (
            <span key={name} className="cl-team-chip cl-mono">
              <i style={{ background: memberColor(team.memberColors[i] ?? '') }} />
              {name}
            </span>
          ))}
          {hiddenMemberCount > 0 && (
            <span className="cl-team-chip cl-team-chip--more cl-mono">+{hiddenMemberCount}</span>
          )}
        </div>

        {team.totalTokens > 0 && (
          <div className="cl-team-tokens">
            <div className="cl-team-tokenbar">
              {team.memberNames.map(
                (name, i) =>
                  (team.memberTokens[i] ?? 0) > 0 && (
                    <i
                      key={name}
                      style={{
                        flexGrow: team.memberTokens[i],
                        background: memberColor(team.memberColors[i] ?? ''),
                      }}
                      title={`${name} — ${fmtTokens(team.memberTokens[i])} tokens`}
                    />
                  )
              )}
            </div>
            <div className="cl-team-tokens-meta cl-mono">
              <span>token distribution</span>
              <span>
                <b>{fmtTokens(team.totalTokens)}</b> total
              </span>
            </div>
          </div>
        )}

        {!team.hasConfig && (
          <div className="cl-team-card-note cl-mono">
            Configuration unavailable — transcript history preserved.
          </div>
        )}
      </div>
    </article>
  );
}
