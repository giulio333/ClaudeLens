import { useMemo } from 'react';
import { buildWebActivity, webHost, webVisitOutcome } from './web';
import type { WebOutcome, WebVisit } from './web';
import type { ToolGroup } from './utils';

/** The verb, as the file rows below say `Updated`/`Created`: what came back. */
function verbOf(v: WebVisit, outcome: WebOutcome): string {
  if (outcome === 'read') return v.kind === 'search' ? 'Searched' : 'Fetched';
  if (outcome === 'redirect') return 'Redirect';
  return outcome === 'failed' ? 'Failed' : 'Pending';
}

/** Where the answer came from: the host, the reason a fetch failed, where it
 *  was sent instead — the same facts Mission Control's WEB row states. */
function visitMeta(v: WebVisit, outcome: WebOutcome): string {
  const hosts =
    v.kind === 'search'
      ? [...new Set(v.links.map(l => webHost(l.url)).filter(Boolean))]
      : v.host === v.title
        ? []
        : [v.host];
  const source =
    hosts.length > 2
      ? `${hosts.slice(0, 2).join(' · ')} · +${hosts.length - 2}`
      : hosts.join(' · ');
  return [
    source,
    outcome === 'failed' ? v.failure : null,
    outcome === 'redirect' && v.redirect?.to ? `→ ${webHost(v.redirect.to)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function GlobeGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.8 8h12.4M8 1.8c1.8 1.7 2.7 3.8 2.7 6.2S9.8 12.5 8 14.2C6.2 12.5 5.3 10.4 5.3 8S6.2 3.5 8 1.8Z" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <circle cx="7" cy="7" r="4.6" />
      <path d="m10.4 10.4 3.6 3.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The pages a turn fetched and the searches it ran, at its foot in MIN density.
 *
 * MIN hides every tool without a strip of its own, and the web tools had none:
 * a turn that read fifteen pages to answer showed `tools hidden ×15` and not one
 * of its sources. Each page or query is one line — the same aggregation as
 * Mission Control's WEB rows (`buildWebActivity`), so a URL fetched twice is
 * one source — drawn with the anatomy of the changed-file rows beside it: a
 * verb saying what came back (fetched, searched, failed — an HTTP error the
 * tool reports in prose included —, redirect, pending), the source in bold,
 * where it is from dimmed after it. A click opens the last call on it.
 */
export function WebSourcesStrip({
  groups,
  onOpen,
}: {
  groups: ToolGroup[];
  onOpen?: (group: ToolGroup) => void;
}) {
  const visits = useMemo(() => buildWebActivity(groups), [groups]);
  if (visits.length === 0) return null;
  return (
    <ul className="cl-web-sources" aria-label="Web sources">
      {visits.map(v => {
        const outcome = webVisitOutcome(v);
        const meta = visitMeta(v, outcome);
        const last = v.items[v.items.length - 1];
        const count =
          outcome === 'read' && v.kind === 'search' && v.links.length > 0
            ? `${v.links.length} links`
            : null;
        return (
          <li key={v.key}>
            <button
              type="button"
              className="cl-web-source"
              data-outcome={outcome}
              title={v.kind === 'fetch' ? v.url : v.title}
              disabled={!onOpen}
              onClick={() => onOpen?.(last)}
            >
              <span className="cl-web-source-verb">{verbOf(v, outcome)}</span>
              <span className="cl-web-source-icon">
                {v.kind === 'fetch' ? <GlobeGlyph /> : <SearchGlyph />}
              </span>
              <b className="cl-web-source-title">{v.title}</b>
              {meta && <span className="cl-web-source-meta">{meta}</span>}
              {v.items.length > 1 && <span className="cl-web-source-times">×{v.items.length}</span>}
              {count && <span className="cl-web-source-count">{count}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
