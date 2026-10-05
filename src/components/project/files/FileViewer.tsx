import { useState } from 'react';
import type { ReactNode } from 'react';
import { useLocalImage, useProjectFile } from '../../../hooks/useIPC';
import Markdown from '../../Markdown';
import { ImageFigure } from '../../ImageFigure';
import { VaultLinksProvider } from '../../VaultLinks';
import { PaperCode } from '../chat/ContextFileSheet';
import { resolveLang } from '../chat/code-lang';
import { fileName } from '../chat/file-view';
import { fileExt } from '../chat/utils';
import { homeRelativePath } from '../shared/projectName';
import { fmtBytes, HIGHLIGHT_MAX_LINES, joinRoot, lineCount, viewerKind } from './file-viewer';
import type { FileMark } from './session-marks';
import { FileKindIcon } from './FileKindIcon';

const MARK_NOTE: Record<FileMark, string> = {
  read: 'read in this session',
  edited: 'edited in this session',
  created: 'created in this session',
};

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

/** A square icon button of the head's tool group; its name is its tooltip. */
function ToolButton({
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ToolButton
      label={copied ? 'Copied' : 'Copy content'}
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
    </ToolButton>
  );
}

/** Hands the file to the app the OS opens it with — the way out for anything
 *  this page does not draw, and for editing, which this page never does. */
function OpenButton({ root, rel }: { root: string; rel: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <>
      {failed && <span className="cl-fview-error">{failed}</span>}
      <ToolButton
        label="Open in its default app"
        onClick={() => {
          setFailed(null);
          void window.electronAPI.vault.openFile(root, rel).then(r => {
            if (r.error) setFailed(r.error);
          });
        }}
      >
        <svg {...glyph}>
          <path d="M14 4h6v6" />
          <path d="M20 4l-9 9" />
          <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
        </svg>
      </ToolButton>
    </>
  );
}

/** Markdown's two readings, as the segmented switch Terminal / Lens uses. */
function ReadingSwitch({ doc, onChange }: { doc: boolean; onChange: (doc: boolean) => void }) {
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

/** A file the page does not draw: what it is, in a sentence. */
function Note({ text }: { text: string }) {
  return <div className="cl-fview-note">{text}</div>;
}

type Body = {
  content: ReactNode;
  facts?: string[];
  /** The text, for Copy — only a file shown as text has one. */
  text?: string;
  /** Present for markdown: which reading is on, and the way to change it. */
  reading?: { doc: boolean; set: (doc: boolean) => void };
};

function useBody(root: string, rel: string, version: number): Body {
  const kind = viewerKind(rel);
  const image = useLocalImage(kind === 'image' ? joinRoot(root, rel) : null, root);
  const textual = kind === 'markdown' || kind === 'text';
  const text = useProjectFile(textual ? root : null, rel, version);
  const [asDocument, setAsDocument] = useState(true);

  if (kind === 'external') {
    return { content: <Note text="This kind of file opens in its own app." /> };
  }

  if (kind === 'image') {
    const a = image.data;
    if (image.isPending) return { content: <Note text="Loading…" /> };
    if (image.isError || !a) return { content: <Note text="This image could not be read." /> };
    if (a.status === 'missing') return { content: <Note text="This file is gone." /> };
    if (a.status === 'refused') return { content: <Note text={a.reason} /> };
    return {
      content: (
        <div className="cl-fview-image">
          <ImageFigure src={a.dataUri} alt={fileName(rel)} />
        </div>
      ),
      facts: [fmtBytes(a.bytes)],
    };
  }

  const a = text.data;
  if (text.isPending) return { content: <Note text="Loading…" /> };
  if (text.isError || !a) {
    const reason = text.error instanceof Error ? text.error.message : 'unknown error';
    return { content: <Note text={`This file could not be read: ${reason}`} /> };
  }
  if (a.status === 'missing') return { content: <Note text="This file is gone." /> };
  if (a.status === 'refused') return { content: <Note text={a.reason} /> };
  if (a.status === 'binary') {
    return {
      content: <Note text="A binary file, not shown as text." />,
      facts: [fmtBytes(a.bytes)],
    };
  }
  if (a.status === 'too-large') {
    return { content: <Note text="Too large to show here." />, facts: [fmtBytes(a.bytes)] };
  }

  const lines = lineCount(a.text);
  const facts = [`${lines} ${lines === 1 ? 'line' : 'lines'}`, fmtBytes(a.bytes)];
  const reading = kind === 'markdown' ? { doc: asDocument, set: setAsDocument } : undefined;
  if (reading?.doc) {
    return {
      content: (
        <article className="cl-fview-doc">
          <Markdown>{a.text}</Markdown>
        </article>
      ),
      facts,
      text: a.text,
      reading,
    };
  }
  const lang = lines > HIGHLIGHT_MAX_LINES ? null : resolveLang(fileExt(rel));
  return {
    content: (
      <div className="cl-fview-code">
        <PaperCode text={a.text.replace(/\n$/, '')} lang={lang} />
      </div>
    ),
    facts,
    text: a.text,
    reading,
  };
}

/**
 * One project file on paper, drawn by what it is: markdown as a document in a
 * reading column with its source a switch away, code and text as numbered rows
 * in the page's own palette, a raster image as the picture. Anything else says
 * what it is and opens in its own app. Read-only: nothing here writes.
 *
 * Paper and not the transcript's dark editor window: that window is a tool's
 * output inside a conversation, this is a page of the app about a file — the
 * line `ContextFileSheet` already draws for a file the session read.
 *
 * The head says the file once — name over its folder — and holds every control
 * in one row: markdown's reading as a segmented switch, like Terminal / Lens,
 * then Copy and Open as bare icons named by their tooltips, and, in an
 * overlay, its ✕. Mission Control's top bar does not name the file again.
 *
 * `version` is part of the read's key, so a host that knows the file changed
 * (Mission Control counts its session's writes to it) gets a fresh read.
 */
export function FileViewer({
  root,
  rel,
  version = 0,
  mark,
  onClose,
}: {
  root: string;
  rel: string;
  version?: number;
  /** What the session on screen did to this file, said in the foot. */
  mark?: FileMark;
  /** Set where the page is an overlay: its ✕, in its own head. */
  onClose?: () => void;
}) {
  const body = useBody(root, rel, version);
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const facts = [...(body.facts ?? []), ...(mark ? [MARK_NOTE[mark]] : [])];
  return (
    <VaultLinksProvider root={root}>
      <div className="cl-fview">
        <header className="cl-fview-head">
          <span className="cl-fview-ident">
            <span className="cl-fview-title">
              <FileKindIcon ext={fileExt(rel)} />
              <b className="cl-fview-name">{fileName(rel)}</b>
            </span>
            <span className="cl-fview-dir" title={joinRoot(root, rel)}>
              {homeRelativePath(dir ? joinRoot(root, dir) : root)}
            </span>
          </span>
          <span className="cl-fview-controls">
            {body.reading && <ReadingSwitch doc={body.reading.doc} onChange={body.reading.set} />}
            {body.text !== undefined && <CopyButton text={body.text} />}
            <OpenButton root={root} rel={rel} />
            {onClose && (
              <>
                <i className="cl-fview-sep" aria-hidden />
                <ToolButton label="Close" onClick={onClose}>
                  <svg {...glyph}>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </ToolButton>
              </>
            )}
          </span>
        </header>
        <div className="cl-fview-body">{body.content}</div>
        {facts.length > 0 && <footer className="cl-fview-foot">{facts.join(' · ')}</footer>}
      </div>
    </VaultLinksProvider>
  );
}
