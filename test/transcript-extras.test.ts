import {
  readTranscriptExtras,
  mergeTranscriptExtras,
  parseBashEditDiff,
  parseArtifactPublish,
} from '../electron/modules/transcript-extras';
import type { ArtifactPublish, BashEditDiff, ChatMessage } from '../electron/shared/chat-types';
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
      userRow('cmd1', '<command-name>/acme:acme-legacy-db</command-name>'),
      skillExpansionRow('cmd1', '/Users/x/.claude/plugins/cache/vendor/acme/skills/acme-legacy-db'),
    ]);
    const { skillPathByParentUuid } = await readTranscriptExtras(p);
    expect(skillPathByParentUuid.get('cmd1')).toBe(
      '/Users/x/.claude/plugins/cache/vendor/acme/skills/acme-legacy-db'
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
    injected: [],
    noticeByUuid: new Map(),
    skillPathByParentUuid: new Map(skills),
    effortByUuid: new Map(efforts),
    bashEditDiffByToolUseId: new Map(diffs),
    artifactByToolUseId: new Map(),
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
    injected: [],
    noticeByUuid: new Map(),
    skillPathByParentUuid: new Map<string, string>(),
    effortByUuid: new Map<string, string>(),
    bashEditDiffByToolUseId: new Map(diffs),
    artifactByToolUseId: new Map(),
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

// ─── Messages from another session, and harness notices (#274) ───────────────

/** The wrapper Claude Code puts around a message from another session, with the
 *  safety preamble that follows it in the row's own `content`. Neither belongs
 *  on screen: `origin.body` is the message itself. */
function crossSessionContent(body: string, hopChain?: string[]): string {
  const hops = hopChain ? ` hop-chain="${hopChain.join(',')}"` : '';
  return (
    'Another Claude session sent a message:\n' +
    `<cross-session-message from="uds:/tmp/cc-socks/4242.sock"${hops} from-name="alice-7c" from-mode="prompting">\n` +
    `${body}\n</cross-session-message>\n\n` +
    'This came from another Claude session — not typed by your user, but very likely working on their behalf.'
  );
}

/** Delivered to a session that was idle: one `user` row, `isMeta`, carrying the
 *  whole `origin`. */
function peerUserRow(
  uuid: string,
  body: string,
  timestamp: string,
  origin: Record<string, unknown> = {}
) {
  return {
    type: 'user',
    uuid,
    timestamp,
    isMeta: true,
    promptSource: 'system',
    origin: {
      kind: 'peer',
      from: 'uds:/tmp/cc-socks/4242.sock',
      verifiedPeerPid: 4242,
      msg_id: 'm-1',
      name: 'alice-7c',
      fromMode: 'prompting',
      body,
      ...origin,
    },
    message: { role: 'user', content: crossSessionContent(body) },
  };
}

/** Delivered to a session that was mid-turn: the attachment carries the arrival
 *  time and the same `origin`; the queue pair around it is bookkeeping. */
function peerAttachmentRow(
  uuid: string,
  body: string,
  timestamp: string,
  origin: Record<string, unknown> = {}
) {
  return {
    type: 'attachment',
    uuid,
    timestamp,
    attachment: {
      type: 'queued_command',
      prompt: crossSessionContent(body),
      commandMode: 'prompt',
      isMeta: true,
      timestamp,
      origin: {
        kind: 'peer',
        from: 'uds:/tmp/cc-socks/4242.sock',
        verifiedPeerPid: 4242,
        msg_id: 'm-2',
        name: 'alice-7c',
        fromMode: 'prompting',
        body,
        ...origin,
      },
    },
  };
}

describe('a message from another session', () => {
  it('is recovered when it reached an idle session, without its wrapper', async () => {
    const p = writeJsonl([
      peerUserRow('p1', 'the fork inventory is done, nothing pushed', '2026-09-08T10:00:00.000Z'),
    ]);
    const { injected } = await readTranscriptExtras(p);
    expect(injected).toHaveLength(1);
    expect(injected[0].content).toEqual([
      { type: 'text', text: 'the fork inventory is done, nothing pushed' },
    ]);
    expect(injected[0].inbound).toMatchObject({ from: 'session', name: 'alice-7c', pid: 4242 });
    expect(injected[0].inbound?.queued).toBeUndefined();
  });

  it('is recovered when it reached a busy session, dated to its arrival', async () => {
    const p = writeJsonl([
      queueRow('enqueue', crossSessionContent('ping', ['a1']), '2026-09-08T10:00:00.000Z'),
      peerAttachmentRow('p2', 'ping', '2026-09-08T10:00:00.000Z'),
      queueRow(
        'remove',
        crossSessionContent('ping'),
        '2026-09-08T10:00:45.000Z',
        'absorbed_mid_turn'
      ),
    ]);
    const { injected, queued } = await readTranscriptExtras(p);
    // One delivery, one row: the queue pair around it must not produce a second.
    expect(injected).toHaveLength(1);
    expect(queued).toHaveLength(0);
    expect(injected[0].inbound?.queued).toBe(true);
    // The arrival, not the absorption 45 seconds later.
    expect(injected[0].timestamp).toBe('2026-09-08T10:00:00.000Z');
  });

  it('tells an agent inside this session apart from another session', async () => {
    const p = writeJsonl([
      peerUserRow('p3', 'teammate reporting in', '2026-09-08T10:00:00.000Z', {
        from: 'worker-b',
        senderTaskId: 'aworker-b-9f',
        name: 'worker-b',
        verifiedPeerPid: undefined,
      }),
    ]);
    const { injected } = await readTranscriptExtras(p);
    expect(injected[0].inbound).toMatchObject({ from: 'agent', name: 'worker-b' });
    expect(injected[0].inbound?.pid).toBeUndefined();
  });

  it('keeps the join key and the hop chain', async () => {
    const p = writeJsonl([
      peerUserRow('p4', 'replying as agreed', '2026-09-08T10:00:00.000Z', {
        msg_id: 'm-9',
        hopChain: ['a1', 'b2'],
      }),
    ]);
    const { injected } = await readTranscriptExtras(p);
    expect(injected[0].inbound?.msgId).toBe('m-9');
    expect(injected[0].inbound?.hopChain).toEqual(['a1', 'b2']);
  });

  it('leaves a message the user typed mid-turn exactly as it was', async () => {
    const p = writeJsonl([
      queueRow('enqueue', 'aggiungi anche il grafico', '2026-09-08T10:00:00.000Z'),
      queueRow(
        'remove',
        'aggiungi anche il grafico',
        '2026-09-08T10:00:30.000Z',
        'absorbed_mid_turn'
      ),
    ]);
    const { injected, queued } = await readTranscriptExtras(p);
    expect(injected).toHaveLength(0);
    expect(queued).toHaveLength(1);
    expect(queued[0].inbound).toBeUndefined();
  });
});

describe('harness notices', () => {
  it('leaves a background task notification alone: the renderer already cards it', async () => {
    const p = writeJsonl([
      {
        type: 'user',
        uuid: 'n1',
        timestamp: '2026-09-08T10:00:00.000Z',
        promptSource: 'sdk',
        origin: { kind: 'task-notification' },
        message: {
          role: 'user',
          content:
            '<task-notification>\n<task-id>bx12</task-id>\n<status>completed</status>\n</task-notification>',
        },
      },
    ]);
    const { injected, noticeByUuid } = await readTranscriptExtras(p);
    expect(injected).toHaveLength(0);
    expect(noticeByUuid.size).toBe(0);
  });

  it('recovers the idle notice, which carries no origin at all', async () => {
    const p = writeJsonl([
      {
        type: 'user',
        uuid: 'n2',
        timestamp: '2026-09-08T10:00:00.000Z',
        isMeta: true,
        promptSource: 'system',
        message: {
          role: 'user',
          content:
            '[Cross-session idle notice] "alice-7c", which you asked to be notified about, is idle now — it finished a turn at 21:23.',
        },
      },
    ]);
    const { injected } = await readTranscriptExtras(p);
    expect(injected).toHaveLength(1);
    expect(injected[0].notice).toMatchObject({ kind: 'session-idle', subject: 'alice-7c' });
    expect(injected[0].inbound).toBeUndefined();
  });

  it("reads an agent's idle notification as a notice, not as prose", async () => {
    const p = writeJsonl([
      {
        type: 'user',
        uuid: 'n3',
        timestamp: '2026-09-08T10:00:00.000Z',
        message: {
          role: 'user',
          content:
            'Another Claude session sent a message:\n<teammate-message teammate_id="worker-b" color="blue">\n{"type":"idle_notification","from":"worker-b","idleReason":"available","result":"Done, the sweep found nothing."}\n</teammate-message>',
        },
      },
    ]);
    const { noticeByUuid } = await readTranscriptExtras(p);
    expect(noticeByUuid.get('n3')).toEqual({
      kind: 'agent-idle',
      subject: 'worker-b',
      text: 'Done, the sweep found nothing.',
    });
  });
});

describe('mergeTranscriptExtras with what the SDK cannot see', () => {
  it('puts an inbound message in chronological place and stamps a notice by uuid', async () => {
    const sdk: ChatMessage[] = [
      msg('u1', 'user', 'start', '2026-09-08T10:00:00.000Z'),
      msg('n1', 'user', '<teammate-message teammate_id="worker-b">…', '2026-09-08T10:00:20.000Z'),
      msg('a1', 'assistant', 'done', '2026-09-08T10:00:30.000Z'),
    ];
    const merged = mergeTranscriptExtras(sdk, {
      queued: [],
      injected: [
        {
          uuid: 'p1',
          role: 'user',
          timestamp: '2026-09-08T10:00:10.000Z',
          content: [{ type: 'text', text: 'from the other session' }],
          inbound: { from: 'session', name: 'alice-7c' },
        },
      ],
      noticeByUuid: new Map([
        ['n1', { kind: 'agent-idle', subject: 'worker-b', text: 'finished' } as const],
      ]),
      skillPathByParentUuid: new Map(),
      effortByUuid: new Map(),
      bashEditDiffByToolUseId: new Map(),
      artifactByToolUseId: new Map(),
    });
    expect(merged.map(m => m.uuid)).toEqual(['u1', 'p1', 'n1', 'a1']);
    expect(merged[1].inbound?.name).toBe('alice-7c');
    expect(merged[2].notice?.kind).toBe('agent-idle');
  });
});

describe('a notice absorbed while a turn was running', () => {
  it('is still a notice, dated to when it arrived', async () => {
    const line =
      '[Cross-session idle notice] "alice-7c", which you asked to be notified about, is idle now.';
    const p = writeJsonl([
      queueRow('enqueue', line, '2026-09-08T10:00:00.000Z'),
      queueRow('remove', line, '2026-09-08T10:00:40.000Z', 'absorbed_mid_turn'),
    ]);
    const { injected, queued } = await readTranscriptExtras(p);
    expect(queued).toHaveLength(0);
    expect(injected).toHaveLength(1);
    expect(injected[0].notice?.kind).toBe('session-idle');
    expect(injected[0].timestamp).toBe('2026-09-08T10:00:00.000Z');
  });
});

/** The row Claude Code writes when the `Artifact` tool published a page: the
 *  page's identity sits on `toolUseResult`, the prose in the result block. */
function artifactResultRow(
  uuid: string,
  toolUseId: string,
  toolUseResult: unknown,
  timestamp = '2026-09-08T10:00:03.000Z'
) {
  return {
    type: 'user',
    uuid,
    timestamp,
    message: {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: toolUseId, content: 'Published … (Version 2)' },
      ],
    },
    toolUseResult,
  };
}

const publishResult = {
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
};

describe('parseArtifactPublish', () => {
  it('reads the page a publish produced', () => {
    expect(parseArtifactPublish(publishResult)).toEqual({
      id: '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
      url: 'https://claude.ai/artifact/AbCdEf',
      title: 'Release checklist',
      updated: true,
      seq: 2,
      audience: 'owner',
      path: '/tmp/scratch/page.html',
    });
  });

  it('keeps the icon of the publish that created the page', () => {
    const first = parseArtifactPublish({ ...publishResult, updated: false, seq: 1, icon: 'edit' });
    expect(first?.updated).toBe(false);
    expect(first?.icon).toBe('edit');
  });

  it('leaves the version out rather than guessing one', () => {
    // Older transcripts carry no `seq`. A card that invented "v1" there would
    // be wrong on exactly the pages that were published most often.
    const old = parseArtifactPublish({ ...publishResult, seq: undefined });
    expect(old?.seq).toBeUndefined();
    expect(old?.url).toBe('https://claude.ai/artifact/AbCdEf');
  });

  it('is not fooled by another tool result', () => {
    expect(parseArtifactPublish(undefined)).toBeUndefined();
    expect(parseArtifactPublish({ stdout: 'ok' })).toBeUndefined();
    // A read or a listing answers with no page of its own: nothing to show.
    expect(parseArtifactPublish({ artifact_id: 'x' })).toBeUndefined();
    expect(parseArtifactPublish({ url: 'https://claude.ai/artifact/x' })).toBeUndefined();
  });
});

describe('readTranscriptExtras — artifact', () => {
  it('recovers the published page the SDK read never returns', async () => {
    const p = writeJsonl([
      userRow('u1', 'publish it'),
      artifactResultRow('r1', 'toolu_art1', publishResult),
    ]);
    const extras = await readTranscriptExtras(p);
    expect(extras.artifactByToolUseId.get('toolu_art1')?.title).toBe('Release checklist');
    expect(extras.artifactByToolUseId.get('toolu_art1')?.seq).toBe(2);
  });

  it('skips a row whose page cannot be pinned to one tool call', async () => {
    const p = writeJsonl([
      {
        type: 'user',
        uuid: 'r1',
        timestamp: '2026-09-08T10:00:03.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_a', content: 'ok' },
            { type: 'tool_result', tool_use_id: 'toolu_b', content: 'ok' },
          ],
        },
        toolUseResult: publishResult,
      },
    ]);
    const extras = await readTranscriptExtras(p);
    expect(extras.artifactByToolUseId.size).toBe(0);
  });
});

describe('mergeTranscriptExtras — artifact', () => {
  const artifactExtras = (entries: [string, ArtifactPublish][]) => ({
    queued: [],
    injected: [],
    noticeByUuid: new Map(),
    skillPathByParentUuid: new Map<string, string>(),
    effortByUuid: new Map<string, string>(),
    bashEditDiffByToolUseId: new Map(),
    artifactByToolUseId: new Map(entries),
  });

  const resultMsg = (uuid: string, toolUseId: string): ChatMessage => ({
    uuid,
    role: 'user',
    timestamp: '2026-09-08T10:00:03.000Z',
    content: [{ type: 'tool_result', toolUseId, content: 'Published …', isError: false }],
  });

  const page: ArtifactPublish = {
    id: 'a1',
    url: 'https://claude.ai/artifact/AbCdEf',
    title: 'Release checklist',
    updated: true,
    seq: 2,
  };

  it('stamps the page on the tool_result it belongs to, and on no other', () => {
    const messages = [resultMsg('r1', 'toolu_art1'), resultMsg('r2', 'toolu_other')];
    const merged = mergeTranscriptExtras(messages, artifactExtras([['toolu_art1', page]]));

    const stamped = merged[0].content[0];
    expect(stamped.type === 'tool_result' && stamped.artifact?.title).toBe('Release checklist');
    expect(merged[1]).toBe(messages[1]);
  });

  it('returns the messages by reference when there is no page to add', () => {
    const messages = [resultMsg('r1', 'toolu_art1')];
    expect(mergeTranscriptExtras(messages, artifactExtras([]))).toBe(messages);
  });
});
