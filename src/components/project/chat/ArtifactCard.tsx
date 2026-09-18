import { useState } from 'react';
import type { ArtifactPublish } from '../../../types';
import {
  artifactDescription,
  artifactIsPrivate,
  artifactStatusLabel,
  artifactVersion,
  shortArtifactUrl,
} from './artifact';
import { CodeBlock } from './atoms';
import type { ToolGroup } from './utils';

/**
 * A page the `Artifact` tool published, drawn as what it is: an outcome of the
 * turn, with a name and a link.
 *
 * The generic tool card drew it as plumbing — the header said "Artifact", the
 * body was the result prose, and the page's own link sat inside a kilobyte of
 * text about live subscriptions, as text rather than a link. Everything this
 * card shows is a field Claude Code already wrote; nothing is parsed out of
 * that prose, which stays available, folded, for whoever wants it.
 *
 * The visual grammar is the app's own card, unchanged: the same 22px monogram
 * tile, the same title/preview pair, the same status strip the other cards use
 * for their result. What changes is the tint — a published page takes the
 * accent, an ordinary tool call stays neutral — because the reader's question
 * here is "did this turn produce something", and colour answers it before any
 * glyph would.
 */
export function ArtifactCard({
  group,
  page,
  compact,
}: {
  group: ToolGroup;
  page: ArtifactPublish;
  /** One line and nothing else — the minimal-density strip, where the turn's
   *  tools are hidden and only its outcomes are kept. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const description = artifactDescription(group);
  const version = artifactVersion(page);
  const isPrivate = artifactIsPrivate(page);
  const title = page.title || 'Untitled page';
  const raw = group.result?.content ?? '';

  const link = (
    <a
      href={page.url}
      title={`Open ${page.url} in your browser`}
      onClick={e => {
        e.preventDefault();
        window.open(page.url, '_blank', 'noopener');
      }}
      className="cl-artifact-link"
    >
      {shortArtifactUrl(page.url)}
      <span aria-hidden> ↗</span>
    </a>
  );

  if (compact) {
    return (
      <div className="cl-artifact-card is-compact">
        <div className="cl-artifact-head is-static">
          <span className="cl-artifact-mono" aria-hidden>
            A
          </span>
          <span className="cl-artifact-id">
            <span className="cl-artifact-title">{title}</span>
          </span>
          {link}
          {version && <span className="cl-artifact-ver">{version}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={`cl-artifact-card${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="cl-artifact-head"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`${title} — ${open ? 'hide' : 'show'} what the tool answered`}
      >
        <span className="cl-artifact-mono" aria-hidden>
          A
        </span>
        <span className="cl-artifact-id">
          <span className="cl-artifact-title">{title}</span>
          {description && <span className="cl-artifact-desc">{description}</span>}
        </span>
        <span className="cl-artifact-right">
          {version && <span className="cl-artifact-ver">{version}</span>}
          <span className="cl-artifact-caret" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
        </span>
      </button>

      <div className="cl-artifact-strip">
        <span className="cl-artifact-status">{artifactStatusLabel(page)}</span>
        {link}
        {isPrivate !== undefined && (
          <span className="cl-artifact-share">{isPrivate ? 'private' : 'shared'}</span>
        )}
      </div>

      {open && (
        <div className="cl-artifact-body">
          {page.path && (
            <div className="cl-artifact-field">
              <span className="cl-artifact-field-label">Source</span>
              <span className="cl-artifact-field-value" title={page.path}>
                {page.path}
              </span>
            </div>
          )}
          {page.icon && (
            <div className="cl-artifact-field">
              <span className="cl-artifact-field-label">Icon</span>
              <span className="cl-artifact-field-value">{page.icon}</span>
            </div>
          )}
          {raw && <CodeBlock code={raw} />}
        </div>
      )}
    </div>
  );
}
