import {
  parseRedirectNotice,
  parseWebSearchResult,
  webCanonicalUrl,
  webHost,
  webOutcome,
  webPageLabel,
} from '../src/components/project/chat/web';
import type { ToolGroup } from '../src/components/project/chat/utils';

/** Verbatim shape of a real WebSearch result (query echo · one-line Links JSON ·
 *  synthesis · harness reminder). */
const SEARCH_RESULT = `Web search results for query: "CCNL Unionmeccanica Confapi rinnovo giugno 2026"

Links: [{"title":"Rinnovo CCNL Unionmeccanica-Confapi, i nuovi minimi in vigore","url":"https://www.pmi.it/economia/lavoro/495251/rinnovo.html"},{"title":"CCNL Unionmeccanica-Confapi - Uilm","url":"https://www.uilmnazionale.it/contratti-nazionali/ccnl/"},{"title":"Confapi","url":"https://www.pmi.it/altro/2026/riepilogo.html"}]

Il 4 giugno 2026 le parti hanno sottoscritto l'ipotesi di accordo.

REMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.`;

const REDIRECT_RESULT = `REDIRECT DETECTED: The URL redirects to a different host.

Original URL: https://json.schemastore.org/claude-code-settings.json
Redirect URL: https://www.schemastore.org/claude-code-settings.json
Status: 301 Moved Permanently

To complete your request, I need to fetch content from the redirected URL.`;

function webGroup(
  name: string,
  input: Record<string, unknown>,
  result?: Partial<{ content: string; isError: boolean }>
): ToolGroup {
  return {
    use: { type: 'tool_use', id: 'toolu_1', name, input },
    result: result
      ? {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: result.content ?? '',
          isError: !!result.isError,
        }
      : null,
  } as unknown as ToolGroup;
}

describe('web — url labels', () => {
  it('names a page by its last path segment and drops query/fragment noise', () => {
    expect(webPageLabel('https://inginformatica.uniroma2.it/laurea/sessioni-triennale/')).toBe(
      'sessioni-triennale'
    );
    expect(webPageLabel('https://x.it/wp-content/ComLauree-24luglio.pdf?v=2#page3')).toBe(
      'ComLauree-24luglio.pdf'
    );
    expect(webPageLabel('https://x.it/docs/l%C3%A0-qui')).toBe('là-qui');
  });

  it('falls back to the host when the URL has no path', () => {
    expect(webPageLabel('https://www.githubstatus.com')).toBe('githubstatus.com');
    expect(webPageLabel('https://claude.ai/')).toBe('claude.ai');
  });

  it('canonicalises a URL to the document it addresses', () => {
    // Real case: the same page fetched twice, once with an anchor.
    expect(webCanonicalUrl('https://code.claude.com/docs/en/settings#plugin-settings')).toBe(
      'https://code.claude.com/docs/en/settings'
    );
    expect(webCanonicalUrl('https://x.it/laurea/')).toBe('https://x.it/laurea');
    expect(webCanonicalUrl('https://x.it/')).toBe('https://x.it');
    // A query string names another resource, so it survives.
    expect(webCanonicalUrl('https://x.it/p?id=2#top')).toBe('https://x.it/p?id=2');
    expect(webCanonicalUrl('nonsense#frag')).toBe('nonsense');
  });

  it('reads a scheme-less host, and never returns an empty label', () => {
    expect(webHost('code.claude.com/docs/en/skills')).toBe('code.claude.com');
    expect(webHost('www-2025.inginformatica.uniroma2.it/x')).toBe(
      'www-2025.inginformatica.uniroma2.it'
    );
    expect(webPageLabel('not a url at all')).toBe('not a url at all');
  });
});

describe('web — search results', () => {
  it('splits the echoed query, the sources and the synthesis', () => {
    const parsed = parseWebSearchResult(SEARCH_RESULT);
    expect(parsed.query).toBe('CCNL Unionmeccanica Confapi rinnovo giugno 2026');
    expect(parsed.links).toHaveLength(3);
    expect(parsed.links[0]).toEqual({
      title: 'Rinnovo CCNL Unionmeccanica-Confapi, i nuovi minimi in vigore',
      url: 'https://www.pmi.it/economia/lavoro/495251/rinnovo.html',
    });
    expect(parsed.error).toBeNull();
    // The synthesis survives; the harness-facing reminder and the query echo do not.
    expect(parsed.body).toBe("Il 4 giugno 2026 le parti hanno sottoscritto l'ipotesi di accordo.");
  });

  it('keeps quotes that belong to the query itself', () => {
    const raw = 'Web search results for query: ""Unionmeccanica" Confapi 2028"\n\nLinks: []';
    expect(parseWebSearchResult(raw).query).toBe('"Unionmeccanica" Confapi 2028');
  });

  it('reports a search that never ran, which is_error does not mark', () => {
    const raw = `Web search results for query: "Jolokia strict-checking cors"

Web search error: unavailable

I apologize, but the web search tool is currently unavailable.`;
    const parsed = parseWebSearchResult(raw);
    expect(parsed.error).toBe('unavailable');
    expect(parsed.links).toEqual([]);
    expect(webOutcome('WebSearch', webGroup('WebSearch', {}, { content: raw }).result)).toBe(
      'failed'
    );
  });

  it('degrades to no sources instead of half of them when the array is unreadable', () => {
    const parsed = parseWebSearchResult('Links: [{"title":"broken"\n\nbody');
    expect(parsed.links).toEqual([]);
    expect(parsed.body).toBe('body');
  });
});

describe('web — redirects and outcomes', () => {
  it('parses the redirect notice a fetch returns instead of a page', () => {
    expect(parseRedirectNotice(REDIRECT_RESULT)).toEqual({
      from: 'https://json.schemastore.org/claude-code-settings.json',
      to: 'https://www.schemastore.org/claude-code-settings.json',
      status: '301 Moved Permanently',
    });
    expect(parseRedirectNotice('# A real page about redirects\n\nRedirect URL: nope')).toBeNull();
  });

  it('grades each call: read, redirect, failed, pending', () => {
    const read = webGroup('WebFetch', { url: 'https://x.it/a' }, { content: '# Page\n\ntext' });
    const redirected = webGroup(
      'WebFetch',
      { url: 'https://x.it/a' },
      { content: REDIRECT_RESULT }
    );
    const failed = webGroup(
      'WebFetch',
      { url: 'https://x.it/a' },
      { content: 'artifact content fetch failed (network error)', isError: true }
    );
    const pending = webGroup('WebFetch', { url: 'https://x.it/a' });
    expect(webOutcome('WebFetch', read.result)).toBe('read');
    expect(webOutcome('WebFetch', redirected.result)).toBe('redirect');
    expect(webOutcome('WebFetch', failed.result)).toBe('failed');
    expect(webOutcome('WebFetch', pending.result)).toBe('pending');
  });
});
