// The pure half of the session rows shared by the project landing and the
// Sessions view: which sessions the landing lists, what a live row's second
// line may claim, and how a row says when. Kept out of the view so the file of
// components stays components-only (fast refresh) and so each rule can be
// asserted directly — see `test/session-rows.test.ts`.
import type { ActiveSession, SessionActivity, SessionSummary } from '../../../types';

/**
 * The landing's list: the pinned sessions first, then the rest, each part in
 * the order it arrives (newest first), capped at `limit`. When the pins alone
 * reach the cap the list is pins only — a pin is the user saying "keep this one
 * in reach", and that outranks recency on the one list the landing has.
 */
export function landingSessions(
  sessions: SessionSummary[],
  isPinned: (s: SessionSummary) => boolean,
  limit: number
): SessionSummary[] {
  const pinned = sessions.filter(isPinned);
  const rest = sessions.filter(s => !isPinned(s));
  return [...pinned, ...rest].slice(0, limit);
}

export type LiveLine = { text: string; waiting: boolean };

/**
 * What a live row's second line says the session is doing — or null, and the
 * row keeps its model line. Only two registry states make a claim: `waiting`
 * (it needs the user) and `busy` (it works). An `idle` or `unknown` session is
 * alive but doing nothing anyone has observed, and printing activity there is
 * the "open read as working" bug the global home already had to undo.
 */
export function liveActivityLine(
  active: Pick<ActiveSession, 'status' | 'waitingFor'> | undefined,
  activity: Pick<SessionActivity, 'lastTool' | 'delegates'> | undefined
): LiveLine | null {
  if (!active) return null;
  if (active.status === 'waiting') {
    return {
      text: `Needs you · ${active.waitingFor || 'a prompt in the terminal'}`,
      waiting: true,
    };
  }
  if (active.status !== 'busy') return null;
  const tool = activity?.lastTool;
  if (tool) return { text: tool.arg ? `${tool.name} · ${tool.arg}` : tool.name, waiting: false };
  // A dispatch not yet seen finishing, with no call of its own in flight: the
  // sub-agent is the work, and it runs in a sidecar transcript the tail skips.
  const [first, ...more] = activity?.delegates ?? [];
  if (first) {
    const who = more.length ? `${first.name} +${more.length}` : first.name;
    return { text: `${who} · sub-agent running`, waiting: false };
  }
  return { text: 'Working', waiting: false };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * When the session was last active, relative while that reads faster than a
 * date: within the default 30-day retention every row is `Nd ago` or closer.
 * Older than that (a raised `cleanupPeriodDays`) it is the date, en-US like
 * every date in the app.
 */
export function relativeWhen(iso: string, now = Date.now()): string {
  const at = new Date(iso).getTime();
  if (isNaN(at)) return '';
  const delta = Math.max(0, now - at);
  if (delta < MIN) return 'now';
  if (delta < HOUR) return `${Math.floor(delta / MIN)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 31 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}
