import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resetSessionReadCache } from '../electron/modules/session-reader';
import {
  readSessionSubagentsViaSdk,
  resetSubagentsCache,
} from '../electron/modules/subagents-reader';

// Auth-free integration test against the real Agent SDK. A `/subtask` fork is an
// agent no `Agent` call launched: its only marker is `isFork` in the
// `.meta.json` sidecar, which the SDK read never returns, so the reader has to
// pick it up from disk itself.
const CWD = '/tmp/fork-proj';
const SESSION_ID = '99999999-8888-7777-6666-555555555555';
const FORK_ID = 'afork-0123456789abcdef';
const PLAIN_ID = 'a0123456789abcdef';

let home: string;
let subagentsDir: string;
let source: { projectDir: string; cwd: string };
const realHome = process.env.HOME;
const realUserProfile = process.env.USERPROFILE;

const jsonl = (lines: unknown[]) => lines.map(l => JSON.stringify(l)).join('\n') + '\n';

const sidechain = (agentId: string, text: string) => ({
  parentUuid: null,
  isSidechain: true,
  agentId,
  type: 'user',
  uuid: `u-${agentId}`,
  cwd: CWD,
  sessionId: SESSION_ID,
  timestamp: '2026-06-17T10:00:02.000Z',
  message: { role: 'user', content: [{ type: 'text', text }] },
});

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'cl-fork-home-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const projDir = join(home, '.claude', 'projects', CWD.replace(/\//g, '-'));
  subagentsDir = join(projDir, SESSION_ID, 'subagents');
  mkdirSync(subagentsDir, { recursive: true });
  source = { projectDir: projDir, cwd: CWD };
  writeFileSync(
    join(projDir, `${SESSION_ID}.jsonl`),
    jsonl([
      {
        parentUuid: null,
        isSidechain: false,
        type: 'user',
        uuid: 'u1',
        cwd: CWD,
        sessionId: SESSION_ID,
        timestamp: '2026-06-17T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      },
    ])
  );
});

beforeEach(() => {
  resetSessionReadCache();
  resetSubagentsCache();
  writeFileSync(
    join(subagentsDir, `agent-${FORK_ID}.jsonl`),
    jsonl([
      { type: 'fork-context-ref', agentId: FORK_ID, parentSessionId: SESSION_ID },
      sidechain(FORK_ID, 'do one thing'),
    ])
  );
  writeFileSync(
    join(subagentsDir, `agent-${FORK_ID}.meta.json`),
    JSON.stringify({ agentType: 'fork', isFork: true, description: 'count the files' })
  );
  writeFileSync(
    join(subagentsDir, `agent-${PLAIN_ID}.jsonl`),
    jsonl([sidechain(PLAIN_ID, 'an ordinary prompt')])
  );
  writeFileSync(
    join(subagentsDir, `agent-${PLAIN_ID}.meta.json`),
    JSON.stringify({ agentType: 'Explore', description: 'look around', toolUseId: 'toolu_1' })
  );
});

afterAll(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  if (realUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realUserProfile;
  rmSync(home, { recursive: true, force: true });
});

describe('readSessionSubagentsViaSdk — forks', () => {
  it('marks a fork from its sidecar and leaves an ordinary sub-agent alone', async () => {
    const metas = await readSessionSubagentsViaSdk(SESSION_ID, source);
    const byId = new Map(metas.map(m => [m.agentId, m]));
    expect(byId.get(FORK_ID)?.fork).toEqual({ description: 'count the files' });
    expect(byId.get(PLAIN_ID)).toBeDefined();
    expect(byId.get(PLAIN_ID)?.fork).toBeUndefined();
  });

  it('treats a missing or unreadable sidecar as not a fork', async () => {
    writeFileSync(join(subagentsDir, `agent-${FORK_ID}.meta.json`), '{not json');
    const metas = await readSessionSubagentsViaSdk(SESSION_ID, source);
    expect(metas.find(m => m.agentId === FORK_ID)?.fork).toBeUndefined();
  });
});
