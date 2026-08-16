import { describe, it, expect, vi, afterEach } from 'vitest';
import { parsePurgePlan, planProjectPurge } from '../electron/modules/project-purger';

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
