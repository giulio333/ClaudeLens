import { useState } from 'react';
import Markdown from '../../Markdown';
import type { SessionNotice } from '../../../types';
import { CaretGlyph } from './MessageLine';

/** Two arrows closing in: the context squeezed into a summary. */
function CompactGlyph() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 14h6v6" />
      <path d="M20 10h-6V4" />
      <path d="M14 10l7-7" />
      <path d="M3 21l7-7" />
    </svg>
  );
}

/**
 * Where Claude Code compacted the context: everything above went into a
 * summary, and the model goes on from that summary alone.
 *
 * One row, read like a message between sessions (`MessageLine`): the row is the
 * disclosure, and opened it shows the summary the model carried across — the
 * one place a reader can see what the session "remembers" from before.
 */
export function CompactionMarker({
  notice,
  timestamp,
}: {
  notice: SessionNotice;
  timestamp: string;
}) {
  const [open, setOpen] = useState(false);
  const summary = notice.summary;

  return (
    <div className={`cl-compaction${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="cl-compaction-toggle"
        aria-expanded={summary ? open : undefined}
        onClick={summary ? () => setOpen(o => !o) : undefined}
        data-static={summary ? undefined : ''}
      >
        <span className="cl-compaction-icon">
          <CompactGlyph />
        </span>
        <span className="cl-compaction-text">{notice.text}</span>
        {summary && <span className="cl-compaction-cue">summary</span>}
        {timestamp && <time className="cl-compaction-time">{timestamp}</time>}
        {summary && (
          <span className="cl-compaction-caret">
            <CaretGlyph open={open} />
          </span>
        )}
      </button>
      {open && summary && (
        <div className="cl-compaction-open">
          <div className="cl-compaction-body">
            <Markdown>{summary}</Markdown>
          </div>
          <button type="button" className="cl-compaction-hide" onClick={() => setOpen(false)}>
            Hide summary
          </button>
        </div>
      )}
    </div>
  );
}
