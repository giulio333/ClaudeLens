import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parsePurgePlan,
  planProjectPurge,
  refusePurge,
  runProjectPurge,
  verifiablePaths,
} from '../electron/modules/project-purger';

vi.mock('../electron/modules/claude-cli', () => ({ execClaude: vi.fn() }));
import { execClaude } from '../electron/modules/claude-cli';

// The outputs below are captured from real `claude project purge --dry-run` runs
// (CLI 2.1.233), not invented: the parser exists to read that exact format, and
// an idealised fixture would prove nothing about it.

const REAL_PLAN = `Purge plan for /Users/alice/Projects/acme:

  dir:    /Users/alice/.claude/tasks/81c9a1ee-8793-4d0e-bb50-0913332db4cf
           tasks for session 81c9a1ee-8793-4d0e-bb50-0913332db4cf
  dir:    /Users/alice/.claude/tasks/feb8a61f-8617-4409-9829-ef3841a3c097
           tasks for session feb8a61f-8617-4409-9829-ef3841a3c097
  dir:    /Users/alice/.claude/file-history/4b598457-dc3a-4679-a3a2-68c194449847
           file edit history for session 4b598457-dc3a-4679-a3a2-68c194449847
  dir:    /Users/alice/.claude/file-history/e8a68ab6-1665-4c07-bb01-dd9efc6ba835
           file edit history for session e8a68ab6-1665-4c07-bb01-dd9efc6ba835
  dir:    /Users/alice/.claude/projects/-Users-alice-Projects-acme
           project transcripts (.jsonl) and memory/
  config: projects["/Users/alice/Projects/acme"]
           project entry in ~/.claude.json (trust, history, MCP servers)
  filter: /Users/alice/.claude/history.jsonl
           2520 prompt(s) typed in this project

shell-snapshots/ are not project-scoped and will not be touched
backups/ may still contain this project entry in old .claude.json snapshots (/Users/alice/.claude/backups); at most 5 are kept and they rotate out automatically
Dry run: 58 item(s) would be deleted.
`;

describe('parsePurgePlan', () => {
  it('reads the project path from the CLI, not from the caller', () => {
    expect(parsePurgePlan(REAL_PLAN).projectPath).toBe('/Users/alice/Projects/acme');
  });

  it('keeps the declared total instead of counting the printed lines', () => {
    // 7 entries are printed against a declared total of 58: the CLI already groups
    // part of its own work, so the figure to show is its own.
    const plan = parsePurgePlan(REAL_PLAN);
    expect(plan.totalItems).toBe(58);
    expect(plan.items.length).toBeLessThan(58);
  });

  it('groups the per-session entries and counts them', () => {
    const plan = parsePurgePlan(REAL_PLAN);
    const history = plan.items.find(i => i.detail.startsWith('file edit history'));
    expect(history).toBeDefined();
    expect(history!.count).toBe(2);
    expect(history!.detail).toBe('file edit history for session …');
    expect(history!.targets).toHaveLength(2);

    const tasks = plan.items.find(i => i.detail.startsWith('tasks for session'));
    expect(tasks!.count).toBe(2);
  });

  it('keeps the one-off entries distinct and unsummarised', () => {
    const plan = parsePurgePlan(REAL_PLAN);
    const kinds = plan.items.map(i => i.kind);
    expect(kinds).toContain('config');
    expect(kinds).toContain('filter');

    const config = plan.items.find(i => i.kind === 'config')!;
    expect(config.count).toBe(1);
    expect(config.target).toBe('projects["/Users/alice/Projects/acme"]');
    expect(config.detail).toBe('project entry in ~/.claude.json (trust, history, MCP servers)');

    // `history.jsonl` is filtered line by line, not deleted: the detail line is the
    // only place that says so, so it has to survive the parse.
    const filter = plan.items.find(i => i.kind === 'filter')!;
    expect(filter.detail).toBe('2520 prompt(s) typed in this project');
  });

  it('sorts the grouped entries after the individual ones', () => {
    const items = parsePurgePlan(REAL_PLAN).items;
    const lastSingle = items.map(i => i.count).lastIndexOf(1);
    const firstGroup = items.findIndex(i => i.count > 1);
    expect(firstGroup).toBeGreaterThan(lastSingle);
  });

  it('carries the CLI caveats through as notes', () => {
    const notes = parsePurgePlan(REAL_PLAN).notes;
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain('shell-snapshots/');
    expect(notes[1]).toContain('backups/');
    // The total is a line of its own: it must not land among the caveats.
    expect(notes.some(n => n.startsWith('Dry run'))).toBe(false);
  });

  it('handles a project whose only state is the config entry', () => {
    const plan = parsePurgePlan(`Purge plan for /Users/alice/Desktop/scratch:

  config: projects["/Users/alice/Desktop/scratch"]
           project entry in ~/.claude.json (trust, history, MCP servers)

Dry run: 1 item(s) would be deleted.
`);
    expect(plan.items).toHaveLength(1);
    expect(plan.totalItems).toBe(1);
  });

  it('reports nothing to purge without inventing a plan', () => {
    const plan = parsePurgePlan(
      'Purge plan for /Users/alice/Projects/empty:\n\nNothing to purge.\n'
    );
    expect(plan.items).toHaveLength(0);
    expect(plan.totalItems).toBeNull();
  });

  it('always keeps the raw output, so an unreadable format can still be shown', () => {
    // If the CLI's format moved, the dialog must not show an empty list: a total
    // above zero with no entries is the signal to fall back to the raw output.
    const plan = parsePurgePlan('something entirely new\nDry run: 12 item(s) would be deleted.\n');
    expect(plan.items).toHaveLength(0);
    expect(plan.totalItems).toBe(12);
    expect(plan.raw).toContain('something entirely new');
  });

  it('survives an empty answer', () => {
    const plan = parsePurgePlan('');
    expect(plan).toMatchObject({ projectPath: null, items: [], notes: [], totalItems: null });
  });
});

// The case mocking the output could not catch: how the CLI actually *exits*.
describe('planProjectPurge', () => {
  afterEach(() => vi.mocked(execClaude).mockReset());

  it('reads "no state" as an empty plan, not as a failure', async () => {
    // Verified live: on a project with no state the CLI exits with **1** and writes
    // to stderr. Treating that as a reject painted the normal answer red — which is
    // exactly what showed up when the plan was re-read right after a successful
    // purge, where the project has no state left by construction.
    const message =
      'No Claude Code project state found for /Users/alice/Projects/gone under /Users/alice/.claude.';
    vi.mocked(execClaude).mockRejectedValue(
      Object.assign(new Error('claude exited with code 1'), { exitCode: 1, stderr: message })
    );

    const plan = await planProjectPurge('/Users/alice/Projects/gone');
    expect(plan.items).toHaveLength(0);
    expect(plan.totalItems).toBeNull();
    expect(plan.notes[0]).toContain('No Claude Code project state found');
  });

  it('still propagates a real failure', async () => {
    vi.mocked(execClaude).mockRejectedValue(
      Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })
    );
    await expect(planProjectPurge('/Users/alice/Projects/acme')).rejects.toThrow('ENOENT');
  });

  it('passes --dry-run and never a deleting flag', async () => {
    vi.mocked(execClaude).mockResolvedValue({ stdout: '', stderr: '' });
    await planProjectPurge('/Users/alice/Projects/acme');
    const [args] = vi.mocked(execClaude).mock.calls[0];
    expect(args).toEqual(['project', 'purge', '/Users/alice/Projects/acme', '--dry-run']);
    expect(args).not.toContain('-y');
  });
});

// The plan that #224 was about, captured from a real `--dry-run` on CLI 2.1.240
// against a sandbox `CLAUDE_CONFIG_DIR` with projects at `<sbx>/home`,
// `<sbx>/home/ProjA`, `<sbx>/home/ProjB/deep` and `<sbx>/home-extra`. Only the
// sandbox path prefix is shortened; the shape, the ordering (arbitrary — not
// alphabetical) and the counts are the CLI's own.
//
// Two facts this output settles, and both were read wrong before:
//   - `dir: …/projects/<hash>` appears once per project SWEPT — three of them for
//     a purge of `<sbx>/home`, whose siblings were spared;
//   - `config:` appears ONCE, for the requested project only. Counting projects
//     there would have answered "1" while three were going.
const MULTI_PROJECT_PLAN = `Purge plan for /tmp/sbx/home:

  dir:    /tmp/sbx/cfg/tasks/00000000-0000-0000-0000-000000000001
           tasks for session 00000000-0000-0000-0000-000000000001
  dir:    /tmp/sbx/cfg/file-history/00000000-0000-0000-0000-000000000001
           file edit history for session 00000000-0000-0000-0000-000000000001
  dir:    /tmp/sbx/cfg/tasks/00000000-0000-0000-0000-000000000003
           tasks for session 00000000-0000-0000-0000-000000000003
  dir:    /tmp/sbx/cfg/projects/-tmp-sbx-home
           project transcripts (.jsonl) and memory/
  dir:    /tmp/sbx/cfg/projects/-tmp-sbx-home-ProjB-deep
           project transcripts (.jsonl) and memory/
  dir:    /tmp/sbx/cfg/projects/-tmp-sbx-home-ProjA
           project transcripts (.jsonl) and memory/
  config: projects["/tmp/sbx/home"]
           project entry in ~/.claude.json (trust, history, MCP servers)
  filter: /tmp/sbx/cfg/history.jsonl
           3 prompt(s) typed in this project

Dry run: 11 item(s) would be deleted.
`;

const CWD_OF: Record<string, string> = {
  '-tmp-sbx-home': '/tmp/sbx/home',
  '-tmp-sbx-home-ProjA': '/tmp/sbx/home/ProjA',
  '-tmp-sbx-home-ProjB-deep': '/tmp/sbx/home/ProjB/deep',
};
const resolveProjectPath = (hash: string) => CWD_OF[hash] ?? null;

describe('the projects a plan would delete', () => {
  it('lists one row per project folder, never folded into a count', () => {
    // The bug: every project row carries the identical detail `project
    // transcripts (.jsonl) and memory/`, so keying a group on kind+detail
    // rendered three doomed projects as one `×3` row headed by the only path the
    // user recognised. The two other projects existed solely in a tooltip.
    const rows = parsePurgePlan(MULTI_PROJECT_PLAN).items.filter(i =>
      i.detail.startsWith('project transcripts')
    );
    expect(rows).toHaveLength(3);
    expect(rows.every(r => r.count === 1)).toBe(true);
    expect(rows.map(r => r.target).sort()).toEqual([
      '/tmp/sbx/cfg/projects/-tmp-sbx-home',
      '/tmp/sbx/cfg/projects/-tmp-sbx-home-ProjA',
      '/tmp/sbx/cfg/projects/-tmp-sbx-home-ProjB-deep',
    ]);
  });

  it('still groups the per-session sidecars, whose id IS the noise', () => {
    const plan = parsePurgePlan(MULTI_PROJECT_PLAN);
    const tasks = plan.items.find(i => i.detail.startsWith('tasks for session'))!;
    expect(tasks.count).toBe(2);
    expect(tasks.detail).toBe('tasks for session …');
  });

  it('counts the projects from the project dirs, not from the config entry', () => {
    // `config:` is printed once — for the requested project only — so it reports
    // "1 project" for a plan taking three of them down.
    const plan = parsePurgePlan(MULTI_PROJECT_PLAN);
    expect(plan.projects).toHaveLength(3);
    expect(plan.projects.map(p => p.hash).sort()).toEqual([
      '-tmp-sbx-home',
      '-tmp-sbx-home-ProjA',
      '-tmp-sbx-home-ProjB-deep',
    ]);
  });

  it("names each project through the caller's resolver and flags the requested one", () => {
    const plan = parsePurgePlan(MULTI_PROJECT_PLAN, { resolveProjectPath });
    expect(plan.projects[0]).toMatchObject({ path: '/tmp/sbx/home', requested: true });
    expect(plan.projects.filter(p => p.requested)).toHaveLength(1);
    expect(plan.projects.map(p => p.path)).toContain('/tmp/sbx/home/ProjA');
  });

  it('keeps a project it cannot name, unnamed', () => {
    // The hash is not invertible (`/` and `.` both collapse to `-`), so a
    // resolver that comes up empty must leave `path` null — dropping the row
    // would shrink the count that the guard depends on.
    const plan = parsePurgePlan(MULTI_PROJECT_PLAN, { resolveProjectPath: () => null });
    expect(plan.projects).toHaveLength(3);
    expect(plan.projects.every(p => p.path === null && !p.requested)).toBe(true);
  });

  it('survives a resolver that throws', () => {
    const plan = parsePurgePlan(MULTI_PROJECT_PLAN, {
      resolveProjectPath: () => {
        throw new Error('registry read failed');
      },
    });
    expect(plan.projects).toHaveLength(3);
  });

  it('finds one project in a single-project plan', () => {
    expect(parsePurgePlan(REAL_PLAN).projects).toHaveLength(1);
  });
});

describe('refusePurge', () => {
  it('refuses a plan that reaches more than one project', () => {
    expect(refusePurge(parsePurgePlan(MULTI_PROJECT_PLAN))).toBe('multiple-projects');
  });

  it('allows the plan of a single project', () => {
    expect(refusePurge(parsePurgePlan(REAL_PLAN))).toBeNull();
  });

  it('refuses a plan it could not read, since the project count is the guard', () => {
    const plan = parsePurgePlan('something entirely new\nDry run: 12 item(s) would be deleted.\n');
    expect(refusePurge(plan)).toBe('unreadable-plan');
  });

  it('allows an empty plan, which is not an unreadable one', () => {
    expect(refusePurge(parsePurgePlan(''))).toBeNull();
  });
});

describe('verifiablePaths', () => {
  it('takes the dir entries and leaves history.jsonl alone', () => {
    // `filter` names a file that is rewritten line by line and must still exist
    // afterwards; `config` is a selector, not a path. Checking either would
    // report every clean purge as partial.
    const paths = verifiablePaths(parsePurgePlan(REAL_PLAN)).map(p => p.path);
    expect(paths.some(p => p.includes('/projects/'))).toBe(true);
    expect(paths.some(p => p.endsWith('history.jsonl'))).toBe(false);
    expect(paths.some(p => p.startsWith('projects['))).toBe(false);
  });

  it('covers every target of a grouped entry, not just the one on display', () => {
    const paths = verifiablePaths(parsePurgePlan(REAL_PLAN));
    expect(paths.filter(p => p.path.includes('/file-history/'))).toHaveLength(2);
  });
});

// The outcome of an actual run: what the flat `{ output }` could not say. Paths
// are real directories in a tmpdir, so "gone" and "remaining" are checked the way
// the module checks them — on disk, after the attempt.
describe('runProjectPurge', () => {
  let root: string;
  let planText: string;
  let projectDir: string;
  let taskDir: string;

  const dryRun = (text: string) => ({ stdout: text, stderr: '' });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cl-purge-'));
    projectDir = join(root, 'projects', '-tmp-acme');
    taskDir = join(root, 'tasks', '11111111-1111-1111-1111-111111111111');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(taskDir, { recursive: true });
    planText = `Purge plan for /tmp/acme:

  dir:    ${taskDir}
           tasks for session 11111111-1111-1111-1111-111111111111
  dir:    ${projectDir}
           project transcripts (.jsonl) and memory/

Dry run: 2 item(s) would be deleted.
`;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.mocked(execClaude).mockReset();
  });

  it('reports a verified clean run', async () => {
    vi.mocked(execClaude)
      .mockResolvedValueOnce(dryRun(planText))
      .mockImplementationOnce(async () => {
        rmSync(projectDir, { recursive: true });
        rmSync(taskDir, { recursive: true });
        return { stdout: 'Purged 2 item(s).', stderr: '' };
      });

    const result = await runProjectPurge('/tmp/acme');
    expect(result.status).toBe('clean');
    expect(result.paths.every(p => p.status === 'gone')).toBe(true);
    expect(result.error).toBeNull();
  });

  it('calls it partial when the CLI exits clean but a path is still there', async () => {
    // `rmSync(..., { force: true })` does not report everything it failed to
    // remove, so an exit code is not evidence: the disk is.
    vi.mocked(execClaude)
      .mockResolvedValueOnce(dryRun(planText))
      .mockImplementationOnce(async () => {
        rmSync(taskDir, { recursive: true });
        return { stdout: 'Purged 2 item(s).', stderr: '' };
      });

    const result = await runProjectPurge('/tmp/acme');
    expect(result.status).toBe('partial');
    expect(result.paths.find(p => p.path === projectDir)!.status).toBe('remaining');
    expect(result.paths.find(p => p.path === taskDir)!.status).toBe('gone');
  });

  it('reads a timeout as unknown, never as a failure', async () => {
    // The cap detaches instead of killing, so the CLI is still deleting while we
    // answer: whatever is on disk now is a moving picture. This is the case that
    // showed a red "claude timed out" banner over an irreversible partial delete.
    vi.mocked(execClaude)
      .mockResolvedValueOnce(dryRun(planText))
      .mockImplementationOnce(async () => {
        rmSync(taskDir, { recursive: true });
        throw Object.assign(new Error('claude timed out after 120000ms'), {
          code: 'ETIMEDOUT',
          detached: true,
        });
      });

    const result = await runProjectPurge('/tmp/acme');
    expect(result.status).toBe('unknown');
    expect(result.error).toContain('timed out');
    expect(result.paths.find(p => p.path === taskDir)!.status).toBe('gone');
  });

  it('calls a failing run partial once something is verifiably gone', async () => {
    vi.mocked(execClaude)
      .mockResolvedValueOnce(dryRun(planText))
      .mockImplementationOnce(async () => {
        rmSync(taskDir, { recursive: true });
        throw Object.assign(new Error('claude exited with code 1'), {
          exitCode: 1,
          stderr: 'EACCES',
        });
      });

    const result = await runProjectPurge('/tmp/acme');
    expect(result.status).toBe('partial');
  });

  it('calls it failed only when nothing in the plan is gone', async () => {
    vi.mocked(execClaude)
      .mockResolvedValueOnce(dryRun(planText))
      .mockRejectedValueOnce(
        Object.assign(new Error('claude exited with code 1'), { exitCode: 1, stderr: 'EACCES' })
      );

    const result = await runProjectPurge('/tmp/acme');
    expect(result.status).toBe('failed');
    expect(result.paths.every(p => p.status === 'remaining')).toBe(true);
  });

  it('refuses a multi-project plan WITHOUT running the purge', async () => {
    // The guard that makes this feature safe to reach from the UI: the deleting
    // call is never issued, so a caller that skipped the check cannot get past it.
    vi.mocked(execClaude).mockResolvedValueOnce(dryRun(MULTI_PROJECT_PLAN));

    const result = await runProjectPurge('/tmp/sbx/home', { resolveProjectPath });
    expect(result.status).toBe('refused');
    expect(result.refusal).toBe('multiple-projects');
    expect(result.projects).toHaveLength(3);
    expect(vi.mocked(execClaude)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execClaude).mock.calls[0][0]).toContain('--dry-run');
  });

  it('refuses a plan it could not parse, without deleting anything', async () => {
    vi.mocked(execClaude).mockResolvedValueOnce(
      dryRun('a shape we do not know\nDry run: 9 item(s) would be deleted.\n')
    );

    const result = await runProjectPurge('/tmp/acme');
    expect(result.status).toBe('refused');
    expect(result.refusal).toBe('unreadable-plan');
    expect(vi.mocked(execClaude)).toHaveBeenCalledTimes(1);
  });

  it('passes -y to the deleting call and a detaching timeout', async () => {
    vi.mocked(execClaude)
      .mockResolvedValueOnce(dryRun(planText))
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    await runProjectPurge('/tmp/acme');
    const [args, opts] = vi.mocked(execClaude).mock.calls[1];
    expect(args).toEqual(['project', 'purge', '/tmp/acme', '-y']);
    expect(opts).toMatchObject({ onTimeout: 'detach' });
  });

  it('treats "no state to purge" as a clean nothing, not as an error', async () => {
    // The CLI answers this with exit 1 on both calls — the plan and the purge —
    // and it is the normal state of a project that has nothing stored, not a
    // failure to paint red.
    const message = 'No Claude Code project state found for /tmp/acme under /tmp/sbx/cfg.';
    vi.mocked(execClaude).mockRejectedValue(
      Object.assign(new Error('claude exited with code 1'), { exitCode: 1, stderr: message })
    );

    const result = await runProjectPurge('/tmp/acme');
    expect(result.status).toBe('clean');
    expect(result.paths).toHaveLength(0);
  });
});
