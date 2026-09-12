// The other half of the drift watch: what we read *wrong*.
//
// `scripts/transcript-census.mjs` answers "which shapes does Claude Code write
// that no module consumes" by looking at the file. It cannot answer "which
// shapes do we consume and get wrong", because that needs the parsers actually
// run — a field can be present, recognised, and still dropped on the floor.
// #245 and #246 were exactly that: rows the reader saw and discarded.
//
// So this file replays rows through the real reader and asserts on what comes
// out. Two claims, deliberately separated:
//
//   1. Fixtures — every block type the census has seen in the corpus is fed to
//      `readChatSession`, and the test pins which ones survive. Deterministic,
//      no corpus needed, runs in CI. This is the regression gate: making
//      `parseContentArray` handle `image` has to come here and change the
//      expectation, and a *silent* change in either direction fails.
//
//   2. Corpus sweep — when a real `~/.claude/projects` exists, every transcript
//      is replayed and any block the reader drops is checked against the
//      manifest. A drop the manifest has triaged is the known backlog and
//      passes; an untriaged one fails, because that is a shape Claude Code
//      started writing while nobody was looking. Skipped where there is no
//      corpus, so CI stays green without one.
import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { readChatSession } from '../electron/modules/session-reader';
import { CONTENT_BLOCKS, unknown } from '../scripts/transcript-manifest.mjs';
import { runCensus, diffCensus } from '../scripts/transcript-census.mjs';

/** Every block type the census has observed, with a minimal well-formed body.
 *  Adding an entry here is how a newly-observed block type gets a claim. */
const OBSERVED_BLOCKS: Record<string, Record<string, unknown>> = {
  text: { type: 'text', text: 'prose' },
  thinking: { type: 'thinking', thinking: 'reasoning' },
  tool_use: { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/x' } },
  tool_result: { type: 'tool_result', tool_use_id: 'tu1', content: 'ok' },
  image: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBOR' } },
  server_tool_use: { type: 'server_tool_use', id: 'st1', name: 'web_search', input: { q: 'x' } },
  advisor_tool_result: { type: 'advisor_tool_result', content: 'advice' },
  redacted_thinking: { type: 'redacted_thinking', data: 'encrypted' },
};

/** The block types `parseContentArray` is built to keep. Everything else in
 *  OBSERVED_BLOCKS is dropped, and the manifest has to say so. */
const PARSED_BLOCKS = ['text', 'thinking', 'tool_use', 'tool_result', 'advisor_tool_result'];

/** What a kept block comes out as — usually itself. The exception is the one
 *  that proves the watch works: `advisor_tool_result` was triaged a candidate
 *  ("dropped like server_tool_use") and has since been picked up, and the
 *  reader folds it together with its `server_tool_use` into a single `advisor`
 *  block, so the name on the way out is not the name on the way in. */
const KEPT_AS: Record<string, string> = { advisor_tool_result: 'advisor' };
const keptAs = (type: string): string => KEPT_AS[type] ?? type;

let dir: string;

function writeTranscript(name: string, rows: unknown[]): string {
  const path = join(dir, name);
  writeFileSync(path, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return path;
}

/** An assistant row carrying exactly the given content blocks. */
function assistantRow(blocks: unknown[], uuid = 'a1'): unknown {
  return {
    type: 'assistant',
    uuid,
    timestamp: '2026-09-08T10:00:00.000Z',
    parentUuid: null,
    isSidechain: false,
    message: { role: 'assistant', model: 'claude-opus-5', content: blocks },
  };
}

beforeEach(() => {
  // Per-test dir: the suite runs in a random order, so a fixture written by
  // whichever test happens to run first is not a fixture the others can use.
  dir = mkdtempSync(join(tmpdir(), 'cl-drift-'));
});

describe('content blocks the reader keeps', () => {
  it.each(PARSED_BLOCKS)('keeps a %s block', type => {
    const path = writeTranscript('s.jsonl', [assistantRow([OBSERVED_BLOCKS[type]])]);
    const kept = readChatSession(path).flatMap(m => m.content.map(b => b.type));
    expect(kept).toContain(keptAs(type));
  });

  it('keeps every parsed block in one message, in order', () => {
    const blocks = PARSED_BLOCKS.filter(t => t !== 'tool_result').map(t => OBSERVED_BLOCKS[t]);
    const path = writeTranscript('s.jsonl', [assistantRow(blocks)]);
    const [msg] = readChatSession(path);
    // `advisor` in place of the `advisor_tool_result` that went in, and in that
    // row's position: the fold renames the block, it does not move it.
    expect(msg.content.map(b => b.type)).toEqual(['text', 'thinking', 'tool_use', 'advisor']);
  });
});

describe('content blocks the reader drops', () => {
  const dropped = Object.keys(OBSERVED_BLOCKS).filter(t => !PARSED_BLOCKS.includes(t));

  it.each(dropped)('drops a %s block, and the manifest says so', type => {
    // A dropped block that is alone in its message takes the whole message with
    // it (`blocks.length === 0` → skip), which is the failure users report as
    // "a turn is missing". Pairing it with text isolates the block itself.
    const path = writeTranscript('s.jsonl', [
      assistantRow([OBSERVED_BLOCKS.text, OBSERVED_BLOCKS[type]]),
    ]);
    const [msg] = readChatSession(path);
    expect(msg.content.map(b => b.type)).toEqual(['text']);

    // The drop has to be a recorded decision, not an accident. If this fails,
    // either triage the block in scripts/transcript-manifest.mjs or teach
    // parseContentArray to keep it and move it to PARSED_BLOCKS.
    const entry = (CONTENT_BLOCKS as Record<string, { verdict: string } | undefined>)[type];
    expect(entry, `${type} is dropped but has no manifest entry`).toBeDefined();
    expect(entry!.verdict).not.toBe('read');
  });

  it('loses the whole message when the dropped block is its only content', () => {
    const path = writeTranscript('s.jsonl', [assistantRow([OBSERVED_BLOCKS.image])]);
    // Pinned as the current behaviour, not endorsed: this is why `image` is a
    // candidate in the manifest — 57 rows in the observed corpus, each one a
    // turn the transcript shows nothing for.
    expect(readChatSession(path)).toEqual([]);
  });

  it('agrees with the manifest about which blocks are read', () => {
    const readByManifest = Object.entries(CONTENT_BLOCKS as Record<string, { verdict: string }>)
      .filter(([, v]) => v.verdict === 'read')
      .map(([k]) => k)
      .sort();
    expect(readByManifest).toEqual([...PARSED_BLOCKS].sort());
  });
});

// ── the census records shapes, never content ────────────────────────────────

describe('the census leaks no transcript content into the baseline', () => {
  // The baseline is committed, and the corpus it is derived from is the user's
  // real work. Axis values are discriminants and safe by construction, but a
  // *key* can be data: `file-history-snapshot` keys `trackedFileBackups` by
  // absolute file path, `cost-state` keys `modelUsage` by model id, and
  // `toolUseResult.answers` keys by the full text of the question that was
  // asked. The first version of the walker recorded all three verbatim, and an
  // early baseline went into a commit carrying ninety-odd question texts,
  // internal hostnames included. So this is not a hypothetical to guard
  // against — it is a regression test.
  it('collapses data-keyed maps instead of recording their keys', async () => {
    writeTranscript('s.jsonl', [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-09-08T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'q' }] },
        toolUseResult: {
          answers: { 'Which host should I use, 10.1.2.3:9000?': 'the first one' },
          annotations: { 'Which host should I use, 10.1.2.3:9000?': { notes: 'n' } },
        },
      },
      {
        type: 'file-history-snapshot',
        uuid: 'f1',
        snapshot: {
          trackedFileBackups: { 'Fisco/CLAUDE.md': { x: 1 }, '/Users/someone/CV.html': { x: 2 } },
        },
      },
      {
        type: 'cost-state',
        uuid: 'c1',
        modelUsage: { 'claude-opus-5[1m]': { costUSD: 1 } },
      },
    ]);

    const { keyPaths } = await runCensus(dir, true);
    const paths = [...keyPaths];

    // Nothing that came out of a value may appear in a path.
    for (const secret of ['10.1.2.3', 'Fisco', 'CV.html', 'someone', 'claude-opus-5']) {
      expect(
        paths.filter(p => p.includes(secret)),
        `"${secret}" reached a key-path`
      ).toEqual([]);
    }

    // And the schema *under* each map is still covered — collapsing a map must
    // cost precision, not coverage.
    expect(paths).toContain('user.toolUseResult.answers.{*}');
    expect(paths).toContain('file-history-snapshot.snapshot.trackedFileBackups.{*}');
    expect(paths).toContain('cost-state.modelUsage.{*}.costUSD');
  });

  it('records the fields of a row type it is meant to read', async () => {
    // The complement of the claim above: the walker really does descend. A
    // guard that collapsed everything would pass the leak test and be useless.
    writeTranscript('s.jsonl', [
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-09-08T10:00:00.000Z',
        isApiErrorMessage: true,
        message: { role: 'assistant', content: [{ type: 'text', text: 'x' }], stop_reason: 'end' },
      },
    ]);

    const { keyPaths } = await runCensus(dir, true);
    expect([...keyPaths]).toContain('assistant.isApiErrorMessage');
    expect([...keyPaths]).toContain('assistant.message.stop_reason');
  });

  it('has a committed baseline that carries no content', () => {
    // The walker tests above guard the mechanism; this one guards the artifact,
    // which is what actually gets pushed. It also catches a baseline generated
    // by an older version of the walker and committed unnoticed.
    const baseline = JSON.parse(
      readFileSync(join(__dirname, '..', 'scripts', 'transcript-baseline.json'), 'utf8')
    ) as { keyPaths: string[]; axes: Record<string, string[]> };

    // A key-path segment is an identifier, `[]`, or the `{*}` map placeholder.
    // Prose, a path, or a URL in there means a value escaped.
    for (const path of baseline.keyPaths) {
      expect(path, `${path} does not look like a key-path`).toMatch(
        /^[A-Za-z_$][A-Za-z0-9_$-]*(\.(\{\*\}|[A-Za-z_$][A-Za-z0-9_$]*)(\[\])?)*$/
      );
    }
    // Axis values are discriminants — short, no whitespace.
    for (const [axis, values] of Object.entries(baseline.axes)) {
      for (const value of values) {
        expect(value, `${axis}: ${value}`).toMatch(/^[A-Za-z0-9_.\-/«»]{1,64}$/);
      }
    }
  });

  it('walks every row type the manifest does not ignore', async () => {
    // The coverage claim. A row triaged `candidate` is one we mean to read, so
    // a field appearing on it has to be reported — it is not drift (the row has
    // an entry) and it would be nothing at all if the row went unwalked.
    writeTranscript('s.jsonl', [
      { type: 'custom-title', uuid: 'c1', customTitle: 'x', brandNewField: 1 },
      { type: 'atis-latch', uuid: 'l1', shouldNotBeWalked: 1 },
    ]);

    const { keyPaths } = await runCensus(dir, true);
    expect([...keyPaths]).toContain('custom-title.brandNewField');
    // `atis-latch` is `ignored`: we decided it carries nothing, so its fields
    // are deliberately not collected.
    expect([...keyPaths]).not.toContain('atis-latch.shouldNotBeWalked');
  });
});

describe('a shape can be recorded as looked-at-but-undecided', () => {
  // The `unknown` verdict exists because the other three forced a choice
  // between guessing and letting a finding return identically forever — which
  // is what the first unattended run hit: four of five findings on a synthetic
  // corpus had nothing but a name and an opaque payload. These tests pin the
  // two properties that make the verdict worth having.
  const undecided = unknown('one row, payload said nothing');

  it('stops being reported as drift', async () => {
    writeTranscript('s.jsonl', [{ type: 'mystery-row', uuid: 'm1' }]);
    const census = await runCensus(dir, true);

    const asDrift = diffCensus(census, { axes: {}, keyPaths: [] });
    expect(asDrift.drift.map(d => d.value)).toContain('mystery-row');

    // With the verdict recorded, the same corpus yields no drift — someone
    // looked, so it is no longer news.
    const asTriaged = diffCensus(
      census,
      { axes: {}, keyPaths: [] },
      { rowType: { 'mystery-row': undecided } }
    );
    expect(asTriaged.drift.map(d => d.value)).not.toContain('mystery-row');
  });

  it('stays visible instead of being retired', async () => {
    writeTranscript('s.jsonl', [{ type: 'mystery-row', uuid: 'm1' }]);
    const census = await runCensus(dir, true);

    // The point of the verdict: not silence, a different section. An `ignored`
    // shape is settled and says nothing further; an `unknown` one is an open
    // question and has to keep saying so.
    const { known } = diffCensus(
      census,
      { axes: {}, keyPaths: [] },
      { rowType: { 'mystery-row': undecided } }
    );
    const entry = known.find(k => k.value === 'mystery-row');
    expect(entry?.verdict).toBe('unknown');
    expect(entry?.note).toBe(undecided.note);
  });
});

// ── the corpus sweep ────────────────────────────────────────────────────────

const CORPUS = join(homedir(), '.claude', 'projects');

// Opt-in, via `npm run census:replay`. Two reasons, and the second is the one
// that matters:
//
// It costs ~1.2s and grows with the corpus — but worse, it is a test whose
// outcome depends on state the test did not create. Left unconditional it runs
// on every developer machine that has a `~/.claude`, so someone working on an
// unrelated branch goes red because *their* transcripts happen to contain a
// block type Claude Code shipped last week. That is the same failure the
// randomised test order exists to catch, wearing different clothes: an `it`
// that is not an independent claim about the code.
//
// So `npm test` stays a claim about the code — the fixtures above, which are
// deterministic and are the actual regression gate — and the sweep stays a
// claim about the world, alongside `npm run census`, which is the other one.
const hasCorpus = existsSync(CORPUS) && process.env.CLAUDELENS_DRIFT_CORPUS === '1';

/** Every `.jsonl` under `root`, recursively. */
function transcripts(root: string, out: string[] = []): string[] {
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) transcripts(full, out);
    else if (name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

describe.skipIf(!hasCorpus)('replay over the real corpus', () => {
  it('drops no content block the manifest has not triaged', () => {
    const droppedTypes = new Map<string, number>();

    for (const file of transcripts(CORPUS)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (json.type !== 'user' && json.type !== 'assistant') continue;
        const content = (json.message as { content?: unknown } | undefined)?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          const type = (block as { type?: unknown })?.type;
          if (typeof type !== 'string' || PARSED_BLOCKS.includes(type)) continue;
          droppedTypes.set(type, (droppedTypes.get(type) ?? 0) + 1);
        }
      }
    }

    const untriaged = [...droppedTypes]
      .filter(([type]) => !(type in CONTENT_BLOCKS))
      .map(([type, count]) => `${type} (${count} blocks)`);

    // A triaged drop is the known backlog and passes. An untriaged one is a
    // shape Claude Code started writing since the last look, and it is silently
    // missing from every transcript view in the app.
    expect(untriaged, 'untriaged content blocks dropped by the reader').toEqual([]);
  });

  it('reads a real transcript without losing every message', () => {
    // A smoke claim over real data: an upstream format change that breaks the
    // reader outright shows up as an empty read, which no fixture would catch.
    const files = transcripts(CORPUS)
      .map(f => ({ f, size: statSync(f).size }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 5);
    if (files.length === 0) return;

    for (const { f } of files) {
      const messages = readChatSession(f);
      expect(messages.length, `${f} read as empty`).toBeGreaterThan(0);
      // Every message the reader returns must be renderable: a role, a
      // timestamp and at least one block. An empty-content message is what a
      // half-handled new block type produces.
      for (const m of messages) {
        expect(m.content.length, `${f}: message ${m.uuid} has no content`).toBeGreaterThan(0);
        expect(['user', 'assistant']).toContain(m.role);
      }
    }
  });
});
