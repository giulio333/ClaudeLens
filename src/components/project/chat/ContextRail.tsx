import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { FileIcon } from './fileIcons';
import { ContextFileSheet, ReadLines } from './ContextFileSheet';
import { fileName } from './file-view';
import { fileCategoryTint } from './utils';
import { groupContextFiles, spanLabel } from './context-files';
import type { ContextFile } from './context-files';

/** Rows the peek draws before it fades: a glance at what was read, not the file. */
const PEEK_ROWS = 14;
/** Air the peek keeps from the top of the rail. */
const PEEK_EDGE = 8;
/** Vertical room one dot takes, gap included. */
const DOT_PITCH = 13;
/** The capsule around the dots: label, total, paddings — and the rail's own. */
const RAIL_CHROME = 280;
/** Long enough to cross from the capsule to the panel without it closing. */
const CLOSE_DELAY_MS = 160;

/** Where the peek wants to sit (beside the row) and the band it must stay in:
 *  the rail minus its bottom padding, which is where the pill floats. All in
 *  pixels from the top of the anchor, which is what the peek is positioned in. */
type Peek = { path: string; rowTop: number; min: number; max: number };

/**
 * The files the session read, on the left edge of Lens.
 *
 * At rest it is the capsule the turn navigator used to be: one dot per file,
 * tinted by kind, the files read in the turn being read lit up — which is what
 * keeps it tied to the scroll the way the minimap was. Hover opens the list,
 * grouped by folder; hovering a file shows the lines that were read, in the
 * editor window the transcript draws for a `Read`. A click opens the file's
 * own window (`ContextFileSheet`): every read, and the jump to its turn.
 */
export function ContextRail({
  files,
  cwd,
  turnOf,
  activeTurn,
  onJump,
}: {
  files: ContextFile[];
  cwd: string | null;
  /** The rendered turn a read belongs to, from its index into `processed`. */
  turnOf: (idx: number) => number | null;
  activeTurn: number | null;
  onJump: (turn: number) => void;
}) {
  const railRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const capsuleRef = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [railH, setRailH] = useState(0);
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState<Peek | null>(null);
  // Whether the peek is showing. Kept apart from `peek` so hiding it fades the
  // window out where it is, instead of unmounting it mid-transition.
  const [peekShown, setPeekShown] = useState(false);
  // The file whose full window is open (a click on its name), by path.
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const el = railRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => setRailH(entries[0].contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => clearClose(closeTimer), []);

  const active = useMemo(() => {
    const lit = new Set<string>();
    if (activeTurn === null) return lit;
    for (const f of files) if (f.reads.some(r => turnOf(r.idx) === activeTurn)) lit.add(f.path);
    return lit;
  }, [files, turnOf, activeTurn]);
  const groups = useMemo(() => groupContextFiles(files, cwd), [files, cwd]);

  if (files.length === 0) return null;

  const openNow = () => {
    clearClose(closeTimer);
    setOpen(true);
  };
  const closeSoon = () => {
    clearClose(closeTimer);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setPeekShown(false);
    }, CLOSE_DELAY_MS);
  };
  const showPeek = (f: ContextFile, row: HTMLElement) => {
    const railEl = railRef.current;
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (!railEl || !anchor) return;
    const rail = railEl.getBoundingClientRect();
    const padBottom = parseFloat(getComputedStyle(railEl).paddingBottom) || 0;
    setPeek({
      path: f.path,
      rowTop: row.getBoundingClientRect().top - 6 - anchor.top,
      min: rail.top + PEEK_EDGE - anchor.top,
      max: rail.bottom - padBottom - anchor.top,
    });
    setPeekShown(true);
  };
  // The window covers the page, so the hover panel behind it goes.
  const openDetail = (f: ContextFile) => {
    clearClose(closeTimer);
    setOpen(false);
    setPeekShown(false);
    setDetail(f.path);
  };
  const closeDetail = () => {
    setDetail(null);
    capsuleRef.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    setOpen(false);
    setPeekShown(false);
    capsuleRef.current?.focus();
  };

  const peeked = peek ? files.find(f => f.path === peek.path) : undefined;
  const detailed = detail ? files.find(f => f.path === detail) : undefined;
  const maxDots = railH > 0 ? Math.max(4, Math.floor((railH - RAIL_CHROME) / DOT_PITCH)) : Infinity;

  return (
    <nav className="cl-ctx-rail" aria-label="Files read" ref={railRef}>
      <div
        className={`cl-ctx-anchor${open ? ' is-open' : ''}`}
        ref={anchorRef}
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        onKeyDown={onKeyDown}
      >
        <button
          type="button"
          ref={capsuleRef}
          className="cl-ctx-capsule"
          aria-expanded={open}
          aria-label={`${files.length} files read`}
          onClick={() => setOpen(o => !o)}
        >
          <span className="cl-ctx-cap-label" aria-hidden>
            READING
          </span>
          <Dots files={files} active={active} max={maxDots} />
          <span className="cl-ctx-total" aria-hidden>
            {files.length}
          </span>
        </button>

        {/* Always mounted, so closing can animate: shut, it is inert — out of
            the tab order and the accessibility tree — and invisible. */}
        <div
          className={`cl-ctx-panel${open ? ' is-open' : ''}`}
          style={railH > 0 ? { maxHeight: railH - 60 } : undefined}
          inert={!open}
          onMouseLeave={() => setPeekShown(false)}
        >
          <div className="cl-ctx-panel-head">
            <span>Files read</span>
            <span className="n">{files.length}</span>
          </div>
          <div className="cl-ctx-panel-list">
            {groups.map(g => (
              <div key={g.key} className="cl-ctx-group">
                <span className="cl-ctx-group-label" title={g.title}>
                  {g.label}
                </span>
                {g.files.map(f => (
                  <FileRowButton
                    key={f.path}
                    file={f}
                    active={active.has(f.path)}
                    peeked={peekShown && peek?.path === f.path}
                    onPeek={el => showPeek(f, el)}
                    onOpen={() => openDetail(f)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {peek && peeked && (
          <ReadPeek
            file={peeked}
            place={peek}
            shown={open && peekShown}
            turn={turnOf(peeked.reads[peeked.reads.length - 1].idx)}
          />
        )}
      </div>

      {detailed && (
        <ContextFileSheet
          key={detailed.path}
          file={detailed}
          turnOf={turnOf}
          onJump={onJump}
          onClose={closeDetail}
        />
      )}
    </nav>
  );
}

function clearClose(timer: { current: number | null }) {
  if (timer.current !== null) window.clearTimeout(timer.current);
  timer.current = null;
}

/** One dot per file. Past what the rail can hold, the most recently read win
 *  and the rest are counted at the top — the ones read last are the ones the
 *  reader is most likely to be looking for. */
function Dots({ files, active, max }: { files: ContextFile[]; active: Set<string>; max: number }) {
  const shown = useMemo(() => {
    if (files.length <= max) return files;
    const keep = new Set(
      [...files]
        .sort((a, b) => b.reads[b.reads.length - 1].idx - a.reads[a.reads.length - 1].idx)
        .slice(0, max - 1)
    );
    return files.filter(f => keep.has(f));
  }, [files, max]);
  const hidden = files.length - shown.length;
  return (
    <span className="cl-ctx-dots" aria-hidden>
      {hidden > 0 && <span className="cl-ctx-more">+{hidden}</span>}
      {shown.map(f => (
        <span
          key={f.path}
          className={`cl-ctx-dot${active.has(f.path) ? ' is-active' : ''}`}
          style={{ '--ft': fileCategoryTint(f.ext) } as CSSProperties}
        />
      ))}
    </span>
  );
}

function FileRowButton({
  file,
  active,
  peeked,
  onPeek,
  onOpen,
}: {
  file: ContextFile;
  active: boolean;
  peeked: boolean;
  onPeek: (el: HTMLElement) => void;
  onOpen: () => void;
}) {
  const name = fileName(file.path);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return (
    <button
      type="button"
      className={`cl-ctx-row${active ? ' is-active' : ''}${peeked ? ' is-peeked' : ''}`}
      style={{ '--ft': fileCategoryTint(file.ext) } as CSSProperties}
      onMouseEnter={e => onPeek(e.currentTarget)}
      onFocus={e => onPeek(e.currentTarget)}
      onClick={onOpen}
    >
      <FileIcon ext={file.ext} />
      <span className="name">
        {stem}
        {ext && <span className="ext">{ext}</span>}
      </span>
    </button>
  );
}

/** The lines the last read of a file put on screen, on the same frosted paper
 *  as the list beside it: the name, which lines, the turn, the rows — nothing
 *  else. How many reads and by what command are the file's window's to say. */
function ReadPeek({
  file,
  place,
  shown,
  turn,
}: {
  file: ContextFile;
  place: Peek;
  shown: boolean;
  turn: number | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const last = file.reads[file.reads.length - 1];
  const span = spanLabel(last.span);
  // Beside the row, pushed up when its real height would run under the pill.
  // Measured before paint, set on the node: its height is the rows it holds.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const top = Math.max(place.min, Math.min(place.rowTop, place.max - el.offsetHeight));
    el.style.top = `${top}px`;
  }, [place, last]);
  return (
    <div
      ref={ref}
      className={`cl-ctx-peek${shown ? ' is-open' : ''}`}
      role="tooltip"
      aria-hidden={!shown}
    >
      <div className="cl-ctx-peek-head">
        <FileIcon ext={file.ext} />
        <b className="cl-ctx-peek-name">{fileName(file.path)}</b>
        {span && <span className="cl-ctx-peek-span">{span}</span>}
        {turn !== null && <span className="cl-ctx-peek-turn">turn {turn}</span>}
      </div>
      {/* A compound command's output comes unnumbered (readRows): it is what
          the model saw, not this file's lines, and it is still the preview. */}
      <ReadLines read={last} ext={file.ext} max={PEEK_ROWS} />
    </div>
  );
}
