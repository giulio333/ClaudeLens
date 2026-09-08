import { describe, it, expect } from 'vitest';
import {
  statusOf,
  needsInput,
  isTerminal,
  isFinished,
  isRecurring,
  isWorking,
  stateOutcome,
  parseRespawnFlags,
  primaryFanTask,
  fmtAge,
  projectHashFromTranscript,
  transcriptFilename,
  UNSTARTED_NEEDS,
  type JobStatusFields,
} from '../src/components/project/agents-live/status';

/**
 * The claims here are the CLI's own predicates (read out of the 2.1.263 bundle;
 * quoted in `status.ts`) plus the two live cases that produced the bug: a job
 * whose `state` latched on `blocked` while it kept working, and one whose
 * `state` still read `done` after being resumed.
 */
function job(over: Partial<JobStatusFields> = {}): JobStatusFields {
  return {
    state: 'working',
    tempo: 'active',
    needs: null,
    alive: true,
    fan: [],
    inFlightTasks: 0,
    inFlightKinds: [],
    hasRoutine: false,
    selfWake: false,
    intent: 'do the thing',
    initialPrompt: '',
    ...over,
  };
}

describe('stateOutcome', () => {
  it('names an outcome only for the three terminal states', () => {
    expect(stateOutcome('done')).toBe('success');
    expect(stateOutcome('failed')).toBe('failure');
    expect(stateOutcome('stopped')).toBe('stopped');
    expect(stateOutcome('working')).toBeNull();
    expect(stateOutcome('blocked')).toBeNull();
    // `errored` was in our old rule and is not a state the CLI produces.
    expect(stateOutcome('errored')).toBeNull();
  });
});

describe('needsInput', () => {
  it('is decided by tempo, not by state', () => {
    expect(needsInput(job({ tempo: 'blocked', needs: 'approve Bash: ls' }))).toBe(true);
    expect(needsInput(job({ tempo: 'active' }))).toBe(false);
    expect(needsInput(job({ tempo: 'idle' }))).toBe(false);
  });

  it('does NOT fire on a job whose state latched on blocked while it works', () => {
    // The live case: the job asked a question, the user answered, and `state`
    // stayed `blocked` for the rest of the turn with `detail` holding the reply.
    const latched = job({ state: 'blocked', tempo: 'active', needs: null });
    expect(needsInput(latched)).toBe(false);
    expect(statusOf(latched).bucket).toBe('working');
  });

  it('fires without a needs text when the tempo says blocked', () => {
    // A blocked job we cannot quote is still blocked; the row just has no
    // question to print.
    expect(needsInput(job({ tempo: 'blocked', needs: null }))).toBe(true);
  });

  it('excludes a job that was never given a prompt', () => {
    const fresh = job({ tempo: 'blocked', needs: UNSTARTED_NEEDS });
    expect(needsInput(fresh)).toBe(false);
    expect(statusOf(fresh).label).toBe('Awaiting prompt');
  });

  it('never fires on a finished job', () => {
    expect(needsInput(job({ state: 'done', tempo: 'blocked' }))).toBe(false);
  });
});

describe('isTerminal / isFinished', () => {
  it('reads a terminal state as terminal only while no turn runs', () => {
    expect(isTerminal(job({ state: 'done', tempo: 'idle' }))).toBe(true);
    expect(isTerminal(job({ state: 'done', tempo: 'active' }))).toBe(false);
  });

  it('treats a resumed job still carrying `done` as working', () => {
    const resumed = job({ state: 'done', tempo: 'active' });
    expect(isFinished(resumed)).toBe(false);
    expect(statusOf(resumed).bucket).toBe('working');
  });

  it('keeps a recurring job that succeeded out of the finished bucket', () => {
    const cron = job({ state: 'done', tempo: 'idle', hasRoutine: true });
    expect(isTerminal(cron)).toBe(true);
    expect(isFinished(cron)).toBe(false);
    expect(statusOf(cron)).toMatchObject({ bucket: 'ready', label: 'Scheduled' });
  });

  it('still finishes a recurring job that FAILED', () => {
    // Only a success is a run it will repeat; a failure is an outcome to see.
    const failed = job({ state: 'failed', tempo: 'idle', selfWake: true });
    expect(isFinished(failed)).toBe(true);
    expect(statusOf(failed).bucket).toBe('failed');
  });
});

describe('isRecurring', () => {
  it('counts a routine, a self-wake, a cron kind and a /loop intent', () => {
    expect(isRecurring(job({ hasRoutine: true }))).toBe(true);
    expect(isRecurring(job({ selfWake: true }))).toBe(true);
    expect(isRecurring(job({ inFlightKinds: ['session_cron'] }))).toBe(true);
    expect(isRecurring(job({ intent: '/loop 5m /babysit' }))).toBe(true);
    expect(isRecurring(job({ intent: '  /LOOP check the deploy' }))).toBe(true);
    expect(isRecurring(job({ initialPrompt: '/loop again' }))).toBe(true);
    expect(isRecurring(job())).toBe(false);
    // A prompt that merely mentions a loop is not a /loop job.
    expect(isRecurring(job({ intent: 'fix the loop in the parser' }))).toBe(false);
  });
});

describe('isWorking', () => {
  it('accepts the live tempo and work running beside the turn', () => {
    expect(isWorking(job({ tempo: 'active' }))).toBe(true);
    expect(isWorking(job({ tempo: 'idle', inFlightTasks: 2 }))).toBe(true);
    expect(
      isWorking(job({ tempo: 'idle', fan: [{ kind: 'shell', label: 'sleep 90', startedAt: 1 }] }))
    ).toBe(true);
    expect(isWorking(job({ tempo: 'idle' }))).toBe(false);
  });

  it('sees a fan shell that inFlightTasks reports as zero', () => {
    // The two counters answer different questions — the observed state file had
    // `inFlight.tasks: 0` while a `fan` shell ran.
    const busy = job({
      state: 'blocked',
      tempo: 'idle',
      inFlightTasks: 0,
      fan: [{ kind: 'shell', label: 'gh pr checks 248', startedAt: 1 }],
    });
    expect(statusOf(busy).bucket).toBe('working');
  });
});

describe('statusOf', () => {
  it('never labels a job Thinking or Busy — those tempos do not exist', () => {
    // `tempo` is idle|active|blocked. The old rule tested for 'thinking' and
    // 'busy', so a working job fell through to Ready.
    for (const tempo of ['idle', 'active', 'blocked']) {
      expect(statusOf(job({ tempo }))).not.toMatchObject({ label: 'Thinking' });
    }
    expect(statusOf(job({ tempo: 'active' })).label).toBe('Working');
  });

  it('files the three outcomes in their own buckets', () => {
    expect(statusOf(job({ state: 'done', tempo: 'idle' })).bucket).toBe('completed');
    expect(statusOf(job({ state: 'failed', tempo: 'idle' })).bucket).toBe('failed');
    expect(statusOf(job({ state: 'stopped', tempo: 'idle' })).bucket).toBe('stopped');
  });

  it('reads a dead worker as asleep, not as working', () => {
    expect(statusOf(job({ tempo: 'active', alive: false }))).toMatchObject({
      bucket: 'stopped',
      label: 'Asleep',
    });
  });

  it('leaves an alive, idle worker at Ready', () => {
    expect(statusOf(job({ state: 'working', tempo: 'idle' }))).toMatchObject({
      bucket: 'ready',
      label: 'Ready',
    });
  });

  it('pulses only while something is moving or waiting on you', () => {
    expect(statusOf(job({ tempo: 'blocked', needs: 'answer me' })).pulse).toBe(true);
    expect(statusOf(job({ tempo: 'active' })).pulse).toBe(true);
    expect(statusOf(job({ tempo: 'idle' })).pulse).toBe(false);
    expect(statusOf(job({ state: 'done', tempo: 'idle' })).pulse).toBe(false);
  });
});

describe('parseRespawnFlags', () => {
  it('reads model, permission mode and effort off a real flag list', () => {
    expect(
      parseRespawnFlags([
        '--reply-on-resume',
        '--effort',
        'high',
        '--permission-mode',
        'auto',
        '--model',
        'opus[1m]',
      ])
    ).toEqual({ model: 'opus[1m]', permissionMode: 'auto', effort: 'high' });
  });

  it('reads a flag with no value as absent instead of swallowing the next one', () => {
    expect(parseRespawnFlags(['--model', '--permission-mode', 'auto'])).toEqual({
      model: null,
      permissionMode: 'auto',
      effort: null,
    });
    expect(parseRespawnFlags(['--effort'])).toEqual({
      model: null,
      permissionMode: null,
      effort: null,
    });
  });

  it('answers all-null for an empty list', () => {
    expect(parseRespawnFlags([])).toEqual({ model: null, permissionMode: null, effort: null });
  });
});

describe('primaryFanTask', () => {
  it('picks the longest-running task', () => {
    expect(
      primaryFanTask([
        { kind: 'shell', label: 'newer', startedAt: 200 },
        { kind: 'shell', label: 'older', startedAt: 100 },
      ])
    ).toMatchObject({ label: 'older' });
  });

  it('prefers a task with a real stamp over one without', () => {
    expect(
      primaryFanTask([
        { kind: 'shell', label: 'unstamped', startedAt: 0 },
        { kind: 'shell', label: 'stamped', startedAt: 50 },
      ])
    ).toMatchObject({ label: 'stamped' });
  });

  it('answers null for no tasks', () => {
    expect(primaryFanTask([])).toBeNull();
  });
});

describe('fmtAge', () => {
  it('formats seconds, minutes, hours and days', () => {
    const now = 10_000_000_000;
    expect(fmtAge(now - 4_000, now)).toBe('4s');
    expect(fmtAge(now - 12 * 60_000, now)).toBe('12m');
    expect(fmtAge(now - 3 * 3_600_000, now)).toBe('3h');
    expect(fmtAge(now - 2 * 86_400_000, now)).toBe('2d');
  });

  it('prints nothing for a missing stamp or one in the future', () => {
    // An unusable stamp must cost an empty string, never `NaNs` or a negative.
    expect(fmtAge(0, 1_000)).toBe('');
    expect(fmtAge(2_000, 1_000)).toBe('');
  });
});

describe('projectHashFromTranscript', () => {
  it('reads the project folder off the authoritative path', () => {
    expect(
      projectHashFromTranscript(
        '/Users/alice/.claude/projects/-Users-alice-Projects-acme/sess-1.jsonl'
      )
    ).toBe('-Users-alice-Projects-acme');
  });

  it('reads it through the sessions/ layout too', () => {
    expect(
      projectHashFromTranscript(
        '/Users/alice/.claude/projects/-Users-alice-Projects-acme/sessions/sess-1.jsonl'
      )
    ).toBe('-Users-alice-Projects-acme');
  });

  it('handles Windows separators', () => {
    expect(projectHashFromTranscript('C:\\Users\\a\\.claude\\projects\\-c-acme\\s.jsonl')).toBe(
      '-c-acme'
    );
  });

  it('answers null when there is no path, or nothing to name', () => {
    expect(projectHashFromTranscript(null)).toBeNull();
    expect(projectHashFromTranscript('sess-1.jsonl')).toBeNull();
    // A transcript sitting directly in projects/ names no project folder.
    expect(projectHashFromTranscript('/Users/a/.claude/projects/sess-1.jsonl')).toBeNull();
  });
});

describe('transcriptFilename', () => {
  it('returns the file the supervisor actually scans', () => {
    expect(transcriptFilename('/Users/a/.claude/projects/-p/sess-1.jsonl')).toBe('sess-1.jsonl');
  });

  it('refuses a path that is not a transcript', () => {
    expect(transcriptFilename('/Users/a/.claude/projects/-p')).toBeNull();
    expect(transcriptFilename(null)).toBeNull();
  });
});
