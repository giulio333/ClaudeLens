import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ConversationSearchHit,
  ConversationSearchRequest,
  ConversationSearchSession,
  SessionSummary,
} from '../../../types';
import { useConversationSearch } from '../../../hooks/useIPC';
import { TopBar } from '../shared/TopBar';
import { Lens } from '../overview/Lens';
import { projectDisplayName } from '../shared/projectName';
import { fmtDate } from '../utils';

type Project = { hash: string; realPath: string };

/**
 * Full-text search over every conversation on disk.
 *
 * The query is SUBMITTED, never streamed: each run is a pass over the whole
 * history (see `electron/modules/session-search.ts`), so typing must not start
 * one. The field seeds from the view — the search popover hands the words the
 * user already typed there — and the scan runs on that seed, so arriving here
 * with a query shows results rather than an empty page waiting for a second
 * Enter.
 */
export function SearchView({
  initialQuery,
  scope,
  onBack,
  onOpenHit,
}: {
  initialQuery: string;
  /** Set when the search was started from inside a project: the scan is limited
   *  to that project's history until the user widens it. */
  scope?: Project;
  onBack: () => void;
  onOpenHit: (project: Project, session: SessionSummary, messageUuid: string) => void;
}) {
  const [draft, setDraft] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery.trim());
  const [scoped, setScoped] = useState(scope !== undefined);
  const [includeThinking, setIncludeThinking] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const request = useMemo<ConversationSearchRequest | null>(() => {
    if (submitted.length < 2) return null;
    return {
      text: submitted,
      projectHash: scoped ? scope?.hash : undefined,
      includeThinking,
    };
  }, [submitted, scoped, scope, includeThinking]);

  const { data, isFetching, isError, error } = useConversationSearch(request);

  const totalHits = (data?.results ?? []).reduce((n, r) => n + r.hitCount, 0);

  /**
   * Open the session a hit belongs to.
   *
   * The chat view is driven by a `SessionSummary` — the row the sessions list
   * builds, with the session's own cost and token figures on it. A search result
   * carries none of that, and fabricating one with zeroes would put invented
   * numbers in the transcript header, so the real summary is fetched from the
   * project's own list and the hit is refused when it isn't there: a transcript
   * deleted since the scan is a session that cannot be opened, and saying so
   * beats navigating to an empty view.
   */
  async function openHit(result: ConversationSearchSession) {
    setOpenError(null);
    const project: Project = {
      hash: result.projectHash,
      // The scan leaves `projectPath` unset when the cwd could only be guessed
      // from the folder name. The chat view needs a path, and the scoped case
      // already has the authoritative one.
      realPath: result.projectPath ?? (scope?.hash === result.projectHash ? scope.realPath : ''),
    };
    try {
      const sessions = await qc.fetchQuery<SessionSummary[]>({
        queryKey: ['sessions:project', result.projectHash],
        queryFn: () => unwrapSessions(result.projectHash),
      });
      const filename = `${result.sessionId}.jsonl`;
      const session = sessions.find(s => s.filename === filename);
      if (!session) {
        setOpenError(
          `That session is no longer in ${projectDisplayName(project.realPath) || 'this project'} — it may have been deleted since the search ran.`
        );
        return;
      }
      onOpenHit(project, session, result.hits[0]?.messageUuid ?? '');
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e));
    }
  }

  function submit() {
    const next = draft.trim();
    setOpenError(null);
    setSubmitted(next);
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar
        onBack={onBack}
        backLabel={scope ? 'Project' : 'Global'}
        crumbs={[{ label: 'Search', accent: true }]}
      />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <Lens />
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>
              {scoped && scope
                ? `Project · ${projectDisplayName(scope.realPath)}`
                : 'Global · every conversation on disk'}
            </span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Search</span>
            <span className="glyph">.</span>
          </h1>

          <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 18 }}>
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="Find words in your conversations…"
              aria-label="Search conversations"
              spellCheck={false}
              style={{
                flex: '1 1 320px',
                minWidth: 240,
                maxWidth: 560,
                height: 38,
                padding: '0 12px',
                fontSize: 14,
                fontFamily: 'var(--font-mono)',
                color: 'var(--cl-ink)',
                background: 'var(--cl-paper-2)',
                border: '1px solid var(--cl-line)',
                borderRadius: 8,
                outline: 'none',
              }}
            />
            <button onClick={submit} className="cl-btn" disabled={draft.trim().length < 2}>
              Search
            </button>
          </div>

          <div
            className="flex items-center gap-4 flex-wrap"
            style={{ marginTop: 12, fontSize: 12, color: 'var(--cl-ink-3)' }}
          >
            {scope && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!scoped}
                  onChange={e => setScoped(!e.target.checked)}
                />
                Search every project
              </label>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={includeThinking}
                onChange={e => setIncludeThinking(e.target.checked)}
              />
              Include reasoning blocks
            </label>
            <span style={{ color: 'var(--cl-ink-4)' }}>
              Prompts and replies. Tool input and output are not searched.
            </span>
          </div>

          {data && !isFetching && (
            <div className="cl-hband" style={{ marginTop: 20 }}>
              <div className="cl-hcell">
                <div className="lbl">Matches</div>
                <div className="num">{totalHits}</div>
                <div className="sub">
                  {data.results.length} session{data.results.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className="cl-hcell">
                <div className="lbl">Transcripts read</div>
                <div className="num">{data.scanned}</div>
                <div className="sub">{data.parsed} parsed</div>
              </div>
              <div className="cl-hcell">
                <div className="lbl">Took</div>
                <div className="num">{data.elapsedMs}</div>
                <div className="sub">ms</div>
              </div>
            </div>
          )}
        </section>

        <section className="cl-section">
          {openError && (
            <div
              role="alert"
              style={{
                fontSize: 13,
                color: 'var(--cl-ink-2)',
                border: '1px solid var(--cl-line)',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 16,
              }}
            >
              {openError}
            </div>
          )}

          {isFetching && (
            <div style={{ fontSize: 13, color: 'var(--cl-ink-3)' }}>
              Reading transcripts{scoped && scope ? ' in this project' : ' across every project'}…
            </div>
          )}

          {isError && !isFetching && (
            <div role="alert" style={{ fontSize: 13, color: 'var(--cl-ink-2)' }}>
              {error instanceof Error ? error.message : 'The search could not be run.'}
            </div>
          )}

          {!isFetching && !isError && request === null && (
            <div style={{ fontSize: 13, color: 'var(--cl-ink-3)' }}>
              Type at least two characters and press Enter.
            </div>
          )}

          {!isFetching && !isError && data && data.results.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--cl-ink-3)' }}>
              Nothing matched “{submitted}” in {data.scanned} transcript
              {data.scanned === 1 ? '' : 's'}.
            </div>
          )}

          {!isFetching &&
            data?.results.map(result => (
              <SessionResult
                key={`${result.projectHash}/${result.sessionId}`}
                result={result}
                query={submitted}
                showProject={!scoped}
                onOpen={() => openHit(result)}
              />
            ))}

          {!isFetching && data?.truncated && (
            <div style={{ fontSize: 12, color: 'var(--cl-ink-4)', marginTop: 12 }}>
              The scan stopped at {data.results.length} sessions — older conversations were not
              read. Narrow the query to reach them.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SessionResult({
  result,
  query,
  showProject,
  onOpen,
}: {
  result: ConversationSearchSession;
  query: string;
  showProject: boolean;
  onOpen: () => void;
}) {
  // A project whose cwd could only be guessed is shown by its folder hash, not
  // by the inverted path: the inversion is lossy (`/` and `.` both collapse to
  // `-`), and a plausible wrong name is worse here than an ugly right one.
  const name = result.projectPath ? projectDisplayName(result.projectPath) : result.projectHash;
  // The scan reads the transcript's own title record; a session that has none
  // has no name to show, and the short id is what identifies it instead.
  const title = result.sessionTitle || 'Untitled session';

  return (
    <div
      style={{
        border: '1px solid var(--cl-line)',
        borderRadius: 10,
        padding: '12px 14px',
        marginBottom: 12,
        background: 'var(--cl-paper-2)',
      }}
    >
      <button
        onClick={onOpen}
        className="w-full text-left"
        style={{ display: 'block', marginBottom: 8 }}
      >
        <div className="flex items-baseline gap-2 flex-wrap">
          {showProject && (
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: 'var(--cl-ink-4)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {name}
            </span>
          )}
          <span style={{ fontSize: 14, color: 'var(--cl-ink)' }}>{title}</span>
          <span style={{ fontSize: 11, color: 'var(--cl-ink-4)' }}>
            {result.sessionId.slice(0, 8)} · {fmtDate(new Date(result.mtime).toISOString())} ·{' '}
            {result.hitCount === result.hits.length
              ? `${result.hitCount} match${result.hitCount === 1 ? '' : 'es'}`
              : `${result.hits.length} of ${result.hitCount} matches`}
          </span>
        </div>
      </button>

      <div className="flex flex-col gap-1.5">
        {result.hits.map((hit, i) => (
          <HitLine key={`${hit.messageUuid}-${i}`} hit={hit} query={query} />
        ))}
      </div>
    </div>
  );
}

/** One snippet, with the matched run marked. The offsets come from the scan —
 *  re-finding the query here would disagree with it on any fold the regex
 *  engine handled and the naive search would not. */
function HitLine({ hit, query }: { hit: ConversationSearchHit; query: string }) {
  const before = hit.snippet.slice(0, hit.matchStart);
  const match = hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength);
  const after = hit.snippet.slice(hit.matchStart + hit.matchLength);

  return (
    <div className="flex items-baseline gap-2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
      <span
        title={hit.kind === 'thinking' ? 'reasoning block' : undefined}
        style={{
          flexShrink: 0,
          width: 58,
          fontFamily: 'var(--font-mono)',
          fontSize: 10.5,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--cl-ink-4)',
        }}
      >
        {hit.kind === 'thinking' ? 'thinking' : hit.role === 'user' ? 'you' : 'claude'}
      </span>
      <span style={{ color: 'var(--cl-ink-2)' }}>
        {before}
        <mark
          aria-label={`match for ${query}`}
          style={{
            background: 'color-mix(in oklab, var(--cl-accent) 22%, transparent)',
            color: 'var(--cl-ink)',
            borderRadius: 2,
            padding: '0 1px',
          }}
        >
          {match}
        </mark>
        {after}
      </span>
    </div>
  );
}

/** The sessions list, unwrapped the way `useIPC` unwraps it — this call goes
 *  through `fetchQuery` (a click, not a mounted query), so it can't reuse the
 *  hook. */
async function unwrapSessions(hash: string): Promise<SessionSummary[]> {
  const res = await window.electronAPI.sessions.listByProject(hash);
  if (res.error) throw new Error(res.error);
  return res.data ?? [];
}
