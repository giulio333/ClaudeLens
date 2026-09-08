// js-yaml 5 dropped the default export — it ships named exports only, so a
// default import resolves to undefined under ESM (vitest) and throws on first use.
import { load, dump } from 'js-yaml';

/**
 * Parse the leading YAML frontmatter block (`^---\n ... \n---\n?`) from a
 * markdown document. Returns the parsed frontmatter as a plain record plus the
 * remaining body. Mirrors the `js-yaml` import pattern already proven to work
 * under `tsconfig.electron.json` (CommonJS) in `rules-reader.ts`.
 *
 * Robust by design:
 * - no frontmatter block        -> { frontmatter: {}, body: content }
 * - malformed YAML / load throws -> line-by-line recovery, see `recoverFields`
 * - YAML parses to a non-object  -> { frontmatter: {}, body }
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  // Normalize CRLF once: a file authored with a CRLF editor (common on Windows,
  // a supported platform) would otherwise miss the `---\n` fence match and lose
  // ALL frontmatter — agents/skills show no name/description, memory topics lose
  // their type, rule files lose their `paths` — with the YAML leaking into body.
  content = content.replace(/\r\n/g, '\n');
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const body = match[2];

  try {
    const parsed = load(match[1]);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { frontmatter: parsed as Record<string, unknown>, body };
    }
  } catch {
    // Malformed frontmatter: recover what the block still says instead of
    // dropping every field because of one bad line.
    return { frontmatter: recoverFields(match[1]), body };
  }

  return { frontmatter: {}, body };
}

/**
 * A YAML indicator in first position means the value opens a flow collection, a
 * block scalar, an anchor/alias or a directive — something whose meaning spans
 * more than the line it starts on. Those we cannot recover by hand, so a value
 * starting with one is dropped rather than kept as prose.
 */
const YAML_INDICATOR = /^[[{|>&*!%@`]/;

/**
 * Last-resort reader for a frontmatter block js-yaml refused to load. Skill and
 * agent files are hand-written, and the single most common mistake is a `: `
 * inside an unquoted description ("Serve anche per chiamare un'istanza: fa
 * login da sé") — YAML reads that as a nested mapping and throws, which used to
 * cost the file its name, description and every other field. Here each
 * top-level `key: value` line is read on its own, so one bad line loses only
 * itself. Claude Code shows those descriptions; ClaudeLens showing an empty
 * one was our parse being stricter than the tool whose data we display.
 *
 * Values are still handed to js-yaml one line at a time, so `true`, `7`,
 * `[a, b]` and quoted strings keep their type; only a line that fails on its
 * own falls back to its raw text. Block lists (`- item` under a bare key) are
 * collected; anything else indented is skipped.
 */
function recoverFields(block: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  let listKey: string | null = null;

  for (const line of block.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) {
      const value = scalar(item[1].trim());
      if (value !== undefined) (fields[listKey] as unknown[]).push(value);
      continue;
    }

    const field = line.match(/^([\w.-]+):\s*(.*)$/);
    if (!field) continue;
    const [, key, raw] = field;

    if (!raw.trim()) {
      // A bare key opens a block list; an empty value is nothing to record.
      fields[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;

    const value = scalar(raw.trim());
    if (value !== undefined) fields[key] = value;
  }

  // A bare key that no `- item` followed was not a list after all.
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value) && value.length === 0) delete fields[key];
  }
  return fields;
}

/** Read one line's value as YAML, falling back to its raw text as a string. */
function scalar(raw: string): unknown {
  try {
    const value = load(raw);
    if (value === null) return undefined;
    // A value that reads back as a mapping is the colon-space case itself:
    // `Serve a questo: leggere` is valid YAML on its own line, just not the
    // mapping the author meant. Only `{a: 1}` really asked to be one.
    if (typeof value === 'object' && !Array.isArray(value) && !raw.startsWith('{')) return raw;
    return value;
  } catch {
    return YAML_INDICATOR.test(raw) ? undefined : raw;
  }
}

/**
 * Serialize a scalar value to a YAML-safe inline representation for *writing* a
 * frontmatter block. A value containing `: ` (a colon-space), a leading `#`, or
 * one that looks like a number/bool is quoted so it round-trips back through
 * `parseFrontmatter`. Without this, an unquoted `: ` makes js-yaml throw on
 * load, which drops the ENTIRE frontmatter block (name, description, model, …) —
 * the agent/skill/topic then reads back with all metadata lost. The quoting
 * rules are delegated to js-yaml's own dumper so they stay correct and complete.
 */
export function yamlScalar(value: string | number | boolean): string {
  // `dump` appends a trailing newline; a scalar always fits on one line, so we
  // strip it. `lineWidth: -1` disables line folding, keeping a long description
  // on a single line instead of wrapping it into a block scalar.
  return dump(value, { lineWidth: -1 }).replace(/\n$/, '');
}

/** Read a scalar string value. Numbers/booleans are coerced to their string form. */
export function getString(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

/**
 * Read a boolean value. Accepts a real YAML boolean or a truthy string.
 *
 * The string forms are load-bearing: js-yaml 5 defaults to the YAML 1.2 core
 * schema, where only `true`/`false` are booleans — `yes`/`on` now arrive as
 * plain strings. Frontmatter is hand-written (`background: yes` in an agent
 * file), so treating those as true keeps the author's intent instead of
 * silently flipping the flag off.
 */
export function getBoolean(rec: Record<string, unknown>, key: string): boolean | undefined {
  const v = rec[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === 'on';
  }
  return undefined;
}

/**
 * Read a string array. Accepts a real YAML sequence (e.g. `key: [a, b]` or a
 * block list) and, as a fallback, a single comma-separated string. Entries are
 * trimmed and empties dropped. Returns undefined only when the key is absent
 * (or holds a value that yields no usable entries).
 */
export function getStringArray(rec: Record<string, unknown>, key: string): string[] | undefined {
  const v = rec[key];
  if (Array.isArray(v)) {
    return v.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof v === 'string') {
    return v
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

/** Read a numeric value. Accepts a real YAML number or a leading-numeric string. */
export function getNumber(rec: Record<string, unknown>, key: string): number | undefined {
  const v = rec[key];
  if (typeof v === 'number') return Number.isNaN(v) ? undefined : v;
  if (typeof v === 'string') {
    const n = parseInt(v.trim(), 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}
