import {
  escapeRegExp,
  findMatches,
  makeSnippet,
  normalizeQuery,
  prefilterNeedle,
  resetSearchStats,
  searchMessages,
  searchSessions,
  searchStats,
  MAX_QUERY_LENGTH,
} from '../electron/modules/session-search';
import type { ChatMessage } from '../electron/shared/chat-types';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let projectsDir: string;

function msg(partial: Partial<ChatMessage> & { uuid: string }): ChatMessage {
  return {
    role: 'user',
    timestamp: '2026-01-01T00:00:00Z',
    content: [],
    ...partial,
  };
}

function userLine(uuid: string, text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    uuid,
    timestamp: '2026-01-01T00:00:00Z',
    message: { role: 'user', content: text },
    ...extra,
  });
}

function assistantLine(uuid: string, blocks: unknown[]): string {
  return JSON.stringify({
    type: 'assistant',
    uuid,
    timestamp: '2026-01-01T00:01:00Z',
    message: { role: 'assistant', model: 'claude-sonnet-5', content: blocks },
  });
}

/** Write a transcript into a project folder, in the given native layout. */
function transcript(hash: string, sessionId: string, lines: string[], nested = false): string {
  const dir = nested ? join(projectsDir, hash, 'sessions') : join(projectsDir, hash);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sessionId}.jsonl`);
  writeFileSync(path, lines.join('\n'), 'utf-8');
  return path;
}

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), 'cl-search-'));
  resetSearchStats();
});

afterEach(() => {
  rmSync(projectsDir, { recursive: true, force: true });
});

describe('prefilterNeedle (pure)', () => {
  it('returns a plain ASCII query unchanged — it survives JSON encoding verbatim', () => {
    expect(prefilterNeedle('spawn helper')).toBe('spawn helper');
  });

  it('returns null for a query too short to reject anything on', () => {
    expect(prefilterNeedle('ab')).toBeNull();
  });

  it('drops a quote and keeps the longest surviving run around it', () => {
    // On disk the quote is written `\"`, so a raw search for the whole phrase
    // would find nothing that is genuinely there.
    expect(prefilterNeedle('say "hello world"')).toBe('hello world');
  });

  it('drops a backslash the same way', () => {
    expect(prefilterNeedle('C:\\Users\\project files')).toBe('project files');
  });

  it('splits on a non-ASCII character rather than giving up on the query', () => {
    // `é` may be written literally or as `\u00e9`; the run around it is safe
    // either way, so the reject stays available.
    expect(prefilterNeedle('perché lo faccio')).toBe(' lo faccio');
  });

  it('returns null when nothing outside the unsafe characters is long enough', () => {
    expect(prefilterNeedle('è à ù')).toBeNull();
  });
});

describe('findMatches (pure)', () => {
  it('reports every match position, case-insensitively', () => {
    const { matches } = findMatches('Spawn the spawner and SPAWN again', 'spawn', 10);
    expect(matches.map(m => m.index)).toEqual([0, 10, 22]);
  });

  it('stops materializing at the limit but keeps counting to the end', () => {
    const { matches, total } = findMatches('aa aa aa aa', 'aa', 2);
    expect(matches).toHaveLength(2);
    expect(total).toBe(4);
  });

  it('treats the query as a literal, not a pattern', () => {
    const { total } = findMatches('a.b and axb', 'a.b', 10);
    expect(total).toBe(1);
    expect(escapeRegExp('a.b')).toBe('a\\.b');
  });

  it('returns the matched length, which case folding can change', () => {
    // A needle and its match are not always the same width once folded.
    const { matches } = findMatches('straße', 'STRASSE', 5);
    // Whether the engine folds ß to ss is the engine's business; what must hold
    // is that a reported match describes the text that is actually there.
    for (const m of matches) {
      expect('straße'.slice(m.index, m.index + m.length).toLowerCase()).toHaveLength(m.length);
    }
  });
});

describe('makeSnippet (pure)', () => {
  it('keeps context on both sides and re-expresses the offset against the window', () => {
    const text = `${'x'.repeat(200)}needle${'y'.repeat(200)}`;
    const snip = makeSnippet(text, 200, 6, 20);
    expect(snip.snippet.slice(snip.matchStart, snip.matchStart + snip.matchLength)).toBe('needle');
    expect(snip.snippet.startsWith('…')).toBe(true);
    expect(snip.snippet.endsWith('…')).toBe(true);
  });

  it('does not mark an ellipsis when the whole text fits', () => {
    const snip = makeSnippet('a needle here', 2, 6, 50);
    expect(snip.snippet).toBe('a needle here');
    expect(snip.matchStart).toBe(2);
  });

  it('collapses whitespace runs so a snippet carries words, not layout', () => {
    const snip = makeSnippet('one\n\n   two needle three', 12, 6, 40);
    expect(snip.snippet).toBe('one two needle three');
    expect(snip.snippet.slice(snip.matchStart, snip.matchStart + snip.matchLength)).toBe('needle');
  });
});

describe('searchMessages (pure)', () => {
  it('matches user prompts and assistant prose, naming the message by uuid', () => {
    const messages = [
      msg({ uuid: 'u1', role: 'user', content: [{ type: 'text', text: 'fix the pty spawn' }] }),
      msg({
        uuid: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'the spawn helper is patched' }],
      }),
    ];
    const { hits } = searchMessages(messages, 'spawn');
    expect(hits.map(h => [h.messageUuid, h.role])).toEqual([
      ['u1', 'user'],
      ['a1', 'assistant'],
    ]);
  });

  it('never searches tool input or tool output', () => {
    // A Read result is a whole file: including it would turn every search into a
    // grep over the user's source tree, attributed to the conversation.
    const messages = [
      msg({
        uuid: 'a1',
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/secret/spawn.ts' } },
        ],
      }),
      msg({
        uuid: 'u1',
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 't1', content: 'spawn spawn', isError: false }],
      }),
    ];
    expect(searchMessages(messages, 'spawn').hits).toEqual([]);
  });

  it('leaves thinking blocks out unless they are asked for', () => {
    const messages = [
      msg({
        uuid: 'a1',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'maybe the spawn path' }],
      }),
    ];
    expect(searchMessages(messages, 'spawn').hits).toEqual([]);
    const opted = searchMessages(messages, 'spawn', { includeThinking: true });
    expect(opted.hits).toHaveLength(1);
    expect(opted.hits[0].kind).toBe('thinking');
  });

  it('counts every match even when it only keeps a few', () => {
    const messages = [
      msg({ uuid: 'u1', content: [{ type: 'text', text: 'spawn spawn spawn spawn spawn' }] }),
    ];
    const { hits, total } = searchMessages(messages, 'spawn', { maxHits: 2 });
    expect(hits).toHaveLength(2);
    expect(total).toBe(5);
  });
});

describe('normalizeQuery', () => {
  it('refuses a query shorter than the floor', () => {
    expect(() => normalizeQuery('a')).toThrow(/at least/);
    expect(() => normalizeQuery('   ')).toThrow(/at least/);
  });

  it('refuses a pasted essay', () => {
    expect(() => normalizeQuery('x'.repeat(MAX_QUERY_LENGTH + 1))).toThrow(/limited to/);
  });

  it('trims what it accepts', () => {
    expect(normalizeQuery('  spawn  ')).toBe('spawn');
  });
});

describe('searchSessions (over real files)', () => {
  it('finds a match and names the session by its transcript id', async () => {
    transcript('-Users-me-alpha', 'aaaaaaaa-1111', [userLine('u1', 'fix the pty spawn helper')]);

    const out = await searchSessions(projectsDir, { text: 'pty spawn' });

    expect(out.results).toHaveLength(1);
    expect(out.results[0].sessionId).toBe('aaaaaaaa-1111');
    expect(out.results[0].projectHash).toBe('-Users-me-alpha');
    expect(out.results[0].hits[0].snippet).toContain('pty spawn');
  });

  it('reads BOTH native layouts, so a `sessions/` project is not invisible', async () => {
    transcript('-Users-me-alpha', 'flat', [userLine('u1', 'the spawn helper')]);
    transcript('-Users-me-beta', 'nested', [userLine('u2', 'another spawn helper')], true);

    const out = await searchSessions(projectsDir, { text: 'spawn helper' });

    expect(out.results.map(r => r.sessionId).sort()).toEqual(['flat', 'nested']);
  });

  it('rejects a non-matching transcript without parsing it', async () => {
    transcript('-Users-me-alpha', 'hit', [userLine('u1', 'the spawn helper')]);
    transcript('-Users-me-beta', 'miss', [userLine('u2', 'something else entirely')]);

    const out = await searchSessions(projectsDir, { text: 'spawn helper' });

    expect(out.scanned).toBe(2);
    expect(out.parsed).toBe(1);
    expect(searchStats().rejected).toBe(1);
    expect(out.prefiltered).toBe(true);
  });

  it('parses everything when the query has no run safe to reject on', async () => {
    transcript('-Users-me-alpha', 'hit', [userLine('u1', 'però funziona')]);
    transcript('-Users-me-beta', 'miss', [userLine('u2', 'unrelated')]);

    const out = await searchSessions(projectsDir, { text: 'ò f' });

    // No usable run, so the reject is off: slower, but it cannot hide a match.
    expect(out.prefiltered).toBe(false);
    expect(out.parsed).toBe(2);
    expect(out.results.map(r => r.sessionId)).toEqual(['hit']);
  });

  it('finds a phrase that is JSON-escaped on disk', async () => {
    // The prompt contains a quote, so the raw bytes hold `say \"go\"` — the
    // reject has to fall back to a run that IS written verbatim.
    transcript('-Users-me-alpha', 'quoted', [userLine('u1', 'they say "go faster" often')]);

    const out = await searchSessions(projectsDir, { text: 'say "go faster"' });

    expect(out.results).toHaveLength(1);
    expect(out.results[0].hits[0].snippet).toContain('say "go faster"');
  });

  it('restricts to one project when asked', async () => {
    transcript('-Users-me-alpha', 'a', [userLine('u1', 'the spawn helper')]);
    transcript('-Users-me-beta', 'b', [userLine('u2', 'the spawn helper')]);

    const out = await searchSessions(projectsDir, {
      text: 'spawn helper',
      projectHash: '-Users-me-beta',
    });

    expect(out.results.map(r => r.projectHash)).toEqual(['-Users-me-beta']);
    expect(out.scanned).toBe(1);
  });

  it('skips sidechain lines, the same rule the transcript view applies', async () => {
    transcript('-Users-me-alpha', 'a', [
      userLine('u1', 'a sub-agent said spawn helper', { isSidechain: true }),
    ]);

    expect((await searchSessions(projectsDir, { text: 'spawn helper' })).results).toEqual([]);
  });

  it('reads the session title from the transcript, both records', async () => {
    transcript('-Users-me-alpha', 'a', [
      JSON.stringify({ type: 'ai-title', aiTitle: 'Generated name' }),
      JSON.stringify({ type: 'custom-title', customTitle: 'The name I typed' }),
      userLine('u1', 'the spawn helper'),
    ]);

    const out = await searchSessions(projectsDir, { text: 'spawn helper' });
    expect(out.results[0].sessionTitle).toBe('The name I typed');
  });

  it('names the project only when a resolver can, never from the folder name', async () => {
    transcript('-Users-me-alpha', 'a', [userLine('u1', 'the spawn helper')]);

    const named = await searchSessions(projectsDir, { text: 'spawn helper' }, () => '/Users/me/α');
    expect(named.results[0].projectPath).toBe('/Users/me/α');

    const unnamed = await searchSessions(projectsDir, { text: 'spawn helper' }, () => undefined);
    expect(unnamed.results[0].projectPath).toBeUndefined();
  });

  it('orders sessions newest first and marks the cut when a cap stops the scan', async () => {
    const older = transcript('-Users-me-alpha', 'older', [userLine('u1', 'the spawn helper')]);
    const newer = transcript('-Users-me-alpha', 'newer', [userLine('u2', 'the spawn helper')]);
    // Make the ordering explicit rather than trusting write order.
    const { utimesSync, statSync } = await import('fs');
    const base = statSync(older).mtimeMs / 1000;
    utimesSync(older, base, base);
    utimesSync(newer, base + 60, base + 60);

    const capped = await searchSessions(projectsDir, {
      text: 'spawn helper',
      maxSessions: 1,
    });

    expect(capped.results.map(r => r.sessionId)).toEqual(['newer']);
    expect(capped.truncated).toBe(true);
  });

  it('keeps searching when one transcript cannot be read', async () => {
    transcript('-Users-me-alpha', 'good', [userLine('u1', 'the spawn helper')]);
    // A directory where a `.jsonl` is expected: `readFile` fails on it.
    mkdirSync(join(projectsDir, '-Users-me-beta', 'broken.jsonl'), { recursive: true });

    const out = await searchSessions(projectsDir, { text: 'spawn helper' });

    expect(out.results.map(r => r.sessionId)).toEqual(['good']);
  });

  it('matches across a multi-block assistant message', async () => {
    transcript('-Users-me-alpha', 'a', [
      assistantLine('a1', [
        { type: 'text', text: 'first I looked at the watcher' },
        { type: 'text', text: 'then I fixed the spawn helper' },
      ]),
    ]);

    const out = await searchSessions(projectsDir, { text: 'spawn helper' });
    expect(out.results[0].hits).toHaveLength(1);
    expect(out.results[0].hits[0].role).toBe('assistant');
  });

  it('refuses a query the scan will not run', async () => {
    await expect(searchSessions(projectsDir, { text: 'a' })).rejects.toThrow(/at least/);
  });
});
