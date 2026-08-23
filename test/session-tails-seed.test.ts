import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// The seed's own file, apart from `session-tails.test.ts`: the case it covers
// only exists while the seed read is in flight, so it has to reach inside
// `readSessionSpend` — and mocking that module for the other 40 tests would hide
// the very pricing they check.
const configDir = mkdtempSync(join(homedir(), '.cl-seed-test-'));
process.env.CLAUDE_CONFIG_DIR = configDir;

/** An assistant line that billed something: `cacheRead + output` tokens. */
function billed(cacheRead: number, output: number): string {
  return (
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-16T10:00:00.000Z',
      message: {
        role: 'assistant',
        model: 'claude-opus-5',
        content: [],
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: cacheRead,
          output_tokens: output,
        },
      },
    }) + '\n'
  );
}

/** What a live session does while the seed is reading it: one more turn, written
 *  after the cursor was placed and before the figure was returned. Hooked here
 *  because that window is milliseconds wide in production (8–53 ms per
 *  transcript, measured) and cannot be hit on purpose from outside. */
const written: string[] = [];
vi.mock('../electron/modules/cost-tracker', async () => {
  const actual = await vi.importActual<typeof import('../electron/modules/cost-tracker')>(
    '../electron/modules/cost-tracker'
  );
  return {
    ...actual,
    readSessionSpend: async (path: string) => {
      for (const line of written.splice(0)) appendFileSync(path, line);
      return actual.readSessionSpend(path);
    },
  };
});

const tails = await import('../electron/modules/session-tails');
// See the note in `session-tails.test.ts`: the seed reads through cost-tracker's
// parse cache, and these tests rewrite one path with different content, which is
// the one thing an append-only cache may not be asked to survive.
const { resetParseCache } = await import('../electron/modules/cost-tracker');
const { syncSessionTails, onTranscriptChanged, getSessionActivity, resetSessionTails } = tails;
type ActiveSession = import('../electron/modules/sessions-registry-reader').ActiveSession;

const projectsDir = join(configDir, 'projects');
const LIVE: ActiveSession[] = [
  { pid: 1234, sessionId: 's1', cwd: '/Users/foo/proj', status: 'busy', source: 'registry' },
];

function transcript(content: string): string {
  const dir = join(projectsDir, '-Users-foo-proj');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 's1.jsonl');
  writeFileSync(file, content);
  return file;
}

beforeEach(() => {
  resetSessionTails();
  resetParseCache();
  written.length = 0;
  rmSync(projectsDir, { recursive: true, force: true });
  mkdirSync(projectsDir, { recursive: true });
});

afterAll(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  rmSync(configDir, { recursive: true, force: true });
});

// A seed and a cursor are two halves of one statement — everything before byte N
// is in the figure, everything after it is the tail's to add. They used to be
// measured at different moments (a `statSync` before an asynchronous read), and
// the session kept writing in between.
describe('seedSpend', () => {
  it('never bills a turn written while the seed was reading', async () => {
    const file = transcript(billed(400_000, 5_000)); // 405.000 already on disk
    written.push(billed(50_000, 1_000)); // 51.000 more, mid-seed

    await syncSessionTails(LIVE);
    expect(getSessionActivity()[0].tokens).toBe(456_000);

    // The tail resumes where the seed stopped, so it has nothing to re-add.
    onTranscriptChanged(file);
    expect(getSessionActivity()[0].tokens).toBe(456_000);
  });

  // The other way the two halves can disagree: skipping the turn instead of
  // doubling it. Placing the cursor after the read would do exactly that.
  it('does not skip it either, and keeps counting from there', async () => {
    const file = transcript(billed(400_000, 5_000));
    written.push(billed(50_000, 1_000));

    await syncSessionTails(LIVE);
    appendFileSync(file, billed(10_000, 100));
    onTranscriptChanged(file);

    expect(getSessionActivity()[0].tokens).toBe(456_000 + 10_100);
  });

  // A record still being written is not a turn yet: the seed stops before it and
  // the tail reads it whole once its newline lands, rather than each half billing
  // a fragment of it.
  it('hands over on a line boundary, not mid-record', async () => {
    const half = billed(50_000, 1_000);
    const file = transcript(billed(400_000, 5_000) + half.slice(0, 40));

    await syncSessionTails(LIVE);
    expect(getSessionActivity()[0].tokens).toBe(405_000);

    appendFileSync(file, half.slice(40));
    onTranscriptChanged(file);
    expect(getSessionActivity()[0].tokens).toBe(456_000);
  });

  // The seed is the whole file, so a cursor that reads the file itself must not
  // get one. Unchanged by this fix, and the invariant it could break.
  it('still leaves an adopted cursor to read its own file', async () => {
    await syncSessionTails(LIVE); // live with nothing on disk yet
    expect(getSessionActivity()[0].spend).toBeNull();

    const file = transcript(billed(400_000, 5_000));
    onTranscriptChanged(file);
    expect(getSessionActivity()[0].tokens).toBe(405_000);

    await syncSessionTails(LIVE);
    expect(getSessionActivity()[0].tokens).toBe(405_000);
  });
});
