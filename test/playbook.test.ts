import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ChatMessage } from '../electron/shared/chat-types';
import { detectPromptCandidates, promptFingerprint } from '../electron/modules/playbook-detector';
import { scanPromptCandidates } from '../electron/modules/playbook-reader';
import {
  createPromptTemplate,
  deletePromptTemplate,
  dismissPrompt,
  readPlaybook,
  updatePromptTemplate,
} from '../electron/modules/playbook-store';

const prompt = 'Review this change carefully.\n\nCheck behavior, regressions, and missing tests.';
const other = 'Write a concise summary of the changes and explain the verification performed.';
const message = (text = prompt, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  uuid: 'm',
  role: 'user',
  timestamp: '2026-09-18T00:00:00Z',
  content: [{ type: 'text', text }],
  ...extra,
});
const row = (text = prompt, extra = {}) => ({
  type: 'user',
  uuid: 'm',
  timestamp: '2026-09-18T00:00:00Z',
  message: { role: 'user', content: text },
  ...extra,
});
let dir: string;
let projects: string;
let store: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'playbook-test-'));
  projects = join(dir, 'projects');
  store = join(dir, 'playbook');
  await mkdir(join(projects, 'project-a'), { recursive: true });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
async function transcript(id: string, rows: unknown[], layout = '') {
  const target = join(projects, 'project-a', layout);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, `${id}.jsonl`), rows.map(value => JSON.stringify(value)).join('\n'));
}

describe('prompt detection', () => {
  it('requires three distinct sessions, folds whitespace only, and preserves formatting', () => {
    const sessions = [
      { sessionId: 'one', messages: [message(), message()] },
      { sessionId: 'one', messages: [message()] },
      { sessionId: 'two', messages: [message(prompt.replace(/\s+/g, ' '))] },
    ];
    expect(detectPromptCandidates(sessions)).toEqual([]);
    sessions.push({ sessionId: 'three', messages: [message(), message(prompt.toUpperCase())] });
    expect(detectPromptCandidates(sessions)).toEqual([
      { id: promptFingerprint(prompt), text: prompt, sessionCount: 3 },
    ]);
  });

  it('excludes commands, notices, inbound traffic, tools, assistant text, and short replies', () => {
    const messages = [
      message('yes'),
      message('/review ' + prompt),
      message('<command-name>/review</command-name>' + prompt),
      message('<task-notification>' + prompt + '</task-notification>'),
      message(prompt, { role: 'assistant' }),
      message(prompt, { skillPath: '/skill' }),
      message(prompt, { notice: { kind: 'session-idle', text: prompt } }),
      message(prompt, { inbound: { from: 'session', name: 'peer' } }),
      message(prompt, {
        content: [{ type: 'tool_result', toolUseId: 't', content: prompt, isError: false }],
      }),
    ];
    expect(
      detectPromptCandidates(['a', 'b', 'c'].map(sessionId => ({ sessionId, messages })))
    ).toEqual([]);
  });
});

describe('real project transcript scanning', () => {
  it('reads queued human messages and the nested sessions layout while excluding meta and sidechains', async () => {
    await transcript('a', [row(), row(other, { uuid: 'meta', isMeta: true })], 'sessions');
    await transcript('b', [row(), row(other, { uuid: 'agent', isSidechain: true })], 'sessions');
    await transcript(
      'c',
      [
        {
          type: 'queue-operation',
          operation: 'enqueue',
          content: prompt,
          timestamp: '2026-09-18T00:00:00Z',
        },
        {
          type: 'queue-operation',
          operation: 'remove',
          content: prompt,
          timestamp: '2026-09-18T00:00:01Z',
        },
        row(other),
      ],
      'sessions'
    );
    await transcript('root-ignored', [row()]);
    await transcript('agent-hidden', [row()], 'sessions/a/subagents');
    const result = await scanPromptCandidates(projects, store, 'project-a');
    expect(result).toEqual({
      candidates: [{ id: promptFingerprint(prompt), text: prompt, sessionCount: 3 }],
      scannedSessions: 3,
      truncated: false,
      skippedSessions: 0,
    });
    expect(await readdir(dir)).toEqual(['projects']);
  });

  it('returns an empty result for a project without history, but still reports corrupted saves', async () => {
    expect(await scanPromptCandidates(projects, store, 'new-project')).toMatchObject({
      candidates: [],
      scannedSessions: 0,
      truncated: false,
    });
    expect(await scanPromptCandidates(join(dir, 'absent'), store, 'new-project')).toMatchObject({
      candidates: [],
      scannedSessions: 0,
      truncated: false,
    });
    await mkdir(join(store, 'new-project'), { recursive: true });
    await writeFile(join(store, 'new-project', 'playbook.json'), '{broken');
    await expect(scanPromptCandidates(projects, store, 'new-project')).rejects.toThrow('corrupted');
  });

  it('excludes delivered messages and sidechain queues even when their text looks human', async () => {
    for (const id of ['a', 'b', 'c'])
      await transcript(id, [
        row(prompt, { origin: { kind: 'peer', body: prompt } }),
        row(other, { uuid: 'meta', isMeta: true }),
        {
          type: 'queue-operation',
          operation: 'remove',
          content: other,
          isSidechain: true,
          timestamp: '2026-09-18T00:00:00Z',
        },
        {
          type: 'attachment',
          attachment: {
            type: 'queued_command',
            origin: { kind: 'peer', body: other, senderTaskId: 'agent' },
          },
        },
      ]);
    expect((await scanPromptCandidates(projects, store, 'project-a')).candidates).toEqual([]);
  });

  it('rejects aliases to another project rather than mixing its prompts into this project', async () => {
    await symlink(join(projects, 'project-a'), join(projects, 'project-b'));
    await expect(scanPromptCandidates(projects, store, 'project-b')).rejects.toThrow(
      'symbolic link'
    );
  });

  it('deduplicates saved and dismissed text with persisted fingerprints and keeps projects isolated', async () => {
    for (const id of ['a', 'b', 'c']) await transcript(id, [row(), row(other, { uuid: 'other' })]);
    await createPromptTemplate(store, 'project-a', {
      name: 'Review',
      text: prompt.replace(/\s+/g, ' '),
    });
    await dismissPrompt(store, 'project-a', other);
    expect((await scanPromptCandidates(projects, store, 'project-a')).candidates).toEqual([]);
    expect(await readPlaybook(store, 'project-b')).toEqual({
      version: 1,
      templates: [],
      dismissed: [],
    });
    const raw = await readFile(join(store, 'project-a', 'playbook.json'), 'utf8');
    expect(raw).not.toContain(other);
    expect(raw).toContain(promptFingerprint(other));
    expect(raw).not.toContain('candidates');
  });

  it('marks caps and escaped/unreadable transcripts partial rather than calling them complete', async () => {
    for (const id of ['a', 'b', 'c']) await transcript(id, [row()]);
    expect(
      await scanPromptCandidates(projects, store, 'project-a', { maxSessions: 2 })
    ).toMatchObject({ scannedSessions: 2, truncated: true });
    expect(
      await scanPromptCandidates(projects, store, 'project-a', { maxFileBytes: 1 })
    ).toMatchObject({ scannedSessions: 0, truncated: true, skippedSessions: 3 });
    await symlink(join(dir, 'missing'), join(projects, 'project-a', 'missing.jsonl'));
    expect(await scanPromptCandidates(projects, store, 'project-a')).toMatchObject({
      scannedSessions: 3,
      truncated: true,
      skippedSessions: 1,
    });
    await writeFile(join(dir, 'outside.jsonl'), JSON.stringify(row()));
    await symlink(join(dir, 'outside.jsonl'), join(projects, 'project-a', 'escaped.jsonl'));
    expect(await scanPromptCandidates(projects, store, 'project-a')).toMatchObject({
      scannedSessions: 3,
      truncated: true,
      skippedSessions: 2,
    });
  });
});

describe('project playbook persistence', () => {
  it('creates, updates, and deletes atomically with timestamps and no leftover temp files', async () => {
    const created = await createPromptTemplate(store, 'project-a', {
      name: ' Review ',
      text: prompt,
    });
    expect(created.name).toBe('Review');
    expect(created.text).toBe(prompt);
    const updated = await updatePromptTemplate(store, 'project-a', created.id, {
      name: 'Summary',
      text: other,
    });
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.text).toBe(other);
    expect((await readPlaybook(store, 'project-a')).templates).toEqual([updated]);
    expect(await readdir(join(store, 'project-a'))).toEqual(['playbook.json']);
    await deletePromptTemplate(store, 'project-a', created.id);
    expect((await readPlaybook(store, 'project-a')).templates).toEqual([]);
  });

  it('serializes concurrent writes and rejects duplicate normalized text', async () => {
    await Promise.all([
      createPromptTemplate(store, 'project-a', { name: 'Review', text: prompt }),
      createPromptTemplate(store, 'project-a', { name: 'Summary', text: other }),
      dismissPrompt(store, 'project-a', 'Another text'),
    ]);
    expect((await readPlaybook(store, 'project-a')).templates).toHaveLength(2);
    await expect(
      createPromptTemplate(store, 'project-a', {
        name: 'Duplicate',
        text: prompt.replace(/\s+/g, ' '),
      })
    ).rejects.toThrow('already saved');
    const [first, second] = (await readPlaybook(store, 'project-a')).templates;
    await expect(
      updatePromptTemplate(store, 'project-a', second.id, { name: 'Duplicate', text: first.text })
    ).rejects.toThrow('already saved');
    await dismissPrompt(store, 'project-a', 'Another   text');
    expect((await readPlaybook(store, 'project-a')).dismissed).toHaveLength(1);
  });

  it('validates every boundary and prevents traversal and symlink writes', async () => {
    for (const hash of ['../bad', '/bad', 'bad\\path', '', null, 'a'.repeat(256)]) {
      await expect(readPlaybook(store, hash)).rejects.toThrow('Invalid project hash');
    }
    for (const input of [
      null,
      {},
      { name: '', text: prompt },
      { name: 'x', text: '' },
      { name: 'x', text: 'a'.repeat(20_001) },
    ]) {
      expect(() => createPromptTemplate(store, 'project-a', input)).toThrow();
    }
    expect(() =>
      updatePromptTemplate(store, 'project-a', '../bad', { name: 'x', text: prompt })
    ).toThrow('Invalid template id');
    await mkdir(store);
    await symlink(join(projects, 'project-a'), join(store, 'project-a'));
    await expect(
      createPromptTemplate(store, 'project-a', { name: 'Review', text: prompt })
    ).rejects.toThrow('symbolic links');
    expect(await readdir(join(projects, 'project-a'))).toEqual([]);
  });

  it('refuses corrupted stores without overwriting their bytes', async () => {
    await mkdir(join(store, 'project-a'), { recursive: true });
    const file = join(store, 'project-a', 'playbook.json');
    for (const raw of [
      '{broken',
      '{"version":1,"templates":[{}],"dismissed":[]}',
      '{"version":2,"templates":[],"dismissed":[]}',
    ]) {
      await writeFile(file, raw);
      await expect(
        createPromptTemplate(store, 'project-a', { name: 'Review', text: prompt })
      ).rejects.toThrow('corrupted');
      await expect(dismissPrompt(store, 'project-a', prompt)).rejects.toThrow('corrupted');
      expect(await readFile(file, 'utf8')).toBe(raw);
    }
  });
});
