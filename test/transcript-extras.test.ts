import {
  readTranscriptExtras,
  mergeTranscriptExtras,
  parseBashEditDiff,
} from '../electron/modules/transcript-extras';
import type { BashEditDiff, ChatMessage } from '../electron/shared/chat-types';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let dir: string;

function writeJsonl(lines: unknown[]): string {
  const p = join(dir, 'session.jsonl');
  writeFileSync(p, lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'));
  return p;
}

/** A `queue-operation` row as Claude Code writes it (no uuid, no parentUuid). */
function queueRow(
  operation: 'enqueue' | 'dequeue' | 'remove',
  content: string,
  timestamp: string,
  reason?: string
): Record<string, unknown> {
  return {
    type: 'queue-operation',
    operation,
    timestamp,
    sessionId: 's1',
    content,
    ...(reason ? { reason } : {}),
  };
}

function userRow(uuid: string, text: string, timestamp = '2026-09-08T10:00:00.000Z') {
  return { type: 'user', uuid, timestamp, message: { role: 'user', content: text } };
}

/** The skill expansion Claude Code injects after an invocation: `isMeta`, and
 *  parented to the row that invoked the skill. */
function skillExpansionRow(parentUuid: string, path: string) {
  return {
    type: 'user',
    uuid: `meta-${parentUuid}`,
    parentUuid,
    isMeta: true,
    timestamp: '2026-09-08T10:00:01.000Z',
    message: {
      role: 'user',
      content: `Base directory for this skill: ${path}\n\n# The skill body`,
    },
  };
}

function msg(
  uuid: string,
  role: 'user' | 'assistant',
  text: string,
  timestamp: string
): ChatMessage {
  return { uuid, role, timestamp, content: [{ type: 'text', text }] };
}

/** An assistant row in the key order Claude Code writes: `message` first, the
 *  metadata (`uuid`, `effort`, `perTurnEffort`) after it. The order is what lets
 *  the reader take the row's own values without deserializing the whole line. */
function assistantRow(
  uuid: string,
  text: string,
  meta: { effort?: string | null; perTurnEffort?: string | null } = {}
) {
  return {
    parentUuid: 'p0',
    message: { role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text }] },
    type: 'assistant',
    uuid,
    timestamp: '2026-09-08T10:00:00.000Z',
    effort: meta.effort ?? null,
    perTurnEffort: meta.perTurnEffort ?? null,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cl-extras-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readTranscriptExtras', () => {
  it('reports nothing for a file that is not there', async () => {
    const extras = await readTranscriptExtras(join(dir, 'nope.jsonl'));
    expect(extras.queued).toEqual([]);
    expect(extras.skillPathByParentUuid.size).toBe(0);
  });

  it('materializes a message absorbed mid-turn', async () => {
    const p = writeJsonl([
      queueRow('enqueue', 'aggiungi anche il grafico', '2026-09-08T10:00:00.000Z'),
      queueRow(
        'remove',
        'aggiungi anche il grafico',
        '2026-09-08T10:00:30.000Z',
        'absorbed_mid_turn'
      ),
    ]);
    const { queued } = await readTranscriptExtras(p);
    expect(queued).toHaveLength(1);
    expect(queued[0].role).toBe('user');
    expect(queued[0].queued).toBe(true);
    expect(queued[0].content).toEqual([{ type: 'text', text: 'aggiungi anche il grafico' }]);
  });

  it('shows when the message was typed, not when it was absorbed', async () => {
    const p = writeJsonl([
      queueRow('enqueue', 'ciao', '2026-09-08T10:00:00.000Z'),
      queueRow('remove', 'ciao', '2026-09-08T10:00:30.000Z', 'absorbed_mid_turn'),
    ]);
    const { queued } = await readTranscriptExtras(p);
    expect(queued[0].timestamp).toBe('2026-09-08T10:00:00.000Z');
  });

  it('falls back to the removal time when no enqueue carried the text', async () => {
    const p = writeJsonl([
      queueRow('remove', 'ciao', '2026-09-08T10:00:30.000Z', 'absorbed_mid_turn'),
    ]);
    const { queued } = await readTranscriptExtras(p);
    expect(queued[0].timestamp).toBe('2026-09-08T10:00:30.000Z');
  });

  it('keeps a removal that carries no reason (older Claude Code)', async () => {
    const p = writeJsonl([queueRow('remove', 'mando io, tu verifica', '2026-09-08T10:00:30.000Z')]);
    const { queued } = await readTranscriptExtras(p);
    expect(queued.map(m => m.content)).toEqual([[{ type: 'text', text: 'mando io, tu verifica' }]]);
  });

  it('ignores a queued message that was delivered as its own turn', async () => {
    // enqueue + dequeue is the normal path: the message becomes a real `user`
    // row, so materializing it here would show the turn twice.
    const p = writeJsonl([
      queueRow('enqueue', 'poi committa', '2026-09-08T10:00:00.000Z'),
      queueRow('dequeue', 'poi committa', '2026-09-08T10:00:05.000Z'),
      userRow('u1', 'poi committa'),
    ]);
    const { queued } = await readTranscriptExtras(p);
    expect(queued).toEqual([]);
  });

  it('gives each recovered message a distinct id', async () => {
    const p = writeJsonl([
      queueRow('remove', 'primo', '2026-09-08T10:00:00.000Z', 'absorbed_mid_turn'),
      queueRow('remove', 'secondo', '2026-09-08T10:00:00.000Z', 'absorbed_mid_turn'),
    ]);
    const { queued } = await readTranscriptExtras(p);
    expect(new Set(queued.map(m => m.uuid)).size).toBe(2);
  });

  it('maps a skill expansion to the row that invoked it', async () => {
    const p = writeJsonl([
      userRow('cmd1', '<command-name>/sara:sara-legacy-db</command-name>'),
      skillExpansionRow('cmd1', '/Users/x/.claude/plugins/cache/isi/sara/skills/sara-legacy-db'),
    ]);
    const { skillPathByParentUuid } = await readTranscriptExtras(p);
    expect(skillPathByParentUuid.get('cmd1')).toBe(
      '/Users/x/.claude/plugins/cache/isi/sara/skills/sara-legacy-db'
    );
  });

  it('survives a malformed line', async () => {
    const p = writeJsonl([
      '{"type":"queue-operation","operation":"remove",',
      queueRow('remove', 'ok', '2026-09-08T10:00:00.000Z', 'absorbed_mid_turn'),
    ]);
    const { queued } = await readTranscriptExtras(p);
    expect(queued).toHaveLength(1);
  });
});

describe('readTranscriptExtras — effort', () => {
  it('reads the effort of each assistant turn', async () => {
    const p = writeJsonl([
      assistantRow('a1', 'primo', { effort: 'medium' }),
      assistantRow('a2', 'secondo', { effort: 'xhigh' }),
    ]);
    const extras = await readTranscriptExtras(p);
    expect(extras.effortByUuid.get('a1')).toBe('medium');
    expect(extras.effortByUuid.get('a2')).toBe('xhigh');
  });

  it("prefers the turn's own override to the session effort", async () => {
    const p = writeJsonl([assistantRow('a1', 'uno', { effort: 'medium', perTurnEffort: 'max' })]);
    expect((await readTranscriptExtras(p)).effortByUuid.get('a1')).toBe('max');
  });

  it('reports no effort for a transcript that does not record one', async () => {
    const p = writeJsonl([userRow('u1', 'ciao'), assistantRow('a1', 'ok')]);
    expect((await readTranscriptExtras(p)).effortByUuid.size).toBe(0);
  });

  // The row's own metadata is written after `message`, so a tool_result quoting
  // another transcript lands BEFORE it and must not be the pair that is read.
  it('reads the row that owns the line, not a transcript quoted inside it', async () => {
    const quoted = JSON.stringify({
      type: 'assistant',
      uuid: 'quoted-uuid',
      effort: 'medium',
    });
    const row = {
      parentUuid: 'p0',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: `ho letto: ${quoted}` }],
      },
      type: 'assistant',
      uuid: 'real',
      timestamp: '2026-09-08T10:00:00.000Z',
      effort: 'xhigh',
      perTurnEffort: null,
    };
    const extras = await readTranscriptExtras(writeJsonl([row]));
    expect(extras.effortByUuid.get('real')).toBe('xhigh');
    expect(extras.effortByUuid.has('quoted-uuid')).toBe(false);
  });
});

describe('mergeTranscriptExtras', () => {
  const extrasOf = (
    queued: ChatMessage[],
    skills: [string, string][] = [],
    efforts: [string, string][] = [],
    diffs: [string, BashEditDiff][] = []
  ) => ({
    queued,
    skillPathByParentUuid: new Map(skills),
    effortByUuid: new Map(efforts),
    bashEditDiffByToolUseId: new Map(diffs),
  });

  it('leaves the transcript untouched when there is nothing to add', () => {
    const messages = [msg('a', 'user', 'hi', '2026-09-08T10:00:00.000Z')];
    expect(mergeTranscriptExtras(messages, extrasOf([]))).toBe(messages);
  });

  it('splices a recovered message at the moment it was typed', () => {
    const messages = [
      msg('a', 'user', 'fai la cosa', '2026-09-08T10:00:00.000Z'),
      msg('b', 'assistant', 'fatto', '2026-09-08T10:05:00.000Z'),
    ];
    const queued = [
      {
        ...msg('q', 'user', 'anche il grafico', '2026-09-08T10:02:00.000Z'),
        queued: true as const,
      },
    ];
    expect(mergeTranscriptExtras(messages, extrasOf(queued)).map(m => m.uuid)).toEqual([
      'a',
      'q',
      'b',
    ]);
  });

  it('appends a recovered message that came after the last turn on record', () => {
    const messages = [msg('a', 'assistant', 'fatto', '2026-09-08T10:00:00.000Z')];
    const queued = [
      { ...msg('q', 'user', 'grazie', '2026-09-08T10:09:00.000Z'), queued: true as const },
    ];
    expect(mergeTranscriptExtras(messages, extrasOf(queued)).map(m => m.uuid)).toEqual(['a', 'q']);
  });

  it('drops a recovered message the transcript already shows', () => {
    const messages = [msg('a', 'user', 'poi committa', '2026-09-08T10:00:00.000Z')];
    const queued = [
      { ...msg('q', 'user', 'poi committa', '2026-09-08T09:59:00.000Z'), queued: true as const },
    ];
    expect(mergeTranscriptExtras(messages, extrasOf(queued)).map(m => m.uuid)).toEqual(['a']);
  });

  it('stamps the effort on the turn it belongs to', () => {
    const messages = [
      msg('a', 'assistant', 'uno', '2026-09-08T10:00:00.000Z'),
      msg('b', 'assistant', 'due', '2026-09-08T10:01:00.000Z'),
    ];
    const merged = mergeTranscriptExtras(messages, extrasOf([], [], [['b', 'xhigh']]));
    expect(merged[0].effort).toBeUndefined();
    expect(merged[1].effort).toBe('xhigh');
  });

  // `session-search` sends every transcript that passes its prefilter through
  // here, and the file reader has already stamped the effort on all of them:
  // rewriting each message to reaffirm a value read from the same row would be
  // one allocation per assistant turn, per file, for no change.
  it('hands back the same messages when they already carry their effort', () => {
    const messages = [
      { ...msg('a', 'assistant', 'uno', '2026-09-08T10:00:00.000Z'), effort: 'xhigh' },
      { ...msg('b', 'assistant', 'due', '2026-09-08T10:01:00.000Z'), effort: 'xhigh' },
    ];
    const merged = mergeTranscriptExtras(
      messages,
      extrasOf(
        [],
        [],
        [
          ['a', 'xhigh'],
          ['b', 'xhigh'],
        ]
      )
    );
    expect(merged[0]).toBe(messages[0]);
    expect(merged[1]).toBe(messages[1]);
  });

  it('keeps an effort the reader already put on the message', () => {
    const messages = [
      { ...msg('a', 'assistant', 'uno', '2026-09-08T10:00:00.000Z'), effort: 'max' },
    ];
    const merged = mergeTranscriptExtras(messages, extrasOf([], [], [['a', 'medium']]));
    expect(merged[0].effort).toBe('max');
  });

  it('stamps the skill path on the message that invoked it, and only on it', () => {
    const messages = [
      msg('cmd1', 'user', '<command-name>/build-dmg</command-name>', '2026-09-08T10:00:00.000Z'),
      msg('a', 'assistant', 'via', '2026-09-08T10:00:01.000Z'),
    ];
    const merged = mergeTranscriptExtras(messages, extrasOf([], [['cmd1', '/skills/build-dmg']]));
    expect(merged[0].skillPath).toBe('/skills/build-dmg');
    expect(merged[1].skillPath).toBeUndefined();
  });
});

/** The row Claude Code writes when a Bash command edited files: the diff sits on
 *  `toolUseResult`, beside `message`, and the result block names the tool call. */
function bashResultRow(
  uuid: string,
  toolUseId: string,
  bashEditDiff: unknown,
  timestamp = '2026-09-08T10:00:02.000Z'
) {
  return {
    type: 'user',
    uuid,
    timestamp,
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }],
    },
    toolUseResult: { stdout: 'ok', stderr: '', bashEditDiff },
  };
}

const oneHunk = [
  { oldStart: 12, oldLines: 3, newStart: 12, newLines: 4, lines: [' a', '-b', '+c'] },
];

describe('readTranscriptExtras — bashEditDiff', () => {
  // The gap this closes: an edit made from Bash (`sed -i`, a heredoc) produces
  // no Edit tool call at all, so without the diff the transcript shows a
  // command and its stdout and nothing about the file it rewrote (#265). The
  // SDK read cannot help — it returns `message` and never `toolUseResult`.
  it('recovers the diff of a Bash result, keyed by its tool_use id', async () => {
    const extras = await readTranscriptExtras(
      writeJsonl([
        userRow('u1', 'edit it'),
        bashResultRow('r1', 'toolu_bash1', {
          files: [{ filePath: '/p/a.ts', hunks: oneHunk }],
          changedFiles: ['/p/a.ts'],
          moreFiles: 0,
        }),
      ])
    );

    const diff = extras.bashEditDiffByToolUseId.get('toolu_bash1');
    expect(diff?.files[0].filePath).toBe('/p/a.ts');
    expect(diff?.files[0].hunks[0].lines).toEqual([' a', '-b', '+c']);
    expect(diff?.changedFiles).toEqual(['/p/a.ts']);
  });

  it('refuses a row whose diff cannot be pinned to one tool call', async () => {
    // The diff is on the row, not on the block, so with two results in the same
    // row there is nothing that says which of them changed the files — and
    // showing it on the wrong tool is worse than not showing it.
    const row = bashResultRow('r1', 'toolu_bash1', {
      files: [{ filePath: '/p/a.ts', hunks: oneHunk }],
      changedFiles: ['/p/a.ts'],
      moreFiles: 0,
    });
    row.message.content.push({ type: 'tool_result', tool_use_id: 'toolu_other', content: 'ok' });

    const extras = await readTranscriptExtras(writeJsonl([row]));
    expect(extras.bashEditDiffByToolUseId.size).toBe(0);
  });

  it('says a diff was unavailable instead of showing an empty one', async () => {
    // `unavailable` comes with no `files` and no `changedFiles`. Dropping it
    // would render as "the command changed nothing", which is a different claim.
    const extras = await readTranscriptExtras(
      writeJsonl([
        bashResultRow('r1', 'toolu_bash1', { files: [], moreFiles: 0, unavailable: true }),
      ])
    );
    expect(extras.bashEditDiffByToolUseId.get('toolu_bash1')).toEqual({
      files: [],
      changedFiles: [],
      moreFiles: 0,
      unavailable: true,
    });
  });

  it('leaves a result alone when the row carries no diff', async () => {
    const extras = await readTranscriptExtras(
      writeJsonl([
        {
          type: 'user',
          uuid: 'r1',
          timestamp: '2026-09-08T10:00:02.000Z',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_bash1', content: 'ok' }],
          },
          toolUseResult: { stdout: 'ok', stderr: '' },
        },
      ])
    );
    expect(extras.bashEditDiffByToolUseId.size).toBe(0);
  });
});

describe('parseBashEditDiff', () => {
  // The row comes from a file another program writes and nobody versions, so
  // every piece is optional until it has been seen.
  it('keeps the file flags the corpus carries and drops the malformed rest', () => {
    const diff = parseBashEditDiff({
      bashEditDiff: {
        files: [
          { filePath: '/p/new.ts', hunks: oneHunk, created: true },
          { filePath: '/p/gone.ts', hunks: [], deleted: true },
          { hunks: oneHunk },
          'not a file',
        ],
        changedFiles: ['/p/new.ts', 42],
        moreFiles: 3,
      },
    });

    expect(diff?.files.map(f => f.filePath)).toEqual(['/p/new.ts', '/p/gone.ts']);
    expect(diff?.files[0].created).toBe(true);
    expect(diff?.files[1].deleted).toBe(true);
    expect(diff?.changedFiles).toEqual(['/p/new.ts']);
    expect(diff?.moreFiles).toBe(3);
  });

  it('is undefined when there is nothing a reader could show', () => {
    expect(parseBashEditDiff(undefined)).toBeUndefined();
    expect(parseBashEditDiff({ stdout: 'ok' })).toBeUndefined();
    expect(
      parseBashEditDiff({ bashEditDiff: { files: [], changedFiles: [], moreFiles: 0 } })
    ).toBeUndefined();
  });

  it('drops a hunk with no lines, which would draw an empty diff', () => {
    const diff = parseBashEditDiff({
      bashEditDiff: {
        files: [{ filePath: '/p/a.ts', hunks: [{ oldStart: 1, lines: [] }, oneHunk[0]] }],
        changedFiles: ['/p/a.ts'],
        moreFiles: 0,
      },
    });
    expect(diff?.files[0].hunks).toHaveLength(1);
    expect(diff?.files[0].hunks[0].newLines).toBe(4);
  });
});

describe('mergeTranscriptExtras — bashEditDiff', () => {
  const diffExtras = (diffs: [string, BashEditDiff][]) => ({
    queued: [],
    skillPathByParentUuid: new Map<string, string>(),
    effortByUuid: new Map<string, string>(),
    bashEditDiffByToolUseId: new Map(diffs),
  });

  const resultMsg = (uuid: string, toolUseId: string): ChatMessage => ({
    uuid,
    role: 'user',
    timestamp: '2026-09-08T10:00:02.000Z',
    content: [{ type: 'tool_result', toolUseId, content: 'ok', isError: false }],
  });

  const diff: BashEditDiff = {
    files: [{ filePath: '/p/a.ts', hunks: oneHunk }],
    changedFiles: ['/p/a.ts'],
    moreFiles: 0,
  };

  it('stamps the diff on the tool_result it belongs to, and on no other', () => {
    const messages = [resultMsg('r1', 'toolu_bash1'), resultMsg('r2', 'toolu_other')];
    const merged = mergeTranscriptExtras(messages, diffExtras([['toolu_bash1', diff]]));

    const stamped = merged[0].content[0];
    expect(stamped.type === 'tool_result' && stamped.bashEditDiff?.files[0].filePath).toBe(
      '/p/a.ts'
    );
    expect(merged[1]).toBe(messages[1]);
  });

  it('returns the messages by reference when the reader already attached it', () => {
    // The file reader has the whole row and stamps the block itself, so this
    // pass has nothing to do — and must not copy every message to say so.
    const messages: ChatMessage[] = [
      {
        ...resultMsg('r1', 'toolu_bash1'),
        content: [
          {
            type: 'tool_result',
            toolUseId: 'toolu_bash1',
            content: 'ok',
            isError: false,
            bashEditDiff: diff,
          },
        ],
      },
    ];
    expect(mergeTranscriptExtras(messages, diffExtras([['toolu_bash1', diff]]))[0]).toBe(
      messages[0]
    );
  });
});
