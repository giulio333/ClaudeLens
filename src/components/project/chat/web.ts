import type { ToolGroup } from './utils';

/**
 * The two web tools' payloads, parsed — the shared model behind Mission
 * Control's WEB feed species and the tool detail panel's web rendering.
 *
 * Everything here follows what the transcripts actually carry (verified across
 * 75 real calls): a `WebFetch` input is always `{ url, prompt }` and a
 * `WebSearch` always `{ query }` plus an occasional `allowed_domains`. The
 * results are the interesting part, because **failure has four shapes and only
 * one of them sets `is_error`**:
 *
 *  - `is_error` — the fetch itself broke (network error, unreachable host).
 *  - a `The server returned HTTP <code> …` line — the request reached the server
 *    and came back refused (403) or empty (404). The tool says so in prose, with
 *    `is_error` unset, and hands back ~200 bytes of advice instead of a page.
 *    Verified on 7 of 73 real fetches (403 ×4, 404 ×3): read as a success, those
 *    rows claimed a page that was never retrieved.
 *  - a `REDIRECT DETECTED:` notice — a 3xx to a different host. The tool returns
 *    **no page content**: it hands back the redirect target and asks to be
 *    called again. Reading that as a success would claim the page was read when
 *    it was not, which is the kind of lie a feed must never tell.
 *  - `Web search error: …` inside an otherwise-fine WebSearch result (verified:
 *    "unavailable", with the model apologising in the body). No search ran.
 *
 * A successful search result is a small document: the echoed query, a one-line
 * `Links: [...]` JSON array (the sources), the model's synthesis, and a trailing
 * `REMINDER:` addressed to the harness. Only the middle two are content, so the
 * echo and the reminder are stripped rather than shown back to the reader.
 */

export const WEB_FETCH = 'WebFetch';
export const WEB_SEARCH = 'WebSearch';

/** The tools this module speaks for. */
export const WEB_TOOLS = new Set<string>([WEB_FETCH, WEB_SEARCH]);

export type WebLink = { title: string; url: string };

/** Absolute first, then a scheme-less host (`example.com/x`) — the second pass
 *  is what keeps a hand-written URL readable instead of unparseable. */
function parseUrl(url: string): URL | null {
  for (const candidate of [url, `https://${url}`]) {
    try {
      return new URL(candidate);
    } catch {
      // not a URL in this form — try the next
    }
  }
  return null;
}

/** Host of a URL without a leading `www.` — the row's "where from". Falls back
 *  to the raw string, never to an empty label. */
export function webHost(url: string): string {
  const host = parseUrl(url)?.host;
  return host ? host.replace(/^www\./, '') : url;
}

/**
 * The page a URL points at, as a row title: its last path segment
 * (`…/uploads/Changelog-2026.pdf` → `Changelog-2026.pdf`), or the host when the URL has
 * no path (`https://claude.ai/` → `claude.ai`); a trailing id is skipped for the
 * segment before it. Query strings and fragments are
 * dropped — they belong to the full URL, which the row keeps in its tooltip.
 */
export function webPageLabel(url: string): string {
  const u = parseUrl(url);
  if (!u) return url;
  const segments = u.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return webHost(url);
  // A trailing id names nothing to a reader: a document portal serves
  // `…/Guide_to_buying.pdf/0f3c9a21-7b4e-…`, and the label was the UUID. Walk
  // back to the last segment that is a word; an all-id path keeps its last.
  const named = segments.filter(seg => !OPAQUE_SEGMENT.test(seg));
  const pick = named[named.length - 1] ?? segments[segments.length - 1];
  try {
    return decodeURIComponent(pick);
  } catch {
    // a stray `%` is not a reason to lose the label
    return pick;
  }
}

/** A path segment that is an identifier, not a name: a UUID or a long hex hash.
 *  A bare number stays — `/issues/8812` is better said `8812` than `issues`. */
const OPAQUE_SEGMENT = /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{16,})$/i;

/**
 * The document a URL addresses, as an aggregation key.
 *
 * The **fragment goes**: `…/docs/en/settings#plugin-settings` is the same page as
 * `…/docs/en/settings` — the server is never even told about the anchor, so the
 * tool fetched one document twice. Verified on a real session, where the two
 * spellings produced two rows with the same title and the same host, which the
 * reader had no way to tell apart. A trailing slash is normalised away for the
 * same reason. The **query string stays**: `?id=2` is another resource, not
 * another way of naming this one.
 */
export function webCanonicalUrl(url: string): string {
  // Absolute-only here, unlike the label helpers: this string is also what the
  // row shows as the source, so a scheme-less input keeps the spelling the model
  // actually used instead of being handed an `https://` it never wrote.
  let u: URL | null;
  try {
    u = new URL(url);
  } catch {
    u = null;
  }
  if (!u) return url.replace(/#.*$/, '').replace(/(.)\/+$/, '$1');
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}${u.search}`;
}

export type WebSearchResult = {
  /** The query the tool echoes back. The input's own `query` is authoritative;
   *  this is here so a result can be read on its own. */
  query: string | null;
  /** The sources the search returned, in result order. */
  links: WebLink[];
  /** The model's synthesis — query echo and harness reminder stripped. */
  body: string;
  /** Set when the search never ran (`Web search error:`), which `is_error`
   *  does not mark. */
  error: string | null;
};

const SEARCH_QUERY_RE = /^Web search results for query:\s*(.*)$/m;
const SEARCH_ERROR_RE = /^Web search error:\s*(.*)$/m;
const LINKS_PREFIX = 'Links: ';

function stripQuotes(s: string): string {
  // The echoed query is wrapped in quotes and may itself contain quotes
  // (`""Vitest" migration …`), so only the outermost pair comes off.
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

/** The `Links:` array is emitted on a single line, so the line *is* the JSON. */
function takeLinks(lines: string[]): { links: WebLink[]; from: number } {
  const at = lines.findIndex(l => l.startsWith(LINKS_PREFIX));
  if (at === -1) return { links: [], from: 0 };
  let links: WebLink[] = [];
  try {
    const parsed: unknown = JSON.parse(lines[at].slice(LINKS_PREFIX.length));
    if (Array.isArray(parsed)) {
      links = parsed
        .filter(
          (x): x is WebLink =>
            !!x && typeof x === 'object' && typeof (x as WebLink).url === 'string'
        )
        .map(x => ({ title: typeof x.title === 'string' ? x.title : '', url: x.url }));
    }
  } catch {
    // Not the shape we know — report no sources rather than half of them.
  }
  return { links, from: at + 1 };
}

export function parseWebSearchResult(raw: string | null | undefined): WebSearchResult {
  const text = raw ?? '';
  const echoed = SEARCH_QUERY_RE.exec(text)?.[1]?.trim();
  const lines = text.split('\n');
  const { links, from } = takeLinks(lines);
  const body = lines
    .slice(from)
    .filter(l => !SEARCH_QUERY_RE.test(l))
    .join('\n')
    .replace(/\n*^REMINDER:[\s\S]*$/m, '');
  return {
    query: echoed ? stripQuotes(echoed) : null,
    links,
    body: body.trim(),
    error: SEARCH_ERROR_RE.exec(text)?.[1]?.trim() || null,
  };
}

export type WebRedirect = { from: string | null; to: string | null; status: string | null };

/** A `WebFetch` that returned a redirect notice instead of a page.
 *
 *  The target line is matched **through an optional parenthetical**: newer CLIs
 *  qualify it (`Redirect URL (from the server's Location header — server-supplied,
 *  not verified): …`) and both spellings sit in the transcripts side by side, so
 *  the label is read up to the colon that actually introduces the URL. Anchoring
 *  on the bare `Redirect URL:` left `to` null on every recent redirect — the row
 *  said REDIRECT without saying where, which is half the fact. */
export function parseRedirectNotice(raw: string | null | undefined): WebRedirect | null {
  const text = raw ?? '';
  if (!/^\s*REDIRECT DETECTED\b/.test(text)) return null;
  return {
    from: /^Original URL:\s*(\S+)/m.exec(text)?.[1] ?? null,
    to: /^Redirect URL(?:\s*\([^)]*\))?:\s*(\S+)/m.exec(text)?.[1] ?? null,
    status: /^Status:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null,
  };
}

/** The `HTTP <code> <reason>` a fetch reports in prose, `is_error` unset — the
 *  page did not come back. Returned as text so the row can name the reason. */
const HTTP_STATUS_RE = /^The server returned (HTTP \d{3}[^.\n]*)/;

export function parseHttpFailure(raw: string | null | undefined): string | null {
  return HTTP_STATUS_RE.exec((raw ?? '').trimStart())?.[1]?.trim() ?? null;
}

/** What actually came back from one web call. `pending` is a call with no
 *  result on disk yet (a live turn, or one that was interrupted). */
export type WebOutcome = 'read' | 'redirect' | 'failed' | 'pending';

export function webOutcome(name: string, result: ToolGroup['result']): WebOutcome {
  if (!result) return 'pending';
  if (result.isError) return 'failed';
  const raw = result.content ?? '';
  if (name === WEB_FETCH) {
    if (parseHttpFailure(raw)) return 'failed';
    return parseRedirectNotice(raw) ? 'redirect' : 'read';
  }
  if (name === WEB_SEARCH && parseWebSearchResult(raw).error) return 'failed';
  return 'read';
}

function inputStr(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  return typeof v === 'string' ? v : '';
}

/* ── web activity ─────────────────────────────────────────────────────── */

/**
 * What the session read from outside the machine.
 *
 * The web tools were the one kind of work the feed never showed: a research
 * session could pull ten pages and run five searches and the rail stayed empty
 * except for the files it wrote afterwards — the sources of an answer were
 * invisible, and a fetch that never landed (a redirect, a dead host) was
 * invisible twice over.
 *
 * The unit is **the page, or the query** — one row per distinct URL and per
 * distinct query, aggregating repeated calls the way `buildFileChanges`
 * aggregates repeated edits of one file. Two fetches of the same URL are the
 * same source read twice (usually asking it for something different), not two
 * events; two different pages of one host are two sources, so they stay apart.
 *
 * What this cannot see, by construction: a **sub-agent's** fetches, which live
 * in its own sidechain transcript (the AGENTS row is their entry point), and any
 * page pulled through a shell command or an MCP browser tool — neither carries a
 * `url` input this can read.
 */

export type WebVisitKind = 'fetch' | 'search';

export type WebVisit = {
  /** Stable row identity: the URL for a fetch, the query for a search. */
  key: string;
  kind: WebVisitKind;
  /** Page label (fetch) or the query itself (search) — the row's title. */
  title: string;
  /** Empty for a search, which has no single source. */
  url: string;
  /** Host of the URL; empty for a search. */
  host: string;
  /** The extraction ask (fetch) or the domain restriction (search) — tooltip
   *  material: it explains *why* the page was pulled. */
  ask: string;
  /** Every call on this source, in transcript order. */
  items: ToolGroup[];
  /** Sources a search returned, from the call that produced them. */
  links: WebLink[];
  /** Where a fetch was redirected — evidence kept even when a later call to the
   *  same URL succeeded, so the row can decide which fact it reports. */
  redirect: WebRedirect | null;
  /** Calls that came back with actual content. */
  reads: number;
  hasError: boolean;
  /** Why it failed, in the tool's own words (first line) — a network error for a
   *  fetch, `unavailable` for a search that never ran. */
  failure: string | null;
};

export function buildWebActivity(groups: ToolGroup[]): WebVisit[] {
  const byKey = new Map<string, WebVisit>();
  for (const g of groups) {
    const name = g.use.name;
    if (!WEB_TOOLS.has(name)) continue;
    const input = g.use.input as Record<string, unknown>;
    const fetch = name === WEB_FETCH;
    // A call whose defining input is missing can't be aggregated under any
    // source — skipping it beats inventing a row titled "".
    const rawSubject = fetch ? inputStr(input, 'url') : inputStr(input, 'query');
    if (!rawSubject) continue;
    // A fetch is grouped by the *document* it asked for, not by the exact string:
    // two spellings of one page (an anchor, a trailing slash) are one source.
    const subject = fetch ? webCanonicalUrl(rawSubject) : rawSubject;

    const key = `${fetch ? 'fetch' : 'search'}:${subject}`;
    let v = byKey.get(key);
    if (!v) {
      const domains = input.allowed_domains;
      v = {
        key,
        kind: fetch ? 'fetch' : 'search',
        title: fetch ? webPageLabel(subject) : subject,
        url: fetch ? subject : '',
        host: fetch ? webHost(subject) : '',
        ask: fetch
          ? inputStr(input, 'prompt')
          : Array.isArray(domains)
            ? domains.filter(d => typeof d === 'string').join(', ')
            : '',
        items: [],
        links: [],
        redirect: null,
        reads: 0,
        hasError: false,
        failure: null,
      };
      byKey.set(key, v);
    }
    v.items.push(g);

    const raw = g.result?.content ?? '';
    switch (webOutcome(name, g.result)) {
      case 'read':
        v.reads += 1;
        if (name === WEB_SEARCH) {
          const links = parseWebSearchResult(raw).links;
          if (links.length > 0) v.links = links;
        }
        break;
      case 'redirect':
        v.redirect = parseRedirectNotice(raw);
        break;
      case 'failed':
        v.hasError = true;
        v.failure =
          (name === WEB_SEARCH
            ? parseWebSearchResult(raw).error
            : // `HTTP 404 Not Found` reads as a row's meta; the sentence it opens
              // ("The server returned …", plus advice about authenticated tools)
              // does not. A transport error has no such shape, so it keeps its
              // first line.
              (parseHttpFailure(raw) ?? raw.split('\n')[0]?.trim())) || null;
        break;
      case 'pending':
        break;
    }
  }
  return [...byKey.values()];
}

/**
 * What a visit came to, all its calls taken together. Precedence follows the
 * question the reader is asking: did the session end up with the page? A URL
 * called twice — once redirected, once read — was read, and reporting REDIRECT
 * there would be false.
 */
export function webVisitOutcome(v: WebVisit): WebOutcome {
  if (v.reads > 0) return 'read';
  if (v.hasError) return 'failed';
  return v.redirect ? 'redirect' : 'pending';
}
