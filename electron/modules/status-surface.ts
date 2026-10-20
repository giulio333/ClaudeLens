// What the menu bar and the Dock say about the sessions open in ClaudeLens, from
// the summary the renderer sends (`electron/shared/status-surface.ts`). Pure: the
// Tray, the badge and the progress bar are driven from main.ts.
//
// The rule is the tabs' own: while Claude works the signal is quiet (a spinner,
// a bar on the icon), and what needs the user is said in words and counted until
// it is answered.

import {
  STATUS_TONES,
  type StatusRow,
  type StatusSummary,
  type StatusTone,
} from '../shared/status-surface';

// More tabs than anyone keeps open, and longer than any title the menu can show.
const MAX_ROWS = 50;
const MAX_TEXT = 120;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}

function text(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new Error(`Status summary: ${field} is not a string`);
  return v.slice(0, MAX_TEXT);
}

function parseRow(v: unknown): StatusRow {
  if (!isPlainObject(v)) throw new Error('Status summary: a row is not an object');
  if (!(STATUS_TONES as readonly unknown[]).includes(v.tone)) {
    throw new Error('Status summary: unknown tone');
  }
  return {
    id: text(v.id, 'id'),
    title: text(v.title, 'title'),
    project: text(v.project, 'project'),
    tone: v.tone as StatusTone,
    question: v.question === true,
    unseen: v.unseen === true,
  };
}

/** The summary as sent, or null — no session open — to clear the menu bar and
 *  the Dock. Throws on a shape the renderer never sends: the IPC handler
 *  answers that as an error, and the surfaces keep what they had. */
export function parseStatusSummary(input: unknown): StatusSummary | null {
  if (input === null || input === undefined) return null;
  if (!isPlainObject(input) || !Array.isArray(input.rows)) {
    throw new Error('Status summary: not a summary');
  }
  const rows = input.rows.slice(0, MAX_ROWS).map(parseRow);
  return rows.length ? { rows } : null;
}

const ROW_STATE: Record<StatusTone, string> = {
  starting: 'Starting',
  busy: 'Working',
  waiting: 'Waiting for you',
  idle: 'Your turn',
  // "Lens only" is the app's word; outside the window it says nothing.
  lens: 'No terminal open',
  ended: 'Ended',
};

/** A session's state on its menu row, as its tab's label words it. */
export function rowState(r: StatusRow): string {
  if (r.tone === 'waiting' && r.question) return 'Asks you a question';
  if (r.unseen) return 'Finished, not seen yet';
  return ROW_STATE[r.tone];
}

/** Where a row goes in the menu, what needs the user on top: a wait, a turn in
 *  flight, a turn that ended unseen, a turn to take, the rest. */
function rowRank(r: StatusRow): number {
  if (r.tone === 'waiting') return 0;
  if (r.tone === 'busy') return 1;
  if (r.unseen) return 2;
  return r.tone === 'idle' ? 3 : 4;
}
const ROW_MARK = ['●', '◐', '✓', '○', '◌'];

// Past this a title pushes the menu across the screen.
const MAX_TITLE = 45;

function shortTitle(title: string): string {
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1).trimEnd()}…` : title;
}

export interface TrayItem {
  id: string;
  /** The state's mark and the session's title. */
  label: string;
  /** The state in words, and the project. */
  sublabel: string;
}

export interface TrayModel {
  /** The menu bar's words for what most needs the user; '' when nothing does. */
  words: string;
  /** The mark before the words; null while it spins. */
  mark: string | null;
  /** Claude works and nothing needs the user: the mark is a spinner. */
  spinning: boolean;
  /** Every open session, what needs the user first, else in the tabs' order. */
  items: TrayItem[];
}

/** Whether the menu draws a row's second line: macOS 14.4 and later. Before it
 *  a sublabel is dropped without a word, and the state would go with it. */
export function sublabelsShown(macosVersion: string): boolean {
  const [major = 0, minor = 0] = macosVersion.split('.').map(Number);
  return major > 14 || (major === 14 && minor >= 4);
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}

/** The menu bar item: a wait first, then a turn in flight, then a turn that
 *  ended out of sight; an open session that needs nothing leaves the icon alone. */
export function trayModel(s: StatusSummary): TrayModel {
  // `sort` is stable: within a rank the tabs keep their order.
  const items = [...s.rows]
    .sort((a, b) => rowRank(a) - rowRank(b))
    .map(r => ({
      id: r.id,
      label: `${ROW_MARK[rowRank(r)]}  ${shortTitle(r.title)}`,
      sublabel: `${rowState(r)} · ${r.project}`,
    }));
  const waiting = s.rows.filter(r => r.tone === 'waiting');
  if (waiting.length) {
    const one = waiting[0].question ? 'Asks you' : 'Waiting for you';
    return { words: count(waiting.length, one, 'waiting'), mark: '●', spinning: false, items };
  }
  const busy = s.rows.filter(r => r.tone === 'busy').length;
  if (busy) return { words: count(busy, 'Working', 'working'), mark: null, spinning: true, items };
  const unseen = s.rows.filter(r => r.unseen).length;
  if (unseen) return { words: count(unseen, 'Done', 'done'), mark: '✓', spinning: false, items };
  return { words: '', mark: null, spinning: false, items };
}

const SPINNER = ['◐', '◓', '◑', '◒'];

/** The menu bar's text beside the icon, at one frame of the spinner. The
 *  leading space keeps it off the icon. */
export function trayTitle(m: TrayModel, frame: number): string {
  if (!m.words) return '';
  const mark = m.spinning ? SPINNER[frame % SPINNER.length] : m.mark;
  return ` ${mark} ${m.words}`;
}

/** The ids of the sessions waiting for the user. */
export function waitingIds(s: StatusSummary | null): Set<string> {
  return new Set(s?.rows.filter(r => r.tone === 'waiting').map(r => r.id) ?? []);
}

/** A session started waiting since the last summary: the one moment worth a
 *  bounce. A wait that goes on is not new, and one answered is not either. */
export function hasNewWait(prev: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
  for (const id of next) if (!prev.has(id)) return true;
  return false;
}

export function isWorking(s: StatusSummary | null): boolean {
  return !!s?.rows.some(r => r.tone === 'busy');
}

/** The Dock's badge: how many sessions wait for the user, which stays until
 *  they are answered; with none, the notifications sent while the window was
 *  in the background, as it always counted. */
export function dockBadgeText(waiting: number, notifications: number): string {
  if (waiting > 0) return String(waiting);
  return notifications > 0 ? String(notifications) : '';
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// The brand mark's strokes on a 16-unit grid, read off `public/brand-mark.png`:
// a lens and three short rays at its upper left. The rays are what tell it from
// the system's own magnifier, which a bare lens is in the menu bar.
const MARK_RING = { cx: 9.1, cy: 7.2, r: 3.2, half: 0.78 };
const MARK_STROKES: readonly [number, number, number, number, number][] = [
  [11.5, 9.9, 14.1, 12.8, 0.95], // the handle
  [5.1, 0.9, 5.6, 3.0, 0.7], // the rays, top to left, clear of the ring
  [1.9, 3.2, 3.8, 4.8, 0.7],
  [1.3, 6.4, 3.5, 6.6, 0.7],
];

/** How far a point (in grid units) is outside the mark; negative inside. */
function markDistance(px: number, py: number): number {
  let d = Math.abs(Math.hypot(px - MARK_RING.cx, py - MARK_RING.cy) - MARK_RING.r) - MARK_RING.half;
  for (const [ax, ay, bx, by, half] of MARK_STROKES) {
    d = Math.min(d, segmentDistance(px, py, ax, ay, bx, by) - half);
  }
  return d;
}

/** The menu bar's icon, ClaudeLens's mark, as the pixels of a template image,
 *  `size` px square: four bytes a pixel, black, the shape in the alpha (so BGRA
 *  and RGBA read the same). macOS tints a template image for the menu bar it
 *  sits in, light or dark. The edge is the shape's distance to the pixel's
 *  centre, which antialiases it. */
export function brandMarkGlyph(size: number): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const u = size / 16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = markDistance((x + 0.5) / u, (y + 0.5) / u);
      const alpha = Math.max(0, Math.min(1, 0.5 - d * u));
      buf[(y * size + x) * 4 + 3] = Math.round(alpha * 255);
    }
  }
  return buf;
}
