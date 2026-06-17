import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readChatSessionViaSdk } from '../electron/modules/session-reader';

// Auth-free integration test for the transcript read path (the "Lens content
// disappears" family): the Agent SDK reads a session `.jsonl` off disk and we map
// it to ChatMessage[]. No model turn, no API key — just real SDK + real files,
// so it runs in the normal verify job and is OS-agnostic (the SDK scans every
// project dir under ~/.claude, so the dir name need not encode a real cwd).
const SESSION_ID = '11111111-2222-3333-4444-555555555555';

let home: string;
const realHome = process.env.HOME;
const realUserProfile = process.env.USERPROFILE;

function jsonl(lines: unknown[]): string {
  return lines.map(l => JSON.stringify(l)).join('\n') + '\n';
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'cl-sdk-home-'));
  // os.homedir() reads HOME on POSIX and USERPROFILE on Windows — set both.
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const projDir = join(home, '.claude', 'projects', '-tmp-fakeproj');
  mkdirSync(projDir, { recursive: true });
  writeFileSync(
    join(projDir, `${SESSION_ID}.jsonl`),
    jsonl([
      { type: 'mode', mode: 'normal', sessionId: SESSION_ID },
      {
        parentUuid: null,
        isSidechain: false,
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-06-17T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'hello world' }] },
      },
      {
        parentUuid: 'u1',
        isSidechain: false,
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-06-17T10:00:01.000Z',
        message: {
          model: 'claude-opus-4-8',
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'hi there' }],
        },
      },
    ])
  );
});

afterAll(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  if (realUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realUserProfile;
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('readChatSessionViaSdk', () => {
  it('reads and maps a saved transcript to ChatMessage[]', async () => {
    const messages = await readChatSessionViaSdk(SESSION_ID);
    expect(messages).toHaveLength(2);

    const [user, assistant] = messages;
    expect(user.role).toBe('user');
    expect(user.content).toEqual([{ type: 'text', text: 'hello world' }]);

    expect(assistant.role).toBe('assistant');
    expect(assistant.model).toBe('claude-opus-4-8');
    expect(assistant.content).toEqual([{ type: 'text', text: 'hi there' }]);
  });

  it('returns an empty array for an unknown session id', async () => {
    const messages = await readChatSessionViaSdk('00000000-0000-0000-0000-000000000000');
    expect(messages).toEqual([]);
  });
});
