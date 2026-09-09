#!/usr/bin/env node
// What Claude Code writes into a transcript that ClaudeLens does not read.
//
//   node scripts/transcript-census.mjs              # report; exit 1 on drift
//   node scripts/transcript-census.mjs --json       # the same as JSON
//   node scripts/transcript-census.mjs --update-baseline
//   node scripts/transcript-census.mjs --root <dir> # census a different corpus
//
// Two questions, two mechanisms. This script answers the first — *which shapes
// exist on disk that no module consumes* — by streaming every
// `~/.claude/projects/**/*.jsonl` and diffing what it finds against the
// decisions in `transcript-manifest.mjs`. The second question, *which shapes we
// read but read wrong*, is a census a script cannot do: it needs the parsers
// run against real rows, which is `test/transcript-drift.test.ts`.
//
// The point of the baseline is that a second run over an unchanged corpus
// reports nothing. Without it every run re-lists the same twenty-odd known-but-
// unread shapes and the tool dies of its own noise. So: the manifest records
// what we decided, the baseline records what we had already seen, and drift is
// what neither accounts for.
//
// Nothing but a discriminant value is ever recorded. The corpus is the user's
// real work, and the baseline gets committed.

import { createReadStream, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { AXES, FIELD_AXIS, ROW_TYPES } from './transcript-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(__dirname, 'transcript-baseline.json');
const DEFAULT_ROOT = join(homedir(), '.claude', 'projects');

// Key-paths are a fifth axis with no manifest table: enumerating every field of
// every row type by hand would be a second copy of the format, and it would be
// wrong within a week. The baseline alone carries them, so the claim is only
// "this field is new", never "this field is unread".
//
// Which rows get walked matters more than it looks. Collecting fields for the
// three chat rows only leaves a hole exactly where the interest is: a row type
// already triaged as `candidate` is not drift (it has an entry) and its fields
// were never collected (nothing is a new path), so a field added to it fires
// nothing at all. Those are the rows we intend to read *eventually*, which
// makes their field shape the thing we most want to be told about — so every
// `read` and `candidate` row is walked, and only the `ignored` ones are not.
const KEY_PATH_ROWS = new Set(
  Object.entries(ROW_TYPES)
    .filter(([, v]) => v.verdict !== 'ignored')
    .map(([k]) => k)
);
const KEY_PATH_DEPTH = 3;

// Project dirs written by `transcript-exercise.mjs`. Its sandboxes live under
// the system temp dir, so their hashed names all carry this marker. They are
// synthetic by construction and must not be mistaken for real usage: a scenario
// run once would otherwise enter the baseline and make a shape look like
// something Claude Code writes in practice. `--root` at one of them explicitly
// is still honoured — that is how the exercise script censuses its own output.
const EXERCISE_MARKER = 'cl-exercise-';

// Claude Code writes a second file class next to the sub-agent transcripts:
// `subagents/agent-*.meta.json`, one flat object per sub-agent run. A census of
// `.jsonl` alone cannot see it, which is a blind spot the first unattended run
// found by hand rather than by instrument — `agentType` sits in all 35 of them,
// naming the sub-agent's readable type, while `subagents-reader` reconstructs
// that same fact indirectly and its header comment still says it is not
// available. Exactly the kind of thing this tool exists to notice, so the
// walker takes both and the rows are folded in under a synthetic `agent-meta`
// row type.
const META_SUFFIX = '.meta.json';
// Not a `type` Claude Code writes — these files have no `type` field at all —
// so the name is ours, and the manifest triages it like any other row.
const META_ROW_TYPE = 'agent-meta';

/** Every transcript and sub-agent meta file under `root`, recursively,
 *  skipping exercise sandboxes. */
async function findTranscripts(root, includeExercise) {
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir: a census reports what it can reach
    }
    for (const e of entries) {
      if (!includeExercise && e.isDirectory() && e.name.includes(EXERCISE_MARKER)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (!e.isFile()) continue;
      else if (e.name.endsWith('.jsonl') || e.name.endsWith(META_SUFFIX)) found.push(full);
    }
  }
  await walk(root);
  return found.sort();
}

// A schema key is a plain identifier. Anything else is *data* used as a key,
// and recording it would put the value into the baseline through the back door.
//
// This is not hypothetical: `file-history-snapshot` keys `trackedFileBackups`
// by absolute file path, and the first run with the widened row coverage
// produced key-paths like `…trackedFileBackups.Fisco/CLAUDE.md` — the user's
// private project layout, on its way into a committed file. `cost-state` keys
// `modelUsage` by model id, which is the same shape with harmless contents.
//
// Failing this test collapses the key, which costs a little coverage; passing
// it when it should not would leak. The asymmetry is deliberate — a schema key
// that happens to be quoted and hyphenated is simply covered less precisely.
const SCHEMA_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MAP_KEY = '{*}';

/**
 * Key-paths of `obj`, dotted, arrays collapsed to `[]`, data-keyed maps
 * collapsed to `{*}`, stopping at `depth`.
 *
 * Values never leave this function — only the shape of the object does. The one
 * way a value could escape is as a key, which is what SCHEMA_KEY guards.
 */
function keyPaths(obj, prefix, depth, out) {
  if (depth === 0 || !obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    // One representative element is enough: a heterogeneous array's variants
    // show up across the corpus anyway, and walking all of them on a 261 MB
    // corpus is time spent re-deriving the same paths.
    if (obj.length) keyPaths(obj[0], `${prefix}[]`, depth - 1, out);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    // Every entry of a data-keyed map folds onto one path, so the *schema*
    // under it is still covered — `cost-state.modelUsage.{*}.costUSD` is a
    // claim worth having, `…modelUsage.claude-opus-5.costUSD` is not.
    const path = `${prefix}.${SCHEMA_KEY.test(k) ? k : MAP_KEY}`;
    out.add(path);
    keyPaths(v, path, depth - 1, out);
  }
}

/** Counts per axis value, plus the key-path set. Values are discriminants only. */
function emptyCensus() {
  const counts = {};
  for (const axis of AXES) counts[axis.key] = new Map();
  return { counts, keyPaths: new Set(), rows: 0, files: 0, unparsable: 0 };
}

function bump(map, value) {
  map.set(value, (map.get(value) ?? 0) + 1);
}

/** Fold one parsed row into the census. */
function observe(census, json) {
  const rowType = typeof json.type === 'string' ? json.type : `«${typeof json.type}»`;
  bump(census.counts.rowType, rowType);

  if (rowType === 'attachment') {
    const at = json.attachment?.type;
    if (typeof at === 'string') bump(census.counts.attachmentType, at);
  }

  if (rowType === 'system' && typeof json.subtype === 'string') {
    bump(census.counts.systemSubtype, json.subtype);
  }

  if (rowType === 'user' || rowType === 'assistant') {
    const content = json.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === 'object' && typeof block.type === 'string') {
          bump(census.counts.contentBlock, block.type);
        }
      }
    }
  }

  if (KEY_PATH_ROWS.has(rowType)) {
    keyPaths(json, rowType, KEY_PATH_DEPTH, census.keyPaths);
  }
}

/** Stream every transcript under `root` into one census. */
export async function runCensus(root, includeExercise = false) {
  const files = await findTranscripts(root, includeExercise);
  const census = emptyCensus();
  census.files = files.length;

  for (const file of files) {
    // A `.meta.json` is one whole-file object, not a stream of rows: read it as
    // such and give it the synthetic row type the manifest triages it under.
    if (file.endsWith(META_SUFFIX)) {
      let json;
      try {
        json = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        census.unparsable++;
        continue;
      }
      if (!json || typeof json !== 'object') continue;
      census.rows++;
      observe(census, { ...json, type: META_ROW_TYPE });
      continue;
    }

    const rl = createInterface({
      input: createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let json;
      try {
        json = JSON.parse(line);
      } catch {
        census.unparsable++;
        continue;
      }
      if (!json || typeof json !== 'object') continue;
      census.rows++;
      observe(census, json);
    }
  }
  return census;
}

/** The committed baseline, or an empty one on first run. */
function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { axes: {}, keyPaths: [] };
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

/** Baseline shape: sorted names only. No counts — they change every run and
 *  would make every diff dirty — and no values beyond the discriminants. */
function toBaseline(census) {
  const axes = {};
  for (const axis of AXES) axes[axis.key] = [...census.counts[axis.key].keys()].sort();
  return { axes, keyPaths: [...census.keyPaths].sort() };
}

/**
 * What neither the manifest nor the baseline accounts for.
 *
 * `drift`     — seen on disk, no manifest entry and not in the baseline. New.
 * `known`     — a manifest entry that is not `read`: the standing backlog.
 * `stale`     — in the manifest but absent from the corpus: either removed
 *               upstream or never present here. Reported, never fatal.
 * `newPaths`  — key-paths absent from the baseline.
 */
export function diffCensus(census, baseline) {
  const drift = [];
  const known = [];
  const stale = [];

  for (const axis of AXES) {
    const seen = census.counts[axis.key];
    const wasSeen = new Set(baseline.axes?.[axis.key] ?? []);

    for (const [value, count] of [...seen].sort((a, b) => b[1] - a[1])) {
      const entry = axis.table[value];
      if (!entry) {
        if (!wasSeen.has(value)) drift.push({ axis: axis.key, label: axis.label, value, count });
        continue;
      }
      if (entry.verdict !== 'read') {
        known.push({
          axis: axis.key,
          label: axis.label,
          value,
          count,
          verdict: entry.verdict,
          note: entry.note ?? entry.reason,
        });
      }
    }

    for (const value of Object.keys(axis.table)) {
      if (!seen.has(value)) stale.push({ axis: axis.key, label: axis.label, value });
    }
  }

  // Fields are diffed against the baseline, not against a table, so a field
  // nobody has looked at is reported once and then stays quiet. `FIELDS` only
  // decides which of them keep a place in the backlog.
  const wasPath = new Set(baseline.keyPaths ?? []);
  const newPaths = [...census.keyPaths].filter(p => !wasPath.has(p)).sort();
  for (const path of [...census.keyPaths].sort()) {
    const entry = FIELD_AXIS.table[path];
    if (entry && entry.verdict !== 'read') {
      known.push({
        axis: FIELD_AXIS.key,
        label: FIELD_AXIS.label,
        value: path,
        count: null,
        verdict: entry.verdict,
        note: entry.note ?? entry.reason,
      });
    }
  }
  for (const path of Object.keys(FIELD_AXIS.table)) {
    if (!census.keyPaths.has(path)) {
      stale.push({ axis: FIELD_AXIS.key, label: FIELD_AXIS.label, value: path });
    }
  }

  return { drift, known, stale, newPaths };
}

function formatReport(census, diff) {
  const out = [];
  const n = census.rows.toLocaleString('en-US');
  out.push(
    `Transcript census — ${census.files} files, ${n} rows` +
      (census.unparsable ? `, ${census.unparsable} unparsable` : '')
  );

  if (diff.drift.length === 0 && diff.newPaths.length === 0) {
    out.push(
      '\nNo drift: every shape on disk has a manifest entry or was already in the baseline.'
    );
  } else {
    out.push(
      `\n## Drift — ${diff.drift.length} unknown shapes, ${diff.newPaths.length} new fields`
    );
    out.push('Claude Code writes these and the manifest says nothing about them.');
    for (const d of diff.drift)
      out.push(`  ${String(d.count).padStart(7)}  ${d.label}: ${d.value}`);
    for (const p of diff.newPaths) out.push(`  ${'—'.padStart(7)}  field: ${p}`);
    out.push(
      '\nTriage each one into scripts/transcript-manifest.mjs (read / ignored / candidate),'
    );
    out.push('then re-run with --update-baseline.');
    if (diff.newPaths.length) {
      // The asymmetry is easy to walk into: an un-triaged shape comes back
      // every run, so accepting early costs nothing, and the habit that builds
      // silently discards field findings. Say it where it will be read.
      out.push(
        '\nNOTE: the fields above are reported ONCE. Unlike shapes, they are diffed against\n' +
          'the baseline alone, so --update-baseline drops them for good — understood or not.\n' +
          'Look at them first, and give any that carry something a FIELDS entry to keep it\n' +
          'in the backlog.'
      );
    }
  }

  const candidates = diff.known.filter(k => k.verdict === 'candidate');
  if (candidates.length) {
    out.push(`\n## Known gaps — ${candidates.length} shapes triaged as candidate`);
    out.push('Already decided, not yet read. This is the backlog, not new drift.');
    for (const k of candidates) {
      const count = k.count === null ? '—' : String(k.count);
      out.push(`  ${count.padStart(7)}  ${k.label}: ${k.value}`);
      out.push(`           ${k.note}`);
    }
  }

  if (diff.stale.length) {
    out.push(`\n## In the manifest, absent from this corpus — ${diff.stale.length}`);
    out.push('Either removed upstream, or simply never exercised here.');
    for (const s of diff.stale) out.push(`           ${s.label}: ${s.value}`);
  }

  return out.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const rootFlag = argv.indexOf('--root');
  const root = rootFlag >= 0 ? resolve(argv[rootFlag + 1]) : DEFAULT_ROOT;

  if (!existsSync(root)) {
    console.error(`No transcript corpus at ${root}`);
    process.exit(2);
  }

  // A `--root` pointed straight at a sandbox is a deliberate look at it, so
  // the skip only applies while walking the whole corpus.
  const census = await runCensus(root, root.includes(EXERCISE_MARKER));

  if (argv.includes('--update-baseline')) {
    const baseline = toBaseline(census);
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
    const total = Object.values(baseline.axes).reduce((a, v) => a + v.length, 0);
    console.log(
      `Baseline updated: ${total} shapes, ${baseline.keyPaths.length} fields, from ${census.files} files.`
    );
    return;
  }

  const diff = diffCensus(census, loadBaseline());

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ files: census.files, rows: census.rows, ...diff }, null, 2));
  } else {
    console.log(formatReport(census, diff));
  }

  process.exit(diff.drift.length || diff.newPaths.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(err);
    process.exit(2);
  });
}
