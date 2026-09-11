import { describe, it, expect } from 'vitest';
import {
  liveRowsFromProcs,
  welcomeLine,
  type LiveRow,
  type Project,
} from '../src/components/project/overview/live-rows';

// The welcome used to know two states — `waiting` and everything-else — and
// called everything-else "working right now". A session whose turn has finished
// is alive but idle, so the home was claiming work nobody was doing (the user's
// two "working" projects were both sitting at a prompt). The registry has always
// distinguished three, and the Monitor has always read all three; these tests
// pin the welcome to the same reading.

const projects: Project[] = [
  { hash: '-Users-x-ClaudeLens', realPath: '/Users/x/ClaudeLens' },
  { hash: '-Users-x-Personal', realPath: '/Users/x/Personal' },
  { hash: '-Users-x-SARA', realPath: '/Users/x/SARA' },
];
const byPath = new Map(projects.map(p => [p.realPath, p]));

function rows(...procs: { cwd: string; status: string }[]): LiveRow[] {
  return liveRowsFromProcs(procs, byPath);
}
const at = (name: string, status: string) => ({ cwd: `/Users/x/${name}`, status });

describe('liveRowsFromProcs — the three states', () => {
  it('reads `busy` as working and `waiting` as waiting', () => {
    const [a, b] = rows(at('ClaudeLens', 'busy'), at('Personal', 'waiting'));
    expect(b.live).toBe('working');
    expect(a.live).toBe('waiting');
  });

  it('reads `idle` as open, not as working', () => {
    expect(rows(at('ClaudeLens', 'idle'))[0].live).toBe('open');
  });

  it('reads `unknown` as open — a session that never reported is not working', () => {
    expect(rows(at('ClaudeLens', 'unknown'))[0].live).toBe('open');
  });

  it('collapses several processes of one cwd into one row', () => {
    expect(rows(at('ClaudeLens', 'idle'), at('ClaudeLens', 'busy'))).toHaveLength(1);
  });

  it('keeps the state that asks the most of you when a cwd has several', () => {
    expect(rows(at('ClaudeLens', 'idle'), at('ClaudeLens', 'busy'))[0].live).toBe('working');
    expect(rows(at('ClaudeLens', 'busy'), at('ClaudeLens', 'waiting'))[0].live).toBe('waiting');
    expect(rows(at('ClaudeLens', 'waiting'), at('ClaudeLens', 'idle'))[0].live).toBe('waiting');
  });

  it('orders rows by what matters, so the hero shows the top two', () => {
    const out = rows(at('ClaudeLens', 'idle'), at('Personal', 'busy'), at('SARA', 'waiting'));
    expect(out.map(r => r.live)).toEqual(['waiting', 'working', 'open']);
  });

  it('names a cwd that has no project folder yet', () => {
    const [row] = liveRowsFromProcs([{ cwd: '/Users/x/Fresh', status: 'busy' }], byPath);
    expect(row.name).toBe('Fresh');
    expect(row.project.realPath).toBe('/Users/x/Fresh');
  });
});

describe('welcomeLine', () => {
  it('says nothing is running when nothing is', () => {
    expect(welcomeLine([])).toBe('Nothing is running right now.');
  });

  it('does not call an idle session work — the bug this all starts from', () => {
    const line = welcomeLine(rows(at('ClaudeLens', 'idle'), at('Personal', 'idle')));
    expect(line).not.toMatch(/working right now/);
    expect(line).toBe('2 projects are open, none of them working.');
  });

  it('names the single open project instead of counting it', () => {
    expect(welcomeLine(rows(at('ClaudeLens', 'idle')))).toBe('ClaudeLens is open — your move.');
  });

  it('names the single working project', () => {
    expect(welcomeLine(rows(at('ClaudeLens', 'busy')))).toBe('ClaudeLens is working right now.');
  });

  it('counts working projects past the first', () => {
    expect(welcomeLine(rows(at('ClaudeLens', 'busy'), at('Personal', 'busy')))).toBe(
      '2 projects are working right now.'
    );
  });

  it('names the one project that is waiting on you', () => {
    expect(welcomeLine(rows(at('ClaudeLens', 'busy'), at('Personal', 'waiting')))).toBe(
      'ClaudeLens is working right now. Personal is waiting on you.'
    );
  });

  it('counts the waiting ones past the first', () => {
    expect(
      welcomeLine(rows(at('ClaudeLens', 'busy'), at('Personal', 'waiting'), at('SARA', 'waiting')))
    ).toBe('ClaudeLens is working right now. 2 are waiting on you.');
  });

  it('accounts for the merely-open ones without calling them work', () => {
    expect(welcomeLine(rows(at('ClaudeLens', 'busy'), at('Personal', 'idle')))).toBe(
      'ClaudeLens is working right now. 1 more is open.'
    );
  });

  it('says only what is true when nothing is working and nothing is blocked', () => {
    expect(welcomeLine(rows(at('ClaudeLens', 'unknown')))).toBe('ClaudeLens is open — your move.');
  });
});
