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

export interface PurgePlan {
  /** The project it acts on, read from the CLI's own header — not the one we passed. */
  projectPath: string | null;
  items: PurgePlanItem[];
  /** The caveats the CLI prints at the end (shell-snapshots, backups…). */
  notes: string[];
  /** The CLI's declared total (`Dry run: N item(s) would be deleted.`), not `items.length`. */
  totalItems: number | null;
  /** The full output: the dialog shows it when the plan cannot be read. */
  raw: string;
}

// An entry line: two spaces, the label, a colon, the target.
const ITEM_RE = /^ {2}(\w[\w-]*):\s+(\S.*)$/;
// `Dry run: 58 item(s) would be deleted.` — the total is declared, never counted by us.
const TOTAL_RE = /(\d+)\s+item\(s\)/;
const HEADER_RE = /^Purge plan for (.+):\s*$/;
// Session UUID: the only part that varies between otherwise identical entries.
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Turns the output of `claude project purge --dry-run` into the plan the dialog
 * shows. Deliberately tolerant: a line we don't recognise is skipped rather than
 * failing the parse, and `raw` is always kept — an empty plan against a non-zero
 * total means the format moved, and the caller must show the raw output instead
 * of an empty dialog that would collect a confirmation for a plan nobody saw.
 */
export function parsePurgePlan(stdout: string): PurgePlan {
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

  return { projectPath, items: groupItems(parsed), notes, totalItems, raw };
}

/**
 * Groups the entries that differ only by a session id. A real project produces
 * dozens of identical ones (`file edit history for session <uuid>` ×55): listing
 * them one by one would bury the few that matter — the transcripts folder, the
 * config entry, the filter over `history.jsonl`. The wording stays the CLI's,
 * with the id replaced by a placeholder: we don't rewrite its prose, we count it.
 */
function groupItems(items: { kind: string; target: string; detail: string }[]): PurgePlanItem[] {
  const groups = new Map<string, PurgePlanItem>();

  for (const item of items) {
    const detail = item.detail.replace(UUID_RE, '…');
    const key = `${item.kind}::${detail}`;
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
const PURGE_TIMEOUT_MS = 120_000;
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
  return { projectPath: null, items: [], notes: [message.trim()], totalItems: null, raw };
}

/** The plan, deleting nothing (`--dry-run`). */
export async function planProjectPurge(
  projectPath: string,
  opts: ClaudeSpawnOptions = {}
): Promise<PurgePlan> {
  try {
    const { stdout } = await execClaude(purgeArgs(projectPath, ['--dry-run']), {
      ...opts,
      maxBuffer: MAX_BUFFER,
      timeout: PLAN_TIMEOUT_MS,
    });
    return parsePurgePlan(stdout);
  } catch (e) {
    const stderr = (e as { stderr?: string })?.stderr ?? '';
    if (NO_STATE_RE.test(stderr)) return emptyPlan(stderr, stderr);
    throw e;
  }
}

/**
 * Runs the purge (`-y` skips the CLI's interactive prompt: we already collected
 * the confirmation in the dialog, which showed this very plan). Returns the
 * output as-is, so it can be shown if something goes wrong.
 */
export async function runProjectPurge(
  projectPath: string,
  opts: ClaudeSpawnOptions = {}
): Promise<{ output: string }> {
  try {
    const { stdout, stderr } = await execClaude(purgeArgs(projectPath, ['-y']), {
      ...opts,
      maxBuffer: MAX_BUFFER,
      timeout: PURGE_TIMEOUT_MS,
    });
    return { output: [stdout, stderr].filter(s => s.trim()).join('\n') };
  } catch (e) {
    // Same exit 1 as the dry-run: deleting what isn't there is already the desired
    // state, not a failure to paint red.
    const stderr = (e as { stderr?: string })?.stderr ?? '';
    if (NO_STATE_RE.test(stderr)) return { output: stderr.trim() };
    throw e;
  }
}
