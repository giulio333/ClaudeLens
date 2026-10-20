import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useLocalImage, useMemoryProject, useProjectFile } from '../../../hooks/useIPC';
import Markdown from '../../Markdown';
import { ImageFigure } from '../../ImageFigure';
import { VaultLinksProvider } from '../../VaultLinks';
import { PaperCode } from '../chat/ContextFileSheet';
import { resolveLang } from '../chat/code-lang';
import { fileName } from '../chat/file-view';
import { fileExt, MEMORY_TYPE_TINT } from '../chat/utils';
import type { MemoryType } from '../chat/utils';
import { readFrontmatter } from './frontmatter';
import type { DocProperty } from './frontmatter';
import { homeRelativePath } from '../shared/projectName';
import {
  fmtBytes,
  HIGHLIGHT_MAX_LINES,
  joinRoot,
  lineCount,
  memoryTopicSource,
  memoryTopicText,
  viewerKind,
} from './file-viewer';
import type { FileMark } from './session-marks';
import { FileKindIcon } from './FileKindIcon';
import { PageButton, PageCopyButton, PageHead, ReadingSwitch } from '../shared/PageHead';

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

/** Hands the file to the app the OS opens it with — the way out for anything
 *  this page does not draw, and for editing, which this page never does. */
function OpenButton({ root, rel }: { root: string; rel: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <>
      {failed && <span className="cl-fview-error">{failed}</span>}
      <PageButton
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
      </PageButton>
    </>
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

  const body = textBody(a.text, rel, kind === 'markdown' ? [asDocument, setAsDocument] : null);
  return { ...body, facts: [...(body.facts ?? []), fmtBytes(a.bytes)] };
}

/** A file shown as text: markdown as a document with its source a switch away
 *  (`reading` set), anything else as numbered source. The document opens on
 *  its frontmatter, read as properties; `memory` tints a topic's type. */
function textBody(
  text: string,
  rel: string,
  reading: [boolean, (doc: boolean) => void] | null,
  memory = false
): Body {
  const lines = lineCount(text);
  const facts = [`${lines} ${lines === 1 ? 'line' : 'lines'}`];
  const switchable = reading ? { doc: reading[0], set: reading[1] } : undefined;
  if (switchable?.doc) {
    return {
      content: (
        <article className="cl-fview-doc">
          <Frontmatter text={text} rel={rel} memory={memory} />
          <Markdown>{text}</Markdown>
        </article>
      ),
      facts,
      text,
      reading: switchable,
    };
  }
  const lang = lines > HIGHLIGHT_MAX_LINES ? null : resolveLang(fileExt(rel));
  return {
    content: (
      <div className="cl-fview-code">
        <PaperCode text={text.replace(/\n$/, '')} lang={lang} />
      </div>
    ),
    facts,
    text,
    reading: switchable,
  };
}

/**
 * A document's frontmatter, at the head of its reading: the description as a
 * lead, then the fields as a quiet two-column list between hairlines — keys in
 * small mono, values in ink, a list as chips, a date as a date. A block that
 * is not readable YAML is shown as written. Source keeps it raw, always.
 */
function Frontmatter({ text, rel, memory }: { text: string; rel: string; memory: boolean }) {
  const stem = fileName(rel).replace(/\.[^.]+$/, '');
  const fm = useMemo(() => readFrontmatter(text, stem), [text, stem]);
  if (!fm) return null;
  return (
    <header className="cl-fview-fm">
      {fm.lead && <p className="cl-fview-fm-lead">{fm.lead}</p>}
      {fm.raw !== undefined ? (
        <pre className="cl-fview-fm-raw">{fm.raw}</pre>
      ) : (
        fm.properties.length > 0 && (
          <dl className="cl-fview-fm-props">
            {fm.properties.map(p => (
              <div key={p.key} className="cl-fview-fm-row">
                <dt>{p.key}</dt>
                <dd>
                  <PropertyValue property={p} memory={memory} />
                </dd>
              </div>
            ))}
          </dl>
        )
      )}
    </header>
  );
}

function PropertyValue({ property: p, memory }: { property: DocProperty; memory: boolean }) {
  if (Array.isArray(p.value)) {
    return (
      <span className="cl-fview-fm-chips">
        {p.value.map((v, i) => (
          <span key={i} className="cl-fview-fm-chip">
            {v}
          </span>
        ))}
      </span>
    );
  }
  // A memory topic's type is the one field with a colour of its own: the same
  // tint the Memory views and Mission Control's rail give it.
  const tint = memory && p.key === 'type' ? MEMORY_TYPE_TINT[p.value as MemoryType] : undefined;
  if (tint) {
    return (
      <span className="cl-fview-fm-type" style={{ '--tint': tint } as CSSProperties}>
        {p.value}
      </span>
    );
  }
  return <span className={p.kind === 'date' ? 'is-date' : undefined}>{p.value}</span>;
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
  return (
    <VaultLinksProvider root={root}>
      <FilePage
        path={joinRoot(root, rel)}
        dir={dir ? joinRoot(root, dir) : root}
        body={body}
        note={mark ? MARK_NOTE[mark] : undefined}
        open={<OpenButton root={root} rel={rel} />}
        onClose={onClose}
      />
    </VaultLinksProvider>
  );
}

/**
 * A memory topic on the same page as a project file. Its text comes from the
 * memory reader — the history folder is not a project root `files:readText`
 * may read — and the document reading leaves the frontmatter to Source.
 *
 * No `VaultLinksProvider`, as in the memory views: a topic's `[[links]]` name
 * other topics, not project files, and against the project they would all
 * read as missing.
 */
export function MemoryFileViewer({
  path,
  projectHash,
  fallback,
  onClose,
}: {
  path: string;
  projectHash: string;
  /** Drawn instead of the page when the topic is not there to read. */
  fallback?: ReactNode;
  onClose?: () => void;
}) {
  const source = memoryTopicSource(path, projectHash);
  const memory = useMemoryProject(source?.hash ?? null);
  const [asDocument, setAsDocument] = useState(true);
  const text = source ? memoryTopicText(memory.data, path, source.level) : null;
  const body: Body = memory.isPending
    ? { content: <Note text="Loading…" /> }
    : text === null
      ? { content: <Note text="This memory is gone." /> }
      : textBody(text, path, [asDocument, setAsDocument], true);
  if (!memory.isPending && text === null && fallback) return <>{fallback}</>;
  const sep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const dir = sep > 0 ? path.slice(0, sep) : path;
  return (
    <FilePage
      path={path}
      dir={dir}
      body={body}
      note={source?.level === 'project' ? 'project memory' : 'memory'}
      open={text !== null ? <OpenButton root={dir} rel={fileName(path)} /> : undefined}
      onClose={onClose}
    />
  );
}

/** A memory topic's page drawn from text in hand rather than read from disk —
 *  the same page `MemoryFileViewer` draws, for the "What's new" preview. */
export function MemoryPagePreview({ path, text }: { path: string; text: string }) {
  const [asDocument, setAsDocument] = useState(true);
  const sep = path.lastIndexOf('/');
  return (
    <FilePage
      path={path}
      dir={sep > 0 ? path.slice(0, sep) : path}
      body={textBody(text, path, [asDocument, setAsDocument], true)}
      note="memory"
    />
  );
}

/** The page itself: the head that names the file once, name over its folder,
 *  with every control in one row; the body; the facts in the foot. */
function FilePage({
  path,
  dir,
  body,
  note,
  open,
  onClose,
}: {
  path: string;
  dir: string;
  body: Body;
  note?: string;
  open?: ReactNode;
  onClose?: () => void;
}) {
  const facts = [...(body.facts ?? []), ...(note ? [note] : [])];
  return (
    <div className="cl-fview">
      <FilePageHead path={path} dir={dir}>
        {body.reading && <ReadingSwitch doc={body.reading.doc} onChange={body.reading.set} />}
        {body.text !== undefined && <PageCopyButton text={body.text} />}
        {open}
        {onClose && (
          <>
            <i className="cl-fview-sep" aria-hidden />
            <PageButton label="Close" onClick={onClose}>
              <svg {...glyph}>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </PageButton>
          </>
        )}
      </FilePageHead>
      <div className="cl-fview-body">{body.content}</div>
      {facts.length > 0 && <footer className="cl-fview-foot">{facts.join(' · ')}</footer>}
    </div>
  );
}

/** The head of a page about one file — a project file, a memory topic, a
 *  session's change to a file: the shared `PageHead`, named by the file. */
export function FilePageHead({
  path,
  dir,
  children,
}: {
  path: string;
  dir: string;
  children?: ReactNode;
}) {
  return (
    <PageHead
      icon={<FileKindIcon ext={fileExt(path)} />}
      name={fileName(path)}
      sub={homeRelativePath(dir)}
      subTitle={path}
    >
      {children}
    </PageHead>
  );
}
