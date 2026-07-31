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
 * - malformed YAML / load throws -> { frontmatter: {}, body }
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
    // Malformed frontmatter: fall through to the empty result, keeping the body.
  }

  return { frontmatter: {}, body };
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
