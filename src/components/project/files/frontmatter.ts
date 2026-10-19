import { load } from 'js-yaml';

/** One field of a document's frontmatter, as the Files page shows it. */
export type DocProperty = {
  /** The leaf key, or the dotted path when two leaves share a name. */
  key: string;
  value: string | string[];
  kind: 'text' | 'list' | 'date';
};

export type DocFrontmatter = {
  /** `description`, said as the document's lead rather than as a field. */
  lead?: string;
  properties: DocProperty[];
  /** The block as written, when it is not YAML that reads as a mapping. */
  raw?: string;
};

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * The frontmatter of a markdown file, made readable: `description` becomes the
 * lead, `name` goes when it only repeats the file's name, nested maps (a memory
 * topic's `metadata:`) flatten to their leaves, dates read as dates. Null when
 * the file has no frontmatter. `Markdown` already leaves the block out of the
 * page (remark-frontmatter), so this is the only place it is said.
 */
export function readFrontmatter(text: string, fileStem: string): DocFrontmatter | null {
  const match = text.match(FENCE);
  if (!match) return null;
  let data: unknown;
  try {
    data = load(match[1]);
  } catch {
    data = undefined;
  }
  if (data === null || data === undefined) {
    return match[1].trim() ? { properties: [], raw: match[1] } : null;
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    return { properties: [], raw: match[1] };
  }
  const leaves: Array<{ path: string[]; value: unknown }> = [];
  const walk = (obj: Record<string, unknown>, path: string[]) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        walk(v as Record<string, unknown>, [...path, k]);
      } else leaves.push({ path: [...path, k], value: v });
    }
  };
  walk(data as Record<string, unknown>, []);

  const out: DocFrontmatter = { properties: [] };
  const leafCount = new Map<string, number>();
  for (const l of leaves) {
    const leaf = l.path[l.path.length - 1];
    leafCount.set(leaf, (leafCount.get(leaf) ?? 0) + 1);
  }
  for (const { path, value } of leaves) {
    const leaf = path[path.length - 1];
    const top = path.length === 1;
    if (top && leaf === 'description' && typeof value === 'string' && value.trim()) {
      out.lead = value.trim();
      continue;
    }
    if (top && leaf === 'name' && String(value) === fileStem) continue;
    const key = leafCount.get(leaf)! > 1 ? path.join('.') : leaf;
    out.properties.push({ key, ...propertyValue(value) });
  }
  return out;
}

function propertyValue(value: unknown): Pick<DocProperty, 'value' | 'kind'> {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { value: formatDate(value), kind: 'date' };
  }
  if (Array.isArray(value)) {
    return { value: value.map(v => scalar(v)), kind: 'list' };
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}|$)/.test(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return { value: formatDate(d), kind: 'date' };
  }
  return { value: scalar(value), kind: 'text' };
}

function scalar(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (v instanceof Date) return formatDate(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function formatDate(d: Date): string {
  // A date-only value (`2026-10-19`) parses to midnight UTC: no time to state.
  const dateOnly = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  return dateOnly
    ? d.toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })
    : d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
