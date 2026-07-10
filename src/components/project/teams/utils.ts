import type { ActiveSession, SessionSummary, TeamSummary } from '../../../types';
import { sessionTitle } from '../utils';

/** A team is live when any session holding its transcripts (or the lead id
 *  recorded in the registry) is alive in the native session registry. The
 *  registry config alone can't tell — killed lead sessions leave it behind
 *  with every member still listed. */
export function isTeamLive(
  team: { sessionIds: string[]; leadSessionIdFromConfig?: string | null },
  activeSessions: ActiveSession[]
): boolean {
  if (!activeSessions.length) return false;
  const alive = new Set(activeSessions.map(s => s.sessionId).filter(Boolean));
  if (team.sessionIds.some(id => alive.has(id))) return true;
  return Boolean(team.leadSessionIdFromConfig && alive.has(team.leadSessionIdFromConfig));
}

/** The registry entry of the live lead session, if any — its `status`
 *  (busy/waiting/idle) is the only real-time "what is the lead doing" signal.
 *  Note it describes the LEAD SESSION, not the teammates' work. */
export function liveLeadSession(
  team: { sessionIds: string[]; leadSessionIdFromConfig?: string | null },
  activeSessions: ActiveSession[]
): ActiveSession | undefined {
  return activeSessions.find(
    s =>
      s.sessionId &&
      (team.sessionIds.includes(s.sessionId) || s.sessionId === team.leadSessionIdFromConfig)
  );
}

/** True for the auto-generated registry names ("session-8f02ab31") that carry
 *  no meaning — the lead session's title is the honest identity then. */
export function isGeneratedName(team: TeamSummary): boolean {
  return team.displayName === team.teamName || /^session-[a-z0-9]+$/i.test(team.displayName);
}

/** Display title for a team: the config name when it's a real one, else the
 *  lead session's title. */
export function teamLabel(team: TeamSummary, session: SessionSummary | undefined): string {
  if (isGeneratedName(team) && session) return sessionTitle(session);
  return team.displayName || team.teamName;
}

// Claude Code assigns each teammate a named color (blue/green/yellow/purple/…)
// used across its own UI and the transcript envelopes. These dots encode DATA
// (which teammate is which), like modelColor — they are deliberately muted so
// they don't compete with the terracotta accent.
const MEMBER_COLORS: Record<string, string> = {
  blue: '#5b7fa6',
  green: '#6a8f6b',
  yellow: '#b3913f',
  purple: '#8a6fa6',
  red: '#a66459',
  orange: '#b07b4f',
  pink: '#a66d8a',
  cyan: '#5b9aa6',
};

/** Hex dot for a teammate's named color; warm gray for unknown/absent. */
export function memberColor(name: string): string {
  return MEMBER_COLORS[name] ?? 'var(--cl-ink-4)';
}

/** '2m ago' / '3h ago' / '5d ago' / en-US date beyond a week (the UI is
 *  English-only — no localized dates here). */
export function fmtRelative(epochMs: number): string {
  if (!epochMs) return '';
  const delta = Date.now() - epochMs;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  return new Date(epochMs).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** HH:mm (24h) for the activity timeline and swimlane rows. */
export function eventTime(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

/** Minutes since `epochMs`, for the "quiet Nm" stuck-team signal. */
export function minutesSince(epochMs: number): number {
  return Math.max(0, Math.floor((Date.now() - epochMs) / 60_000));
}

/** Compact token count for the distribution footer: 3_700_000 → '3.7m',
 *  52_000 → '52k', 980 → '980'. */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}m`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return String(n);
}
