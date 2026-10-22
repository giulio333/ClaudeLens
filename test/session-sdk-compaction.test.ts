import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  compactBoundaryNote,
  compactSummaryBody,
  readChatSessionViaSdk,
  resetSessionReadCache,
  type SessionSource,
} from '../electron/modules/session-reader';

// Auth-free integration test against the REAL Agent SDK, like session-sdk-cache:
// no model turn, no API key, just files on disk.
//
// At a compaction Claude Code writes a `system`/`compact_boundary` row and,
// under it, a user row flagged `isCompactSummary` that holds the summary it
// wrote for the model. The SDK returns that row as `is_meta`, so the first pass
// drops it — and the second pass over the file, which only skips `isMeta`, put
// it back as a message the user never typed, the whole summary in raw text.
const SESSION_ID = '24242424-3535-4646-5757-686868686868';
const CWD = join(tmpdir(), 'cl-compaction-proj');
const SUMMARY_OPENING = 'This session is being continued from a previous conversation';
// The summary proper, and the row as Claude Code writes it around it.
const SUMMARY_BODY =
  '1. Primary Request and Intent:\n   - Rename the widget.\n\n2. Pending Tasks:\n   - None.';
const SUMMARY_ROW = [
  `${SUMMARY_OPENING} that ran out of context. The summary below covers the earlier portion of the conversation.`,
  '',
  '<tools-used-before-summary>Bash, Edit, Read</tools-used-before-summary>',
  'Summary:',
  SUMMARY_BODY,
  '',
  'If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /tmp/x.jsonl',
  'Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary.',
  '',
  'The messages after this summary are the most recent messages from before compaction, kept verbatim.',
].join('\n');

let home: string;
let projDir: string;
let source: SessionSource;

const realHome = process.env.HOME;
const realUserProfile = process.env.USERPROFILE;

function jsonl(lines: unknown[]): string {
  return lines.map(l => JSON.stringify(l)).join('\n') + '\n';
}

function userLine(uuid: string, parentUuid: string | null, timestamp: string, text: string) {
  return {
    parentUuid,
    isSidechain: false,
    type: 'user',
    uuid,
    cwd: CWD,
    timestamp,
    message: { role: 'user', content: text },
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

// The shape of an auto-compaction that keeps the last turn verbatim
// (`preservedSegment`): the boundary starts a new chain, the summary hangs from
// it, and the post-compaction conversation hangs from the summary's attachments.
function writeFixtures(): void {
  writeFileSync(
    join(projDir, `${SESSION_ID}.jsonl`),
    jsonl([
      { type: 'mode', mode: 'normal', sessionId: SESSION_ID, cwd: CWD },
      userLine('u1', null, '2026-06-17T10:00:00.000Z', 'first question'),
      assistantLine('a1', 'u1', '2026-06-17T10:00:01.000Z', 'first answer'),
      assistantLine('a2', 'a1', '2026-06-17T10:00:02.000Z', 'kept answer'),
      {
        parentUuid: null,
        logicalParentUuid: 'a2',
        isSidechain: false,
        type: 'system',
        subtype: 'compact_boundary',
        content: 'Conversation compacted',
        isMeta: false,
        uuid: 'b1',
        cwd: CWD,
        timestamp: '2026-06-17T10:00:10.010Z',
        level: 'info',
        compactMetadata: {
          trigger: 'auto',
          preTokens: 367636,
          postTokens: 20595,
          preservedSegment: { headUuid: 'a2', anchorUuid: 's1', tailUuid: 'a2' },
        },
      },
      {
        parentUuid: 'b1',
        isSidechain: false,
        type: 'user',
        uuid: 's1',
        cwd: CWD,
        timestamp: '2026-06-17T10:00:10.000Z',
        isVisibleInTranscriptOnly: true,
        isCompactSummary: true,
        message: {
          role: 'user',
          content: SUMMARY_ROW,
        },
      },
      {
        parentUuid: 's1',
        isSidechain: false,
        type: 'attachment',
        uuid: 'at1',
        cwd: CWD,
        timestamp: '2026-06-17T10:00:10.500Z',
        attachment: { type: 'compact_file_reference', filename: '/tmp/a.md' },
      },
      userLine('u3', 'at1', '2026-06-17T10:00:20.000Z', 'question after compaction'),
      assistantLine('a3', 'u3', '2026-06-17T10:00:21.000Z', 'answer after compaction'),
    ])
  );
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'cl-sdk-compaction-home-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  projDir = join(home, '.claude', 'projects', CWD.replace(/[^a-zA-Z0-9]/g, '-'));
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

describe('a compacted session, read through the SDK', () => {
  it('never shows the summary written for the model', async () => {
    const all = texts(await readChatSessionViaSdk(SESSION_ID, source));

    expect(all.some(t => t.includes(SUMMARY_OPENING))).toBe(false);
  });

  it('marks the compaction with what the boundary recorded', async () => {
    const messages = await readChatSessionViaSdk(SESSION_ID, source);
    const notices = messages.filter(m => m.notice?.kind === 'compaction');

    expect(notices).toHaveLength(1);
    expect(notices[0].notice?.text).toBe(compactBoundaryNote(367636, 'auto'));
    expect(notices[0].uuid).toBe('s1');
  });

  it('keeps the summary for the reader, without the lines written for the model', async () => {
    const messages = await readChatSessionViaSdk(SESSION_ID, source);
    const notice = messages.find(m => m.notice?.kind === 'compaction')?.notice;

    expect(notice?.summary).toBe(SUMMARY_BODY);
  });

  it('places the marker between the history it compacted and what came after', async () => {
    const messages = await readChatSessionViaSdk(SESSION_ID, source);

    expect(messages.map(m => m.uuid)).toEqual(['u1', 'a1', 'a2', 's1', 'u3', 'a3']);
  });
});

describe('compactSummaryBody', () => {
  it('reads a row written as text blocks', () => {
    expect(compactSummaryBody([{ type: 'text', text: SUMMARY_ROW }])).toBe(SUMMARY_BODY);
  });

  it('trims only the ends, so a summary that quotes the harness keeps the quote', () => {
    const quoting =
      'Summary:\nThe test asserts no text says:\nContinue the conversation from where it left off\n- done';
    expect(compactSummaryBody(quoting)).toBe(
      'The test asserts no text says:\nContinue the conversation from where it left off\n- done'
    );
  });

  it('has nothing to show when the row holds only the harness lines', () => {
    expect(compactSummaryBody(`${SUMMARY_OPENING}.\n\nSummary:\n`)).toBeUndefined();
    expect(compactSummaryBody(undefined)).toBeUndefined();
  });
});
