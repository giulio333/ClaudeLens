import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  resolveTailTarget,
  startLiveMonitor,
  stopLiveMonitor,
  type LiveEvent,
} from '../electron/modules/live-monitor';

// The Live Monitor's contract, and the one it broke (#194): asked to tail a
// session, it must tail THAT session's transcript or nothing at all. Falling
// back to the project's newest `.jsonl` made it show another session's activity
// while presenting itself as attached to the requested one — and that is the
// normal case at startup, where the registry publishes a session id before its
// transcript has been created.

const SESSION = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

/** A transcript line the tail turns into a `tool_use` event. */
function toolLine(name: string): string {
  return (
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: `t-${name}`, name, input: { file_path: `/x/${name}` } }],
      },
    }) + '\n'
  );
}

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'cl-live-'));
});

afterEach(() => {
  stopLiveMonitor();
  rmSync(project, { recursive: true, force: true });
});

describe('resolveTailTarget', () => {
  it('resolves the requested session in the project root', async () => {
    writeFileSync(join(project, `${SESSION}.jsonl`), '');
    const target = await resolveTailTarget(project, SESSION);
    expect(target).toMatchObject({ state: 'tailing', filePath: join(project, `${SESSION}.jsonl`) });
  });

  it('resolves it inside the sessions/ layout too', async () => {
    mkdirSync(join(project, 'sessions'));
    writeFileSync(join(project, 'sessions', `${SESSION}.jsonl`), '');
    const target = await resolveTailTarget(project, SESSION);
    expect(target.filePath).toBe(join(project, 'sessions', `${SESSION}.jsonl`));
  });

  it('finds a root transcript even when a sessions/ dir exists', async () => {
    // The old probe picked ONE directory — `sessions/` if it existed — so a
    // transcript in the root was invisible whenever that folder was there.
    mkdirSync(join(project, 'sessions'));
    writeFileSync(join(project, `${SESSION}.jsonl`), '');
    const target = await resolveTailTarget(project, SESSION);
    expect(target.state).toBe('tailing');
    expect(target.filePath).toBe(join(project, `${SESSION}.jsonl`));
  });

  it('waits for the requested transcript instead of taking another one', async () => {
    // THE bug. An unrelated transcript is present and is the newest file in the
    // project; the requested one does not exist yet.
    writeFileSync(join(project, `${OTHER}.jsonl`), toolLine('Read'));
    const target = await resolveTailTarget(project, SESSION);
    expect(target.state).toBe('pending');
    expect(target.filePath).toBeNull();
    expect(target.watchDir).toBe(project);
    expect(target.sessionId).toBe(SESSION);
  });

  it('never resolves a session id that is not one', async () => {
    writeFileSync(join(project, `${OTHER}.jsonl`), '');
    const target = await resolveTailTarget(project, '../../etc/passwd');
    expect(target.state).toBe('none');
    expect(target.filePath).toBeNull();
    // Not even pending: nothing worth waiting for can appear under that name.
    expect(target.watchDir).toBeNull();
  });

  it('says none when the project folder does not exist yet', async () => {
    const target = await resolveTailTarget(join(project, 'not-created'), SESSION);
    expect(target.state).toBe('none');
  });

  it('without a session id, falls back to the newest transcript', async () => {
    // The legacy path, for `process-scanner` entries: they carry no session id,
    // so "the project's most recent transcript" is the only possible answer —
    // and there it is a declared guess, not a wrong attachment.
    const older = join(project, `${OTHER}.jsonl`);
    const newer = join(project, `${SESSION}.jsonl`);
    writeFileSync(older, '');
    writeFileSync(newer, '');
    const past = Date.now() / 1000 - 600;
    utimesSync(older, past, past);

    const target = await resolveTailTarget(project, null);
    expect(target).toMatchObject({ state: 'tailing', filePath: newer, sessionId: null });
  });

  it('without a session id and with no transcripts, there is nothing to tail', async () => {
    expect((await resolveTailTarget(project, null)).state).toBe('none');
  });
});

// End-to-end over a real chokidar watcher. Polling is used so the test does not
// depend on the latency of native filesystem events (fsevents/inotify).
describe('startLiveMonitor', () => {
  const WATCH = { usePolling: true, interval: 20 };

  const collect = () => {
    const events: LiveEvent[] = [];
    return { events, onEvent: (e: LiveEvent) => events.push(e) };
  };

  // Il watcher prende la sua misura iniziale del file dopo il ready: scrivere
  // prima di allora fa sì che il primo stat veda già il file cresciuto e non
  // riporti alcun cambiamento. È un fatto dei watcher, non del modulo, e in
  // produzione non si pone (il transcript non viene scritto nell'istante in cui
  // si apre la vista); nei test si aspetta.
  const settle = () => new Promise(r => setTimeout(r, 250));

  const waitFor = async (predicate: () => boolean, ms = 3000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise(r => setTimeout(r, 25));
    }
    return predicate();
  };

  it('tails only appends to the requested transcript', async () => {
    const mine = join(project, `${SESSION}.jsonl`);
    writeFileSync(mine, '');
    writeFileSync(join(project, `${OTHER}.jsonl`), '');
    const { events, onEvent } = collect();

    const status = await startLiveMonitor({
      projectPath: project,
      sessionId: SESSION,
      onEvent,
      watchOptions: WATCH,
    });
    expect(status).toMatchObject({ state: 'tailing', sessionId: SESSION, filePath: mine });
    await settle();

    appendFileSync(join(project, `${OTHER}.jsonl`), toolLine('Grep'));
    appendFileSync(mine, toolLine('Read'));

    expect(await waitFor(() => events.length > 0)).toBe(true);
    // Whatever the other session wrote is not this session's activity.
    await waitFor(() => events.length > 1, 300);
    expect(events.map(e => e.toolName)).toEqual(['Read']);
  });

  it('starts pending and attaches when the exact transcript appears', async () => {
    // The startup race: the registry knows the session id, the file does not
    // exist yet. Previously this answered `started: true` on someone else's file.
    writeFileSync(join(project, `${OTHER}.jsonl`), toolLine('Grep'));
    const { events, onEvent } = collect();
    const statuses: string[] = [];

    const status = await startLiveMonitor({
      projectPath: project,
      sessionId: SESSION,
      onEvent,
      onStatus: s => statuses.push(s.state),
      watchOptions: WATCH,
    });
    expect(status.state).toBe('pending');
    await settle();

    // Another session appends meanwhile: still not ours.
    appendFileSync(join(project, `${OTHER}.jsonl`), toolLine('Bash'));
    await waitFor(() => events.length > 0, 300);
    expect(events).toHaveLength(0);
    expect(statuses).toHaveLength(0);

    // Ours is created, with content: read from byte 0, since it was just born.
    writeFileSync(join(project, `${SESSION}.jsonl`), toolLine('Write'));

    expect(await waitFor(() => events.length > 0)).toBe(true);
    expect(events.map(e => e.toolName)).toEqual(['Write']);
    expect(statuses).toEqual(['tailing']);
  });

  it('picks up the transcript when it appears in a sessions/ dir created later', async () => {
    const { events, onEvent } = collect();
    const status = await startLiveMonitor({
      projectPath: project,
      sessionId: SESSION,
      onEvent,
      watchOptions: WATCH,
    });
    expect(status.state).toBe('pending');
    await settle();

    mkdirSync(join(project, 'sessions'));
    writeFileSync(join(project, 'sessions', `${SESSION}.jsonl`), toolLine('Edit'));

    expect(await waitFor(() => events.length > 0)).toBe(true);
    expect(events.map(e => e.toolName)).toEqual(['Edit']);
  });

  it('retargets on a second start and stops reading the first session', async () => {
    const first = join(project, `${SESSION}.jsonl`);
    const second = join(project, `${OTHER}.jsonl`);
    writeFileSync(first, '');
    writeFileSync(second, '');
    const a = collect();
    const b = collect();

    await startLiveMonitor({
      projectPath: project,
      sessionId: SESSION,
      onEvent: a.onEvent,
      watchOptions: WATCH,
    });
    await settle();
    appendFileSync(first, toolLine('Read'));
    expect(await waitFor(() => a.events.length > 0)).toBe(true);

    await startLiveMonitor({
      projectPath: project,
      sessionId: OTHER,
      onEvent: b.onEvent,
      watchOptions: WATCH,
    });
    await settle();
    appendFileSync(first, toolLine('Grep'));
    appendFileSync(second, toolLine('Bash'));

    expect(await waitFor(() => b.events.length > 0)).toBe(true);
    await waitFor(() => a.events.length > 1, 300);
    // The first session's later append reached neither collector.
    expect(a.events.map(e => e.toolName)).toEqual(['Read']);
    expect(b.events.map(e => e.toolName)).toEqual(['Bash']);
  });

  it('reports none — and watches nothing — when the id cannot be a session id', async () => {
    writeFileSync(join(project, `${OTHER}.jsonl`), '');
    const { events, onEvent } = collect();

    const status = await startLiveMonitor({
      projectPath: project,
      sessionId: '../escape',
      onEvent,
      watchOptions: WATCH,
    });
    expect(status.state).toBe('none');
    await settle();

    appendFileSync(join(project, `${OTHER}.jsonl`), toolLine('Read'));
    await waitFor(() => events.length > 0, 300);
    expect(events).toHaveLength(0);
  });

  it('tails the newest transcript when no session id is given', async () => {
    const newest = join(project, `${OTHER}.jsonl`);
    writeFileSync(newest, '');
    const { events, onEvent } = collect();

    const status = await startLiveMonitor({
      projectPath: project,
      sessionId: null,
      onEvent,
      watchOptions: WATCH,
    });
    expect(status).toMatchObject({ state: 'tailing', sessionId: null, filePath: newest });
    await settle();

    appendFileSync(newest, toolLine('Read'));
    expect(await waitFor(() => events.length > 0)).toBe(true);
  });
});
