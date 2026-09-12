// What the global home says is happening in `~/.claude` right now: the pure
// half of the welcome, kept out of the view so a hook file stays a hook file
// (fast refresh only survives a module that exports components alone) and so
// the sentences can be asserted directly — see `test/global-home-live.test.ts`.
import { projectDisplayName } from '../shared/projectName';
import { provisionalProjectHash } from '../shared/projectHash';

export type Project = { hash: string; realPath: string };

/**
 * The three states a live session can be in, and the only three the registry
 * distinguishes. `open` is the one the welcome used to be blind to: a session
 * whose turn has finished is alive but is not doing anything, and calling it
 * "working right now" claimed work nobody was doing. The Monitor has always
 * told the three apart (`isReady`/`doingOf` in `monitor/MonitorView.tsx`); this
 * is the same reading, in the welcome's words.
 *
 * `unknown` — a registry file written before its first status, seen on a
 * brand-new session — reads as `open` for the same reason it does there: a
 * session that has never reported anything has not been observed working.
 */
export type LiveState = 'working' | 'waiting' | 'open';

export type LiveRow = {
  project: Project;
  name: string;
  live: LiveState;
};

function stateOf(status: string): LiveState {
  if (status === 'waiting') return 'waiting';
  if (status === 'busy') return 'working';
  return 'open';
}

// Which state wins when one cwd has several processes: the one that asks the
// most of you. Waiting is blocked on you, working is in flight, open is neither.
const PRIORITY: Record<LiveState, number> = { waiting: 2, working: 1, open: 0 };

// One row per cwd, not per process: a project with two claude processes is
// still one line in the welcome. Rows come out in priority order, so the two
// the hero has room for are the two that matter.
export function liveRowsFromProcs(
  procs: { cwd: string; status: string }[],
  projectByPath: Map<string, Project>
): LiveRow[] {
  const byPath = new Map<string, LiveRow>();
  for (const p of procs) {
    const project = projectByPath.get(p.cwd) ?? {
      hash: provisionalProjectHash(p.cwd),
      realPath: p.cwd,
    };
    const live = stateOf(p.status);
    const existing = byPath.get(p.cwd);
    if (!existing) {
      byPath.set(p.cwd, { project, name: projectDisplayName(p.cwd), live });
    } else if (PRIORITY[live] > PRIORITY[existing.live]) {
      existing.live = live;
    }
  }
  return [...byPath.values()].sort((a, b) => PRIORITY[b.live] - PRIORITY[a.live]);
}

// The one sentence that replaces the old figures strip + live-process table:
// what is in flight, what is blocked on you, what is merely open — and, by name
// wherever a single project owns a clause, because a name is the one thing a
// count can't say.
export function welcomeLine(live: LiveRow[]): string {
  if (live.length === 0) return 'Nothing is running right now.';
  const working = live.filter(r => r.live === 'working');
  const waiting = live.filter(r => r.live === 'waiting');
  const open = live.filter(r => r.live === 'open');

  const parts: string[] = [];
  if (working.length === 1) parts.push(`${working[0].name} is working right now.`);
  else if (working.length > 1) parts.push(`${working.length} projects are working right now.`);

  if (waiting.length === 1) parts.push(`${waiting[0].name} is waiting on you.`);
  else if (waiting.length > 1) parts.push(`${waiting.length} are waiting on you.`);

  if (parts.length === 0) {
    parts.push(
      open.length === 1
        ? `${open[0].name} is open — your move.`
        : `${open.length} projects are open, none of them working.`
    );
  } else if (open.length > 0) {
    parts.push(open.length === 1 ? '1 more is open.' : `${open.length} more are open.`);
  }
  return parts.join(' ');
}

/**
 * Il verbo dice *perché* andarci, che è l'unica cosa che il nome del progetto
 * non dice già. `watch` e non `open` su una sessione che gira: aprirla non è
 * quello che fai — sta lavorando, la guardi — e soprattutto `open` è la parola
 * con cui la frase sopra chiama l'altro stato («2 projects are open»), due
 * significati diversi a due righe di distanza. `resume` è il verbo di Claude
 * Code stesso per tornare su una sessione ferma, e `answer` è letteralmente
 * quello che la riga bloccata ti chiede.
 */
export const ACTION: Record<LiveState, string> = {
  waiting: 'answer →',
  working: 'watch →',
  open: 'resume →',
};
