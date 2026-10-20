// The menu bar and the Dock, from the summary the renderer sends: what arrives is
// checked, what most needs the user is said in words, the waits are counted
// until answered, and only a wait that is new is worth a bounce.
import { expect, it } from 'vitest';
import {
  brandMarkGlyph,
  dockBadgeText,
  hasNewWait,
  isWorking,
  parseStatusSummary,
  rowState,
  sublabelsShown,
  trayModel,
  trayTitle,
  waitingIds,
} from '../electron/modules/status-surface';
import type { StatusRow, StatusSummary } from '../electron/shared/status-surface';

const row = (id: string, patch: Partial<StatusRow> = {}): StatusRow => ({
  id,
  title: `Session ${id}`,
  project: 'acme',
  tone: 'idle',
  question: false,
  unseen: false,
  ...patch,
});
const summary = (...rows: StatusRow[]): StatusSummary => ({ rows });

it('takes null and an empty list as "no session open"', () => {
  expect(parseStatusSummary(null)).toBeNull();
  expect(parseStatusSummary(undefined)).toBeNull();
  expect(parseStatusSummary({ rows: [] })).toBeNull();
});

it('keeps a well-formed row, with its flags read strictly', () => {
  const parsed = parseStatusSummary({
    rows: [{ id: 't1', title: 'Fix', project: 'acme', tone: 'waiting', question: 1, unseen: true }],
  });
  expect(parsed).toEqual(
    summary(row('t1', { title: 'Fix', tone: 'waiting', question: false, unseen: true }))
  );
});

it('refuses a shape the renderer never sends', () => {
  expect(() => parseStatusSummary('rows')).toThrow(/not a summary/);
  expect(() => parseStatusSummary({ rows: 'x' })).toThrow(/not a summary/);
  expect(() => parseStatusSummary({ rows: [null] })).toThrow(/not an object/);
  expect(() => parseStatusSummary({ rows: [{ ...row('t1'), tone: 'sleeping' }] })).toThrow(
    /unknown tone/
  );
  expect(() => parseStatusSummary({ rows: [{ ...row('t1'), title: 7 }] })).toThrow(/title/);
  expect(() => parseStatusSummary(new Map())).toThrow(/not a summary/);
});

it('caps the rows and the text it keeps', () => {
  const rows = Array.from({ length: 80 }, (_, i) => row(`t${i}`, { title: 'x'.repeat(500) }));
  const parsed = parseStatusSummary({ rows })!;
  expect(parsed.rows).toHaveLength(50);
  expect(parsed.rows[0].title).toHaveLength(120);
});

it('says a wait first, by what it waits on, and counts several', () => {
  const ask = trayModel(
    summary(row('a', { tone: 'busy' }), row('b', { tone: 'waiting', question: true }))
  );
  expect(ask).toMatchObject({ words: 'Asks you', mark: '●', spinning: false });
  expect(trayModel(summary(row('b', { tone: 'waiting' }))).words).toBe('Waiting for you');
  const two = trayModel(summary(row('a', { tone: 'waiting' }), row('b', { tone: 'waiting' })));
  expect(two.words).toBe('2 waiting');
});

it('spins while Claude works and nothing needs the user, then says what ended unseen', () => {
  expect(trayModel(summary(row('a', { tone: 'busy' }), row('b', { unseen: true })))).toMatchObject({
    words: 'Working',
    spinning: true,
  });
  expect(trayModel(summary(row('a', { tone: 'busy' }), row('b', { tone: 'busy' }))).words).toBe(
    '2 working'
  );
  expect(trayModel(summary(row('a', { unseen: true })))).toMatchObject({
    words: 'Done',
    mark: '✓',
  });
  expect(trayModel(summary(row('a')))).toMatchObject({ words: '', spinning: false });
});

it('lists what needs the user first, each row its state’s mark and title over its words', () => {
  const model = trayModel(
    summary(
      row('a', { title: 'Tidy', tone: 'lens' }),
      row('b', { title: 'Docs', unseen: true, project: 'zeta' }),
      row('c', { title: 'Next', tone: 'idle' }),
      row('d', { title: 'Build', tone: 'busy' }),
      row('e', { title: 'Fix', tone: 'waiting', question: true }),
      row('f', { title: 'Later', tone: 'busy' })
    )
  );
  expect(model.items).toEqual([
    { id: 'e', label: '●  Fix', sublabel: 'Asks you a question · acme' },
    // Within a rank the tabs keep their order.
    { id: 'd', label: '◐  Build', sublabel: 'Working · acme' },
    { id: 'f', label: '◐  Later', sublabel: 'Working · acme' },
    { id: 'b', label: '✓  Docs', sublabel: 'Finished, not seen yet · zeta' },
    { id: 'c', label: '○  Next', sublabel: 'Your turn · acme' },
    { id: 'a', label: '◌  Tidy', sublabel: 'No terminal open · acme' },
  ]);
  expect(rowState(row('g', { tone: 'waiting' }))).toBe('Waiting for you');
});

it('cuts a long title short, at a word’s end where it falls on a space', () => {
  const title = 'Review the retry budget used by billing and the invoice exports';
  const [item] = trayModel(summary(row('a', { title }))).items;
  expect(item.label).toBe('○  Review the retry budget used by billing and…');
  expect(trayModel(summary(row('a', { title: 'x'.repeat(45) }))).items[0].label).toBe(
    `○  ${'x'.repeat(45)}`
  );
});

it('draws the second line from macOS 14.4 on, where the menu shows it', () => {
  expect(sublabelsShown('14.4')).toBe(true);
  expect(sublabelsShown('14.4.1')).toBe(true);
  expect(sublabelsShown('15.0')).toBe(true);
  expect(sublabelsShown('27.0')).toBe(true);
  expect(sublabelsShown('14.3.1')).toBe(false);
  expect(sublabelsShown('13.6')).toBe(false);
  expect(sublabelsShown('')).toBe(false);
});

it('turns the spinner a frame at a time and leaves the icon alone when nothing is said', () => {
  const spinning = trayModel(summary(row('a', { tone: 'busy' })));
  expect([0, 1, 2, 3, 4].map(f => trayTitle(spinning, f))).toEqual([
    ' ◐ Working',
    ' ◓ Working',
    ' ◑ Working',
    ' ◒ Working',
    ' ◐ Working',
  ]);
  expect(trayTitle(trayModel(summary(row('a', { tone: 'waiting' }))), 3)).toBe(
    ' ● Waiting for you'
  );
  expect(trayTitle(trayModel(summary(row('a'))), 0)).toBe('');
});

it('bounces only for a session that started waiting since the last summary', () => {
  const before = waitingIds(summary(row('a', { tone: 'waiting' }), row('b', { tone: 'busy' })));
  expect(hasNewWait(before, waitingIds(summary(row('a', { tone: 'waiting' }))))).toBe(false);
  expect(hasNewWait(before, waitingIds(summary(row('b', { tone: 'waiting' }))))).toBe(true);
  expect(hasNewWait(before, waitingIds(null))).toBe(false);
});

it('knows when Claude works anywhere', () => {
  expect(isWorking(summary(row('a'), row('b', { tone: 'busy' })))).toBe(true);
  expect(isWorking(summary(row('a', { tone: 'waiting' })))).toBe(false);
  expect(isWorking(null)).toBe(false);
});

it('counts the waits on the Dock, else the notifications sent while away', () => {
  expect(dockBadgeText(2, 5)).toBe('2');
  expect(dockBadgeText(0, 3)).toBe('3');
  expect(dockBadgeText(0, 0)).toBe('');
});

it('draws the mark as alpha only: the ring, its handle and the three rays, clear around them', () => {
  const size = 32;
  const px = brandMarkGlyph(size);
  expect(px).toHaveLength(size * size * 4);
  // 2 px a grid unit: pixel (x, y) is centred on unit ((x + 0.5) / 2, (y + 0.5) / 2).
  const alpha = (x: number, y: number) => px[(y * size + x) * 4 + 3];
  expect(alpha(18, 7)).toBeGreaterThan(200); // the ring's top
  expect(alpha(18, 14)).toBe(0); // the lens's middle
  expect(alpha(25, 22)).toBeGreaterThan(200); // the handle
  // The rays — what tells it from the system's magnifier.
  expect(alpha(10, 5)).toBeGreaterThan(200);
  expect(alpha(5, 7)).toBeGreaterThan(200);
  expect(alpha(4, 12)).toBeGreaterThan(200);
  expect(alpha(0, 0)).toBe(0);
  expect(alpha(31, 0)).toBe(0);
  expect(alpha(0, 31)).toBe(0);
  // Black: no colour channel is ever set.
  for (let i = 0; i < px.length; i += 4) expect(px[i] | px[i + 1] | px[i + 2]).toBe(0);
});
