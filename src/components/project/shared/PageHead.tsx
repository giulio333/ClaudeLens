import { useState } from 'react';
import type { ReactNode } from 'react';

const glyph = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/**
 * The head of every page that opens over a session — a file, a memory topic, a
 * change, a shell run, a file tool call: an icon and a name over a quiet second
 * line, and the page's controls in one row on the right. One head, so the
 * pages read as one kind of page whichever row opened them.
 */
export function PageHead({
  icon,
  name,
  sub,
  subTitle,
  children,
}: {
  icon: ReactNode;
  name: string;
  sub?: ReactNode;
  /** The second line's tooltip — the whole of what it shortens. */
  subTitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="cl-fview-head">
      <span className="cl-fview-ident">
        <span className="cl-fview-title">
          {icon}
          <b className="cl-fview-name">{name}</b>
        </span>
        {sub && (
          <span className="cl-fview-dir" title={subTitle}>
            {sub}
          </span>
        )}
      </span>
      <span className="cl-fview-controls">{children}</span>
    </header>
  );
}

/** A square icon button of the head's tool group; its name is its tooltip. */
export function PageButton({
  label,
  onClick,
  done,
  children,
}: {
  label: string;
  onClick: () => void;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`cl-fview-tool${done ? ' is-done' : ''}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function PageCopyButton({ text, label = 'Copy content' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <PageButton
      label={copied ? 'Copied' : label}
      done={copied}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? (
        <svg {...glyph}>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <svg {...glyph}>
          <rect x="8" y="8" width="12" height="12" rx="2.5" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </svg>
      )}
    </PageButton>
  );
}

/** Markdown's two readings, as the segmented switch Terminal / Lens uses. */
export function ReadingSwitch({
  doc,
  onChange,
}: {
  doc: boolean;
  onChange: (doc: boolean) => void;
}) {
  return (
    <div className="cl-fview-seg" role="group" aria-label="Reading">
      <button type="button" aria-pressed={doc} onClick={() => onChange(true)}>
        <svg {...glyph} width={13} height={13}>
          <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="2.6" />
        </svg>
        Preview
      </button>
      <button type="button" aria-pressed={!doc} onClick={() => onChange(false)}>
        <svg {...glyph} width={13} height={13}>
          <path d="M8.5 7 3.5 12l5 5" />
          <path d="M15.5 7l5 5-5 5" />
        </svg>
        Source
      </button>
    </div>
  );
}
