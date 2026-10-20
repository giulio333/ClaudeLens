import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import {
  artifactPageMeta,
  artifactVersion,
  pagesNewestFirst,
  shortArtifactUrl,
  type ArtifactActivity,
} from '../chat/artifact';

/**
 * The pages the session published with the `Artifact` tool, in the rail where
 * the files and the Playbook open. They used to be one more species in the
 * feed, a row like an edit or a read; a page is what the session handed over,
 * so it has a place of its own, one icon in the rail's head while it is
 * closed. A row opens the page in the browser — the tool call's answer is
 * prose written for the harness, and the chat already shows each publish where
 * it happened.
 *
 * As with the files panel, the rail's title reads PAGES while it is open and
 * the icon closes it, so there is no ✕; Escape does too while focus is inside.
 */
export function PagesRailPanel({
  id,
  pages,
  onClose,
}: {
  id: string;
  pages: ArtifactActivity[];
  onClose: (restoreFocus?: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose(true);
  };
  const rows = pagesNewestFirst(pages);

  return (
    <div
      ref={ref}
      id={id}
      className="cl-pages-rail"
      role="region"
      aria-label="Published pages"
      tabIndex={-1}
      onKeyDown={onKey}
    >
      <div className="cl-pages-rail-head">
        {rows.length} {rows.length === 1 ? 'page' : 'pages'} published in this session
      </div>
      <div className="cl-pages-rail-body">
        {rows.map(p => {
          const title = p.title || 'Untitled page';
          return (
            <a
              key={p.url}
              href={p.url}
              className="cl-pages-row"
              title={[p.description, p.url].filter(Boolean).join('\n')}
              onClick={e => {
                e.preventDefault();
                window.open(p.url, '_blank', 'noopener');
              }}
            >
              <span className="cl-artifact-mono" aria-hidden>
                A
              </span>
              <span className="text">
                <span className="name">{title}</span>
                <span className="meta">
                  {artifactPageMeta(p)} · {shortArtifactUrl(p.url)}
                </span>
              </span>
              <span className="right">
                {artifactVersion(p)}
                <span aria-hidden> ↗</span>
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
