// The live chat and the transcript reader must agree on what a tool result
// says (#304). Claude Code writes a tool's structured output on the row as
// `toolUseResult`; the Agent SDK streams the same object as `tool_use_result`
// (verified in the bundled CLI: `tool_use_result: <row>.toolUseResult`). The
// diff a Bash command made, the line numbers of an Edit, the page an Artifact
// publish produced and the delivery a SendMessage made all live there — so a
// turn streamed in the SDK chat must carry them exactly as the same turn reread
// from disk does.

import { describe, expect, it } from 'vitest';
import { mapSdkMessageToChat, parseChatSessionText } from '../electron/modules/session-reader';
import { streamedChatMessage } from '../electron/modules/chat-stream';

const AT = '2026-10-08T10:00:02.000Z';

/** The row Claude Code writes for a tool result. */
function toolResultRow(toolUseResult: unknown, toolUseIds: string[] = ['toolu_1']) {
  return {
    type: 'user',
    uuid: 'r-1',
    timestamp: AT,
    message: {
      role: 'user',
      content: toolUseIds.map(id => ({ type: 'tool_result', tool_use_id: id, content: 'ok' })),
    },
    toolUseResult,
  };
}

/** The same row as the SDK streams it. */
function asStreamed(row: ReturnType<typeof toolResultRow>) {
  return {
    type: 'user',
    uuid: row.uuid,
    timestamp: row.timestamp,
    message: row.message,
    parent_tool_use_id: null,
    tool_use_result: row.toolUseResult,
  };
}

const hunk = [{ oldStart: 12, oldLines: 3, newStart: 12, newLines: 4, lines: [' a', '-b', '+c'] }];

const SHAPES: Record<string, unknown> = {
  'the hunks of an Edit': {
    filePath: '/projects/acme/a.ts',
    oldString: 'b',
    newString: 'c',
    originalFile: 'a\nb\n',
    structuredPatch: hunk,
  },
  'the diff of a Bash command that edited files': {
    stdout: 'ok',
    stderr: '',
    bashEditDiff: {
      files: [{ filePath: '/projects/acme/b.ts', hunks: hunk }],
      changedFiles: ['/projects/acme/b.ts'],
      moreFiles: 0,
    },
  },
  'the page of an Artifact publish': {
    url: 'https://claude.ai/artifact/AbCdEf',
    path: '/tmp/scratch/page.html',
    artifact_id: '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
    title: 'Release checklist',
    updated: true,
    audience: 'owner',
    seq: 2,
    version: '1789753451-a182',
    contract: '0.0.0',
    liveSubscription: 'connected',
  },
  'the delivery of a SendMessage': { success: true, msg_id: 'm-1', display: 'sent to review' },
};

describe('a streamed tool result reads as the same row read from disk', () => {
  for (const [what, toolUseResult] of Object.entries(SHAPES)) {
    it(`carries ${what}`, () => {
      const row = toolResultRow(toolUseResult);
      const fromDisk = parseChatSessionText(JSON.stringify(row))[0];
      const fromStream = streamedChatMessage(asStreamed(row));
      expect(fromStream?.content).toEqual(fromDisk.content);
      // …and something was stamped: the bare mapping differs.
      expect(fromStream?.content).not.toEqual(mapSdkMessageToChat(asStreamed(row))?.content);
    });
  }
});

describe('a tool result the stream cannot read', () => {
  const UNREADABLE: Record<string, unknown> = {
    'no structured output': undefined,
    'a null': null,
    'a string': 'ok',
    'a call that stepped aside for the user': { detachedToolCall: true },
    'a Bash result that edited nothing': { stdout: 'ok', stderr: '', interrupted: false },
  };
  for (const [what, toolUseResult] of Object.entries(UNREADABLE)) {
    it(`stamps nothing for ${what}`, () => {
      const streamed = asStreamed(toolResultRow(toolUseResult));
      expect(streamedChatMessage(streamed)).toEqual(mapSdkMessageToChat(streamed));
    });
  }

  it('stamps nothing on a row with two results, as the disk read does', () => {
    const streamed = asStreamed(
      toolResultRow(SHAPES['the hunks of an Edit'], ['toolu_1', 'toolu_2'])
    );
    expect(streamedChatMessage(streamed)).toEqual(mapSdkMessageToChat(streamed));
  });
});

describe('an assistant message', () => {
  it('passes through as the plain mapping', () => {
    const msg = {
      type: 'assistant',
      uuid: 'a-1',
      timestamp: AT,
      message: {
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'Done.' }],
      },
      parent_tool_use_id: null,
    };
    expect(streamedChatMessage(msg)).toEqual(mapSdkMessageToChat(msg));
  });
});
