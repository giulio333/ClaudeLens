import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  readChatSessionViaSdk,
  resetSessionReadCache,
  type SessionSource,
} from '../electron/modules/session-reader';

// Auth-free integration test against the REAL Agent SDK, like session-sdk-cache:
// no model turn, no API key, just files on disk.
//
// A message from another session lands as an `isMeta` user row carrying an
// `origin` (receiver idle) or as a `queued_command` attachment carrying it
// (receiver mid-turn). Up to SDK 0.3.280 `getSessionMessages` dropped both, and
// the second pass over the file was the only one to draw them. From 0.3.293 it
// returns them too — the attachment under a synthetic uuid — so each message
// showed twice, once wrapped in the preamble written for Claude.
const SESSION_ID = '13131313-2424-3535-4646-575757575757';
const CWD = join(tmpdir(), 'cl-inbound-proj');
const PREAMBLE = 'Another Claude session sent a message';

let home: string;
let projDir: string;
let source: SessionSource;

const realHome = process.env.HOME;
const realUserProfile = process.env.USERPROFILE;

function jsonl(lines: unknown[]): string {
  return lines.map(l => JSON.stringify(l)).join('\n') + '\n';
}

function peerOrigin(msgId: string, body: string) {
  return {
    kind: 'peer',
    from: 'uds:/tmp/peer.sock',
    verifiedPeerPid: 4242,
    msg_id: msgId,
    name: 'other-session',
    body,
  };
}

function assistantLine(uuid: string, parentUuid: string, timestamp: string, text: string) {
  return {
    parentUuid,
    isSidechain: false,
    type: 'assistant',
    uuid,
    cwd: CWD,
    timestamp,
    message: {
      model: 'claude-opus-4-8',
      id: `msg_${uuid}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  };
}

function writeFixtures(): void {
  writeFileSync(
    join(projDir, `${SESSION_ID}.jsonl`),
    jsonl([
      { type: 'mode', mode: 'normal', sessionId: SESSION_ID, cwd: CWD },
      {
        parentUuid: null,
        isSidechain: false,
        type: 'user',
        uuid: 'u1',
        cwd: CWD,
        timestamp: '2026-06-17T10:00:00.000Z',
        message: { role: 'user', content: 'first question' },
      },
      assistantLine('a1', 'u1', '2026-06-17T10:00:01.000Z', 'first answer'),
      {
        parentUuid: 'a1',
        isSidechain: false,
        isMeta: true,
        type: 'user',
        uuid: 'pm1',
        cwd: CWD,
        timestamp: '2026-06-17T10:00:02.000Z',
        origin: peerOrigin('m-1', 'hello while idle'),
        message: {
          role: 'user',
          content: `${PREAMBLE}: <cross-session-message from="other">hello while idle</cross-session-message>`,
        },
      },
      assistantLine('a2', 'pm1', '2026-06-17T10:00:03.000Z', 'second answer'),
      {
        parentUuid: 'a2',
        isSidechain: false,
        type: 'attachment',
        uuid: 'at1',
        cwd: CWD,
        timestamp: '2026-06-17T10:00:04.000Z',
        attachment: {
          type: 'queued_command',
          isMeta: true,
          prompt: '<cross-session-message from="other">hello mid-turn</cross-session-message>',
          source_uuid: 'src-1',
          origin: peerOrigin('m-2', 'hello mid-turn'),
        },
      },
      assistantLine('a3', 'at1', '2026-06-17T10:00:05.000Z', 'third answer'),
    ])
  );
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'cl-sdk-inbound-home-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  projDir = join(home, '.claude', 'projects', CWD.replace(/\//g, '-'));
  mkdirSync(projDir, { recursive: true });
  source = { projectDir: projDir, cwd: CWD };
});

beforeEach(() => {
  writeFixtures();
  resetSessionReadCache();
});

afterAll(() => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  if (realUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realUserProfile;
  if (home) rmSync(home, { recursive: true, force: true });
});

function texts(messages: Awaited<ReturnType<typeof readChatSessionViaSdk>>): string[] {
  return messages.flatMap(m => m.content.flatMap(c => (c.type === 'text' ? [c.text] : [])));
}

describe('a message from another session, read through the SDK', () => {
  it('shows once, as its body, when it reached an idle session', async () => {
    const all = texts(await readChatSessionViaSdk(SESSION_ID, source));

    expect(all.filter(t => t.includes('hello while idle'))).toEqual(['hello while idle']);
    expect(all.some(t => t.includes(PREAMBLE) || t.includes('<cross-session-message'))).toBe(false);
  });

  it('shows once, as its body, when it arrived mid-turn', async () => {
    const all = texts(await readChatSessionViaSdk(SESSION_ID, source));

    expect(all.filter(t => t.includes('hello mid-turn'))).toEqual(['hello mid-turn']);
  });

  it('keeps the conversation around it in order', async () => {
    const messages = await readChatSessionViaSdk(SESSION_ID, source);

    expect(messages.map(m => m.inbound?.msgId ?? m.uuid)).toEqual([
      'u1',
      'a1',
      'm-1',
      'a2',
      'm-2',
      'a3',
    ]);
  });
});
