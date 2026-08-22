import { existsSync } from 'fs';
import { isAbsolute } from 'path';
import { execClaude, type ClaudeSpawnOptions } from './claude-cli';

// Deleting a project's Claude Code state, **delegated to the CLI**
// (`claude project purge`, the official command; documented in the CLI reference).
//
// Why we don't delete it ourselves: a project's state is not one folder. On a real
// disk a purge also touches `~/.claude/tasks/<sessionId>/` (one dir per session),
// dozens of `~/.claude/file-history/<sessionId>/`, the project's entry in
// `~/.claude.json` and — above all — `history.jsonl`, which is **filtered line by
// line** (this project's prompts among every other project's), not deleted.
// Rewriting those two files from Electron while the CLI writes them is the
// corruption this delegation avoids, and the list grows whenever Claude Code adds
// a folder: whoever owns the format is the only one who can enumerate it correctly.
//
// Two steps, both run by the CLI:
//   1. `--dry-run` produces the plan the confirmation dialog shows
//   2. `-y` executes the same purge, skipping the interactive prompt
//
// What the CLI does NOT cover (verified with real dry-runs): teams
// (`~/.claude/teams/`) and plans (`~/.claude/plans/`) survive on disk.
//
// **What this module now refuses to do, and why (#224).** The command's unit is
// not a project but a path subtree: `claude project purge <path>` deletes every
// project at or below `<path>`, registered in `~/.claude.json` or not. Verified
// again on CLI 2.1.240 in a sandbox `CLAUDE_CONFIG_DIR` — purging `<sbx>/home`
// listed the `projects/` folders of `home`, `home/ProjA` and `home/ProjB/deep`,
// sparing only the sibling `home-extra`. So on any project whose path contains
// others — a home directory above all — `purge` is `--all` under another name,
// and ClaudeLens' own dialog collapsed those rows into one (`groupItems` keyed on
// a detail that is the same constant for every project). This module now derives
// the **projects** a plan would touch and refuses to run a purge that names more
// than one; grouping is confined to entries whose detail carried a varying id.
//
// The same run also showed which line to count: `config:` appears **once**, for
// the requested project only, while `dir: …/projects/<hash>` appears once per
// project swept. The project count comes from those dirs — the config entry would
// have reported 1 while three projects were being deleted.

/** One plan entry, as the CLI prints it. `kind` is its label (`dir`, `config`, `filter`, …). */
export interface PurgePlanItem {
  kind: string;
  /** Path or selector printed by the CLI (for `config` it is `projects["…"]`, not a path). */
  target: string;
  /** The detail line under the entry, with varying ids normalised when the group holds more than one. */
  detail: string;
  /** How many identical entries were grouped under this one (1 = a single entry). */
  count: number;
  /** Every grouped entry's target, for the tooltip. */
  targets: string[];
}

/**
 * One project whose stored state the plan would delete.
 *
 * The subject of a destructive plan, and the field the old shape had no room for:
 * a project row's `detail` is the constant `project transcripts (.jsonl) and
 * memory/`, so the only thing that says *which* project it is, is its target.
 */
export interface PurgePlanProject {
  /** The `projects/<hash>` folder name — always known, it is in the plan. */
  hash: string;
  /** The full path of that folder, as the CLI printed it. */
  target: string;
  /**
   * The project's real cwd, when a resolver could name it. Read from the registry
   * by the caller and **never derived from the hash**: `/` and `.` both collapse
   * to `-`, so the inverse is ambiguous and a wrong path here would misname the
   * project a user is about to delete.
   */
  path: string | null;
  /** True for the project the purge was actually asked about. */
  requested: boolean;
}

export interface PurgePlan {
  /** The project it acts on, read from the CLI's own header — not the one we passed. */
  projectPath: string | null;
  items: PurgePlanItem[];
  /** One entry per project the plan would delete state for. More than one = refused. */
  projects: PurgePlanProject[];
  /** The caveats the CLI prints at the end (shell-snapshots, backups…). */
  notes: string[];
  /** The CLI's declared total (`Dry run: N item(s) would be deleted.`), not `items.length`. */
  totalItems: number | null;
  /** The full output: the dialog shows it when the plan cannot be read. */
  raw: string;
}

/** Names a `projects/<hash>` folder without ever inverting the hash itself. */
export type ProjectPathResolver = (hash: string) => string | null;

export interface PlanPurgeOptions extends ClaudeSpawnOptions {
  /** Resolves a `projects/<hash>` folder to its real cwd (the registry does this). */
  resolveProjectPath?: ProjectPathResolver;
}

// An entry line: two spaces, the label, a colon, the target.
const ITEM_RE = /^ {2}(\w[\w-]*):\s+(\S.*)$/;
// `Dry run: 58 item(s) would be deleted.` — the total is declared, never counted by us.
const TOTAL_RE = /(\d+)\s+item\(s\)/;
const HEADER_RE = /^Purge plan for (.+):\s*$/;
// Session UUID: the only part that varies between otherwise identical entries.
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// `…/projects/<hash>`, the one entry that stands for a whole project.
const PROJECT_DIR_RE = /(?:^|[/\\])projects[/\\]([^/\\]+)[/\\]?$/;

/**
 * Turns the output of `claude project purge --dry-run` into the plan the dialog
 * shows. Deliberately tolerant: a line we don't recognise is skipped rather than
 * failing the parse, and `raw` is always kept — an empty plan against a non-zero
 * total means the format moved, and the caller must show the raw output instead
 * of an empty dialog that would collect a confirmation for a plan nobody saw.
 */
export function parsePurgePlan(stdout: string, opts: PlanPurgeOptions = {}): PurgePlan {
  const lines = stdout.split(/\r?\n/);
  const raw = stdout;

  let projectPath: string | null = null;
  let totalItems: number | null = null;
  const parsed: { kind: string; target: string; detail: string }[] = [];
  const notes: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const header = HEADER_RE.exec(line);
    if (header) {
      projectPath = header[1].trim();
      continue;
    }

    const item = ITEM_RE.exec(line);
    if (item) {
      // The detail is the next line, indented deeper than the entry and not an entry itself.
      const next = lines[i + 1] ?? '';
      const hasDetail = /^ {3,}\S/.test(next) && !ITEM_RE.test(next);
      parsed.push({ kind: item[1], target: item[2].trim(), detail: hasDetail ? next.trim() : '' });
      if (hasDetail) i++;
      continue;
    }

    // Flush-left lines: either the total, or a caveat worth carrying through.
    if (/^(Dry run|Purged|Deleted)\b/i.test(line)) {
      const total = TOTAL_RE.exec(line);
      if (total) totalItems = Number(total[1]);
      continue;
    }
    if (!line.startsWith(' ')) notes.push(line.trim());
  }

  return {
    projectPath,
    items: groupItems(parsed),
    projects: collectProjects(parsed, projectPath, opts.resolveProjectPath),
    notes,
    totalItems,
    raw,
  };
}

/**
 * The projects the plan would delete state for, one row each.
 *
 * Derived from the `projects/<hash>` dirs and nothing else: that is the entry the
 * CLI prints once per project actually swept. Counting the `config:` line instead
 * would have answered "1 project" for a plan taking three of them down, which is
 * the reading that let #224 happen.
 */
function collectProjects(
  items: { kind: string; target: string }[],
  requestedPath: string | null,
  resolve?: ProjectPathResolver
): PurgePlanProject[] {
  const byHash = new Map<string, PurgePlanProject>();

  for (const item of items) {
    if (item.kind !== 'dir') continue;
    const match = PROJECT_DIR_RE.exec(item.target);
    if (!match) continue;
    const hash = match[1];
    if (byHash.has(hash)) continue;

    let path: string | null;
    try {
      path = resolve?.(hash) ?? null;
    } catch {
      // A registry read that fails leaves the project unnamed, never unlisted:
      // the row still has to appear, or the count would silently shrink.
      path = null;
    }
    byHash.set(hash, {
      hash,
      target: item.target,
      path,
      requested: !!path && path === requestedPath,
    });
  }

  // The requested project first: the rest of the list is what the user did not ask for.
  return [...byHash.values()].sort((a, b) => Number(b.requested) - Number(a.requested));
}

/**
 * Groups the entries that differ only by a session id. A real project produces
 * dozens of identical ones (`file edit history for session <uuid>` ×55): listing
 * them one by one would bury the few that matter — the transcripts folder, the
 * config entry, the filter over `history.jsonl`. The wording stays the CLI's,
 * with the id replaced by a placeholder: we don't rewrite its prose, we count it.
 *
 * **Only entries whose detail carried a varying id are ever folded together.**
 * That id is exactly the noise a count replaces. Where the detail says nothing
 * about which entry it is — every project folder carries the identical `project
 * transcripts (.jsonl) and memory/` — the target IS the subject, and folding
 * several targets under the first one's name is how three doomed projects were
 * shown as a single `×3` row headed by the one the user had asked to delete
 * (#224). Such entries keep their own row, whatever their number.
 */
function groupItems(items: { kind: string; target: string; detail: string }[]): PurgePlanItem[] {
  const groups = new Map<string, PurgePlanItem>();

  for (const item of items) {
    const detail = item.detail.replace(UUID_RE, '…');
    const groupable = detail !== item.detail;
    const key = groupable ? `${item.kind}::${detail}` : `${item.kind}::${item.target}::${detail}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      existing.targets.push(item.target);
    } else {
      groups.set(key, {
        kind: item.kind,
        target: item.target,
        detail,
        count: 1,
        targets: [item.target],
      });
    }
  }

  // Grouped entries (the per-session sidecars) sink to the bottom: they are the
  // most numerous and the least informative.
  return [...groups.values()].sort((a, b) => (a.count > 1 ? 1 : 0) - (b.count > 1 ? 1 : 0));
}

// The dry-run re-reads `history.jsonl` in full (thousands of lines on a real
// history), so the ceiling is generous but not unbounded.
const PLAN_TIMEOUT_MS = 60_000;
// How long we WAIT for the purge — not how long the CLI is allowed to live. The
// cap fires with `onTimeout: 'detach'`, so the process keeps going and the answer
// becomes "unknown, possibly partial". An unobstructed purge finishes in under a
// second; reaching this ceiling means something stalled mid-delete (#224).
const PURGE_REPORT_AFTER_MS = 120_000;
const MAX_BUFFER = 8 * 1024 * 1024;

function purgeArgs(projectPath: string, extra: string[]): string[] {
  return ['project', 'purge', projectPath, ...extra];
}

// "There is nothing to delete" is an ANSWER, not an error — but the CLI gives it
// with **exit 1** and a message on stderr, which `execClaude` (rightly) turns into
// a reject. Without this distinction the dialog shows a red banner where it should
// say "nothing to delete", and it shows it exactly when that is most confusing:
// right after a successful purge, when the plan is re-read and the project just
// deleted obviously has no state left.
const NO_STATE_RE = /no claude code project state found/i;

function emptyPlan(message: string, raw: string): PurgePlan {
  return {
    projectPath: null,
    items: [],
    projects: [],
    notes: [message.trim()],
    totalItems: null,
    raw,
  };
}

/** The plan, deleting nothing (`--dry-run`). */
export async function planProjectPurge(
  projectPath: string,
  opts: PlanPurgeOptions = {}
): Promise<PurgePlan> {
  try {
    const { stdout } = await execClaude(purgeArgs(projectPath, ['--dry-run']), {
      ...opts,
      maxBuffer: MAX_BUFFER,
      timeout: PLAN_TIMEOUT_MS,
    });
    return parsePurgePlan(stdout, opts);
  } catch (e) {
    const stderr = (e as { stderr?: string })?.stderr ?? '';
    if (NO_STATE_RE.test(stderr)) return emptyPlan(stderr, stderr);
    throw e;
  }
}

/** Why a purge was not attempted. Both are refusals to run, not failures of a run. */
export type PurgeRefusal = 'multiple-projects' | 'unreadable-plan';

export type PurgeStatus =
  /** Every verifiable path in the plan is gone, and the CLI exited cleanly. */
  | 'clean'
  /** Part of the plan was carried out. Irreversible, and incomplete. */
  | 'partial'
  /** We stopped waiting; the CLI was left running. What is deleted is a moving picture. */
  | 'unknown'
  /** The CLI failed and nothing in the plan appears to have been removed. */
  | 'failed'
  /** Nothing was run: the plan did not pass the guard. */
  | 'refused';

/** One plan path, checked on disk AFTER the run — never inferred from an exit code. */
export interface PurgePathOutcome {
  path: string;
  kind: string;
  status: 'gone' | 'remaining';
}

export interface PurgeResult {
  status: PurgeStatus;
  /** The CLI's output, or — when refused — the plan we would not act on. */
  output: string;
  /** The projects the plan named: what was in scope, so a non-clean run can say so. */
  projects: PurgePlanProject[];
  /** Verified after the attempt. Empty when nothing was run. */
  paths: PurgePathOutcome[];
  /** Set when `status` is `refused`. */
  refusal: PurgeRefusal | null;
  /** The CLI error, when it did not exit cleanly. */
  error: string | null;
}

/**
 * The guard in front of the delete, and the reason this module can be reached
 * from the UI again.
 *
 * Pure, and exported so the dialog refuses on the same rule the module enforces —
 * a UI that forgot to check cannot get past this one.
 *
 *  - `multiple-projects`: the plan would take down state belonging to projects
 *    the user did not select. There is no flag to narrow the CLI's subtree rule,
 *    so the only safe answer is not to run it: the projects underneath can be
 *    purged individually first.
 *  - `unreadable-plan`: the CLI declared items we could not parse into rows. We
 *    cannot count the projects in a plan we cannot read, so the guard above is
 *    unenforceable and consent was collected for a list nobody saw.
 */
export function refusePurge(plan: PurgePlan): PurgeRefusal | null {
  if (plan.projects.length > 1) return 'multiple-projects';
  if (plan.items.length === 0 && (plan.totalItems ?? 0) > 0) return 'unreadable-plan';
  return null;
}

/**
 * The plan's paths that can be checked on disk: the `dir` entries.
 *
 * `config` is a selector inside `~/.claude.json`, not a path, and `filter` names
 * `history.jsonl`, which is rewritten line by line and must still exist
 * afterwards — calling either one "remaining" would report every clean purge as
 * partial.
 */
export function verifiablePaths(plan: PurgePlan): { path: string; kind: string }[] {
  const out: { path: string; kind: string }[] = [];
  for (const item of plan.items) {
    if (item.kind !== 'dir') continue;
    for (const target of item.targets) {
      if (isAbsolute(target)) out.push({ path: target, kind: item.kind });
    }
  }
  return out;
}

function verifyPlan(plan: PurgePlan): PurgePathOutcome[] {
  return verifiablePaths(plan).map(({ path, kind }) => ({
    path,
    kind,
    status: existsSync(path) ? ('remaining' as const) : ('gone' as const),
  }));
}

/**
 * Runs the purge (`-y` skips the CLI's interactive prompt: we already collected
 * the confirmation in the dialog, which showed this very plan).
 *
 * Three things it does that the previous `{ output }` could not express, all of
 * them lessons from #224:
 *
 *  - it re-reads the plan and **refuses** on `refusePurge` before deleting
 *    anything, so the guard holds regardless of what the caller checked;
 *  - the timeout **detaches instead of killing**. Killing the CLI mid-walk is
 *    what turned a stall into "everything before it deleted, everything after it
 *    intact" while the renderer showed a plain red failure;
 *  - the outcome is **verified on disk** and reported per path. A non-clean run
 *    says what is gone and what is left; it never says "nothing happened".
 */
export async function runProjectPurge(
  projectPath: string,
  opts: PlanPurgeOptions = {}
): Promise<PurgeResult> {
  const plan = await planProjectPurge(projectPath, opts);
  const refusal = refusePurge(plan);
  if (refusal) {
    return {
      status: 'refused',
      output: plan.raw,
      projects: plan.projects,
      paths: [],
      refusal,
      error: null,
    };
  }

  let output: string;
  let error: string | null = null;
  let detached = false;

  try {
    const { stdout, stderr } = await execClaude(purgeArgs(projectPath, ['-y']), {
      ...opts,
      maxBuffer: MAX_BUFFER,
      timeout: PURGE_REPORT_AFTER_MS,
      onTimeout: 'detach',
    });
    output = [stdout, stderr].filter(s => s.trim()).join('\n');
  } catch (e) {
    const failure = e as { stdout?: string; stderr?: string; message?: string; code?: string };
    const stderr = failure.stderr ?? '';
    // Same exit 1 as the dry-run: deleting what isn't there is already the desired
    // state, not a failure to paint red.
    if (NO_STATE_RE.test(stderr)) {
      output = stderr.trim();
    } else {
      // Whatever it printed before giving up is the only account of how far it got.
      output = [failure.stdout, stderr].filter(s => s?.trim()).join('\n');
      error = failure.message ?? String(e);
      detached = failure.code === 'ETIMEDOUT';
    }
  }

  const paths = verifyPlan(plan);
  const removed = paths.some(p => p.status === 'gone');
  const remaining = paths.some(p => p.status === 'remaining');

  // The CLI was left running, so anything read off disk is a moving picture:
  // whatever it says, the honest verdict is "we do not know yet".
  const status: PurgeStatus = detached
    ? 'unknown'
    : error
      ? removed
        ? 'partial'
        : 'failed'
      : remaining
        ? 'partial'
        : 'clean';

  return { status, output, projects: plan.projects, paths, refusal: null, error };
}
