import type { BgSession } from '../../../types';

/**
 * What a background job is doing, decided the way `claude agents` decides it.
 *
 * This used to be a guess of ours, and the guess keyed the top-priority bucket
 * on `state === 'blocked'`. That is the wrong field. Read out of the 2.1.263
 * bundle, the CLI's own predicates are:
 *
 *   function Hf(e){ if(e==="done")return"success"; if(e==="failed")return"failure";
 *                   if(e==="stopped")return"stopped"; return null }
 *   function DE(e){ return Hf(e)!==null }
 *   function Hs(e){ return DE(e.state) && e.tempo!=="active" }          // terminal
 *   function zo(t){ return Hs(t) && !(Hf(t.state)==="success" && dD(t)) } // finished
 *   function Cr(t){ return !zo(t) && t.tempo==="blocked"                  // needs input
 *                   && t.needs!=="send a prompt to start" }
 *   function dD(e){ return e.routine!==undefined || e.selfWake===!0
 *                   || (e.inFlight?.kinds.includes("session_cron")??!1) || CAe(e) }
 *
 * So: **`tempo` is the field that says what a job is doing; `state` is an
 * outcome name.** `state === 'blocked'` survives in the CLI only as
 * `TNe(e) = e.state==='blocked' && !KS(e)`, a respawn-eligibility test in the
 * auto-resume path — nothing to do with a UI bucket. Keying "waiting on you" on
 * it made every job that had ever asked a question read as blocked for the rest
 * of its turn, printing the user's own reply (`detail`) as the question.
 *
 * Four consequences worth naming, because each was a separate bug:
 *  - needs-input is `tempo === 'blocked'`, minus the never-started placeholder;
 *  - `tempo` is `idle | active | blocked` and nothing else (counted over the
 *    binary: no `thinking`, no `busy` — the two values the old code tested for,
 *    which is why a working job fell through to "Ready");
 *  - a terminal `state` is only terminal while `tempo !== 'active'`, so a
 *    resumed job that still carries `state: 'done'` is working, not completed;
 *  - a **recurring** job that succeeded is deliberately not finished: it will
 *    wake again, so it stays in the live list instead of being filed away.
 *
 * `hasPendingQuestion` is deliberately NOT part of the verdict: an unanswered
 * question reaches us as `tempo: 'blocked'`, and putting a field we have never
 * seen written back in charge of the top bucket is the mistake being fixed.
 */

/** The `needs` text of a job that exists but was never given a prompt. It is
 *  blocked, but not on you — the CLI excludes it from needs-input by this exact
 *  string, so we compare against the same one. */
export const UNSTARTED_NEEDS = 'send a prompt to start';

/** `session_cron` in `inFlight.kinds` marks a scheduled wake-up. */
const CRON_KIND = 'session_cron';

export type Bucket = 'needs-input' | 'working' | 'ready' | 'completed' | 'failed' | 'stopped';

export interface StatusInfo {
  bucket: Bucket;
  label: string;
  color: string;
  pulse: boolean;
}

/** The fields the verdict is taken on — a job-shaped subset, so a test can
 *  state one claim without building a whole session. */
export type JobStatusFields = Pick<
  BgSession,
  | 'state'
  | 'tempo'
  | 'needs'
  | 'alive'
  | 'fan'
  | 'inFlightTasks'
  | 'inFlightKinds'
  | 'hasRoutine'
  | 'selfWake'
  | 'intent'
  | 'initialPrompt'
>;

/** CLI `Hf`: the outcome a state name carries, or null when it names no outcome. */
export function stateOutcome(state: string): 'success' | 'failure' | 'stopped' | null {
  if (state === 'done') return 'success';
  if (state === 'failed') return 'failure';
  if (state === 'stopped') return 'stopped';
  return null;
}

/** CLI `CAe`: a `/loop` job re-runs, so it is recurring even without a routine. */
function isLoop(job: JobStatusFields): boolean {
  const starts = (s: string) => s.trim().toLowerCase().startsWith('/loop');
  return starts(job.intent) || starts(job.initialPrompt);
}

/** CLI `dD`: the job will run again on its own. */
export function isRecurring(job: JobStatusFields): boolean {
  return job.hasRoutine || job.selfWake || job.inFlightKinds.includes(CRON_KIND) || isLoop(job);
}

/** CLI `Hs`: a terminal state name, and no turn currently running under it. */
export function isTerminal(job: JobStatusFields): boolean {
  return stateOutcome(job.state) !== null && job.tempo !== 'active';
}

/** CLI `zo`: terminal, and not a recurring job merely between runs. */
export function isFinished(job: JobStatusFields): boolean {
  return isTerminal(job) && !(stateOutcome(job.state) === 'success' && isRecurring(job));
}

/** CLI `Cr`: the job is waiting on a human. */
export function needsInput(job: JobStatusFields): boolean {
  return !isFinished(job) && job.tempo === 'blocked' && job.needs !== UNSTARTED_NEEDS;
}

/** Blocked, but on a prompt that was never sent — not on an answer from you. */
export function isAwaitingFirstPrompt(job: JobStatusFields): boolean {
  return job.tempo === 'blocked' && job.needs === UNSTARTED_NEEDS;
}

/** Positive evidence of work: the live tempo, or something running beside the
 *  turn. `fan` is the half the old rule could not see — `inFlightTasks` reads 0
 *  while a fan shell runs, so the two counters answer different questions. */
export function isWorking(job: JobStatusFields): boolean {
  return job.tempo === 'active' || job.fan.length > 0 || job.inFlightTasks > 0;
}

export function statusOf(job: JobStatusFields): StatusInfo {
  if (needsInput(job))
    return { bucket: 'needs-input', label: 'Needs input', color: '#f59e0b', pulse: true };

  if (isFinished(job)) {
    switch (stateOutcome(job.state)) {
      case 'success':
        return { bucket: 'completed', label: 'Completed', color: '#22c55e', pulse: false };
      case 'failure':
        return { bucket: 'failed', label: 'Failed', color: '#ef4444', pulse: false };
      default:
        return { bucket: 'stopped', label: 'Stopped', color: '#94a3b8', pulse: false };
    }
  }

  // No live process: whatever it was doing, it is not doing it now.
  if (!job.alive) return { bucket: 'stopped', label: 'Asleep', color: '#94a3b8', pulse: false };

  // A recurring job that succeeded is idle between runs, not done with them.
  if (stateOutcome(job.state) === 'success' && isRecurring(job))
    return { bucket: 'ready', label: 'Scheduled', color: '#0ea5e9', pulse: false };

  if (isAwaitingFirstPrompt(job))
    return { bucket: 'ready', label: 'Awaiting prompt', color: '#0ea5e9', pulse: false };

  if (isWorking(job)) return { bucket: 'working', label: 'Working', color: '#6366f1', pulse: true };

  return { bucket: 'ready', label: 'Ready', color: '#0ea5e9', pulse: false };
}

/** Buckets that represent finished work. A worker process can stay alive (warm,
 *  idle) after its task is done — `claude agents` keeps it around for attach /
 *  resume — so pid-liveness alone overcounts "running now". */
export const TERMINAL_BUCKETS = new Set<Bucket>(['completed', 'failed', 'stopped']);

// ─── What the row can now say ──────────────────────────────────────────────────

/** How the job was launched, read off the flags a respawn would reuse. */
export interface LaunchNote {
  model: string | null;
  permissionMode: string | null;
  effort: string | null;
}

/** `['--reply-on-resume','--effort','high','--model','opus[1m]']` → the three
 *  facts worth printing. A flag whose value is missing (or is itself a flag)
 *  reads as absent rather than swallowing the next one. */
export function parseRespawnFlags(flags: string[]): LaunchNote {
  const read = (name: string): string | null => {
    const i = flags.indexOf(name);
    if (i < 0) return null;
    const v = flags[i + 1];
    if (v === undefined || v.startsWith('-')) return null;
    return v;
  };
  return {
    model: read('--model'),
    permissionMode: read('--permission-mode'),
    effort: read('--effort'),
  };
}

/** The fan task to show: the one running longest, i.e. the one a stall is
 *  about. An entry with no stamp never wins over one that has a real age. */
export function primaryFanTask(fan: BgSession['fan']): BgSession['fan'][number] | null {
  let best: BgSession['fan'][number] | null = null;
  for (const t of fan) {
    if (!best) best = t;
    else if (best.startedAt === 0 && t.startedAt > 0) best = t;
    else if (t.startedAt > 0 && t.startedAt < best.startedAt) best = t;
  }
  return best;
}

/** Compact age of something still running: `4s` / `12m` / `2h`. Empty when the
 *  stamp is unusable or in the future, so the row prints no age at all instead
 *  of a negative one. */
export function fmtAge(startedAt: number, now: number): string {
  if (!startedAt || !Number.isFinite(startedAt)) return '';
  const ms = now - startedAt;
  if (ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** The project folder a transcript lives in, from the path the supervisor
 *  itself scans: `…/projects/<hash>/<id>.jsonl` and the `sessions/` layout
 *  (`…/projects/<hash>/sessions/<id>.jsonl`) both answer `<hash>`.
 *
 *  This exists so the row stops deriving the hash from the cwd: that rule
 *  collapses both `/` and `.` into `-`, so its inverse is a guess, and the
 *  authoritative answer is written in the state file. */
export function projectHashFromTranscript(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length < 2) return null;
  // Drop the filename, then the layout folder if that is what we landed on.
  parts.pop();
  if (parts[parts.length - 1] === 'sessions') parts.pop();
  const hash = parts[parts.length - 1];
  return hash && hash !== 'projects' ? hash : null;
}

/** The transcript's own filename, so the chat view opens the file that exists
 *  rather than one composed from the session id. */
export function transcriptFilename(path: string | null): string | null {
  if (!path) return null;
  const name = path.split(/[/\\]/).filter(Boolean).pop();
  return name && name.endsWith('.jsonl') ? name : null;
}
