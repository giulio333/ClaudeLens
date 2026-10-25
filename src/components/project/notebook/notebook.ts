import type { ActiveSession, SessionActivity, Task } from '../../../types';
import { memoryScopeOf, toolRunStatus } from '../chat/utils';
import type { ToolGroup } from '../chat/utils';
import { buildFileChanges } from '../terminal/mission-feed';
import type { FileChange } from '../terminal/mission-feed';

// The Notebook's reading of one session: what it is doing, where it is in its
// plan, what it changed and whether the checks hold. Pure and separate from the
// view (the repo's fast-refresh rule, and this is the part worth pinning down).
//
// It states only what the transcript, the registry and the task files record.
// The "why" is a call's own `description` or the task it belongs to, and where
// neither exists nothing is said: no sentence is ever derived from a command or
// a path (the #236 rule). A result that has not come back is pending, never a
// success, and tasks carry no timestamps, so none are shown.

export type NotebookState = 'blocked' | 'working' | 'ready' | 'ended';

export interface Headline {
  /** The sentence, or its lead when `subject` follows. */
  lead: string;
  /** The file, pattern or tool it acts on, set in code. */
  subject: string | null;
}

export type RunOutcome = 'pass' | 'fail' | 'pending';

export interface Check {
  command: string;
  /** Oldest first. */
  runs: RunOutcome[];
  /** The last run's outcome. */
  verdict: RunOutcome;
}

export interface PlanView {
  tasks: Pick<Task, 'id' | 'subject' | 'status'>[];
  /** Index of the task being worked on; -1 when there is none (all done, or no
   *  tasks at all). */
  current: number;
  /** What it is doing right now: the task's own `activeForm`, else its subject. */
  nowLabel: string | null;
  next: string | null;
  done: number;
}

export interface NotebookModel {
  state: NotebookState;
  headline: Headline;
  /** The call's `description`, or the sub-agent's question; null when absent. */
  note: string | null;
  /** What the note is: printed as its small label. */
  noteKind: 'its note' | 'command' | 'asked' | 'last result' | 'waiting on' | null;
  plan: PlanView;
  changes: FileChange[];
  totals: { added: number; removed: number };
  /** The path of the file the call in flight is writing, when it is one. */
  liveFile: string | null;
  checks: Check[];
  /** Files read and never changed, relative to the project root. */
  reads: string[];
  failedCalls: number;
}

const READ_TOOLS = new Set(['Read']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob']);
const AGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

/** A shell command that answers "does it still hold": tests, types, lint, format,
 *  build. Every other command (`ls`, `git status`, `cat`) is the agent looking
 *  around, not a verdict, and would bury the few that are. */
const CHECK_COMMAND =
  /\b(vitest|jest|pytest|mocha|tsc|typecheck|eslint|lint|prettier|format|ruff|mypy|clippy)\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build)\b|\b(cargo|go)\s+(test|build|check|vet)\b/;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

export const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

function inputOf(g: ToolGroup): Record<string, unknown> {
  return g.use.input ?? {};
}

export function descriptionOf(g: ToolGroup): string | null {
  const d = flat(str(inputOf(g).description));
  return d || null;
}

function outcomeOf(g: ToolGroup): RunOutcome {
  // `toolRunStatus` is the app's own reading of a call: no result is Pending.
  const tone = toolRunStatus(g.result, g.use.name).tone;
  return tone === 'is-pending' ? 'pending' : tone === 'is-error' ? 'fail' : 'pass';
}

/** Every distinct check command and its run history, in order of first run. */
export function buildChecks(groups: ToolGroup[]): Check[] {
  const byCommand = new Map<string, RunOutcome[]>();
  for (const g of groups) {
    if (g.use.name !== 'Bash') continue;
    const command = flat(str(inputOf(g).command));
    if (!command || !CHECK_COMMAND.test(command)) continue;
    const runs = byCommand.get(command) ?? [];
    runs.push(outcomeOf(g));
    byCommand.set(command, runs);
  }
  return [...byCommand].map(([command, runs]) => ({
    command,
    runs,
    verdict: runs[runs.length - 1],
  }));
}

export function buildPlan(tasks: Task[]): PlanView {
  const list = tasks.map(t => ({ id: t.id, subject: t.subject, status: t.status }));
  let current = list.findIndex(t => t.status === 'in_progress');
  if (current === -1) current = list.findIndex(t => t.status === 'pending');
  const task = current >= 0 ? tasks[current] : null;
  const next = current >= 0 ? list.slice(current + 1).find(t => t.status === 'pending') : null;
  return {
    tasks: list,
    current,
    nowLabel: task ? flat(task.activeForm ?? '') || task.subject : null,
    next: next?.subject ?? null,
    done: list.filter(t => t.status === 'completed').length,
  };
}

/** The call, said as one sentence. A Bash call leads with its own description
 *  when it has one; without it the command is the subject, never a paraphrase. */
export function describeCall(g: ToolGroup): Headline {
  const input = inputOf(g);
  const name = g.use.name;
  const file = str(input.file_path ?? input.notebook_path ?? input.path);
  if (READ_TOOLS.has(name) && file) return { lead: 'Reading', subject: baseName(file) };
  if (EDIT_TOOLS.has(name) && file) return { lead: 'Editing', subject: baseName(file) };
  if (name === 'Write' && file) return { lead: 'Writing', subject: baseName(file) };
  if (SEARCH_TOOLS.has(name)) {
    const pattern = flat(str(input.pattern));
    return { lead: 'Searching for', subject: pattern || null };
  }
  if (name === 'Bash') {
    const description = descriptionOf(g);
    if (description) return { lead: description, subject: null };
    return { lead: 'Running', subject: flat(str(input.command)).slice(0, 80) || null };
  }
  if (AGENT_TOOL_NAMES.has(name)) {
    const kind = flat(str(input.subagent_type));
    return { lead: kind ? `Asking ${kind}` : 'Asking an agent', subject: null };
  }
  return { lead: name, subject: null };
}

/** A path relative to the project root, or the path itself outside it. */
export function relativeTo(path: string, root: string): string {
  const norm = path.replace(/\\/g, '/');
  const base = root.replace(/\\/g, '/').replace(/\/$/, '');
  return base && norm.startsWith(base + '/') ? norm.slice(base.length + 1) : norm;
}

export interface NotebookInput {
  /** Tool calls of the session itself, sub-agent dispatches excluded. */
  ownTools: ToolGroup[];
  tasks: Task[];
  active: ActiveSession | undefined;
  activity: SessionActivity | undefined;
  realPath: string;
}

function stateOf(active: ActiveSession | undefined, activity: SessionActivity | undefined) {
  if (!active) return 'ended' as const;
  if (active.status === 'waiting') return 'blocked' as const;
  if (active.status === 'busy' || (activity?.delegates.length ?? 0) > 0) return 'working' as const;
  return 'ready' as const;
}

export function buildNotebook(input: NotebookInput): NotebookModel {
  const { ownTools, tasks, active, activity, realPath } = input;
  const state = stateOf(active, activity);
  const changes = buildFileChanges(ownTools).filter(c => c.deleted || !memoryScopeOf(c.path));
  const totals = changes.reduce(
    (acc, c) => ({ added: acc.added + c.added, removed: acc.removed + c.removed }),
    { added: 0, removed: 0 }
  );
  const checks = buildChecks(ownTools);
  const changed = new Set(changes.map(c => c.path));
  const reads = [
    ...new Set(
      ownTools
        .filter(g => READ_TOOLS.has(g.use.name))
        .map(g => str(inputOf(g).file_path))
        .filter(p => p && !changed.has(p))
        .map(p => relativeTo(p, realPath))
    ),
  ];
  const failedCalls = ownTools.filter(g => outcomeOf(g) === 'fail').length;
  const plan = buildPlan(tasks);

  const last = ownTools[ownTools.length - 1] ?? null;
  // The tail says a call is in flight; the transcript says which. Until the
  // transcript has caught up, the digest's own pair is all there is.
  const inFlight = activity?.lastTool ?? null;
  const delegates = activity?.delegates ?? [];
  const base = {
    plan,
    changes,
    totals,
    checks,
    reads,
    failedCalls,
    state,
    liveFile: null as string | null,
  };

  if (state === 'blocked') {
    const waitingFor = active?.waitingFor ?? '';
    return {
      ...base,
      headline: { lead: 'Waiting for you', subject: null },
      note:
        waitingFor === 'input needed'
          ? 'a question is waiting for your answer'
          : waitingFor || null,
      noteKind: waitingFor ? 'waiting on' : null,
    };
  }
  if (state === 'ready' || state === 'ended') {
    const green = checks.filter(c => c.verdict === 'pass').length;
    return {
      ...base,
      headline: {
        lead: state === 'ended' ? 'Session ended' : 'Finished its turn',
        subject: null,
      },
      note: checks.length ? `${green} of ${checks.length} checks end green` : null,
      noteKind: checks.length ? 'last result' : null,
    };
  }
  if (delegates.length > 0) {
    const names = delegates.map(d => d.name).join(', ');
    const dispatch = [...ownTools].reverse().find(g => AGENT_TOOL_NAMES.has(g.use.name));
    const question = dispatch ? descriptionOf(dispatch) : null;
    return {
      ...base,
      headline: { lead: `Waiting for ${names}`, subject: null },
      note: question,
      noteKind: question ? 'asked' : null,
    };
  }
  if (inFlight && last && last.use.name === inFlight.name) {
    const path = str(inputOf(last).file_path);
    // A Bash call's description is already the sentence, so the note carries
    // the command; without a description the command is the sentence and the
    // note stays empty rather than say it twice.
    const description = descriptionOf(last);
    const command = last.use.name === 'Bash' ? flat(str(inputOf(last).command)) : '';
    const note = last.use.name === 'Bash' ? (description ? command : null) : description;
    return {
      ...base,
      headline: describeCall(last),
      note,
      noteKind: !note ? null : last.use.name === 'Bash' ? 'command' : 'its note',
      liveFile: path && changed.has(path) ? path : null,
    };
  }
  if (inFlight) {
    return {
      ...base,
      headline: { lead: inFlight.name, subject: inFlight.arg || null },
      note: null,
      noteKind: null,
    };
  }
  const lastCheck = [...checks].reverse().find(c => c.verdict !== 'pending');
  return {
    ...base,
    headline: { lead: 'Thinking', subject: null },
    note: lastCheck
      ? `${lastCheck.verdict === 'fail' ? 'failed' : 'passed'}: ${lastCheck.command}`
      : null,
    noteKind: lastCheck ? 'last result' : null,
  };
}
