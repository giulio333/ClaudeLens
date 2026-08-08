import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getProjectTasks } from '../electron/modules/tasks-reader';

// getProjectTasks used to probe `~/.claude/tasks/<id>/` once PER SESSION of the
// project — hundreds of directory probes, nearly all against folders that don't
// exist, on a query mounted by every project view. It now lists the tasks dir
// once and intersects. These tests pin the observable behaviour across that
// change: which files count as tasks, which sessions produce a group, and the
// ordering of both.
let root: string;
let projectPath: string;
let tasksDir: string;

const SESSION_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const SESSION_B = 'bbbbbbbb-0000-0000-0000-000000000002';

function session(id: string): void {
  writeFileSync(join(projectPath, `${id}.jsonl`), '{}\n');
}

/** The other native layout: `<hash>/sessions/<id>.jsonl`. */
function sessionUnderSessionsDir(id: string): void {
  const dir = join(projectPath, 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.jsonl`), '{}\n');
}

function task(sessionId: string, name: string, body: Record<string, unknown>): void {
  const folder = join(tasksDir, sessionId);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), JSON.stringify(body));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cl-tasks-'));
  projectPath = join(root, 'project');
  tasksDir = join(root, 'tasks');
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(tasksDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('getProjectTasks', () => {
  it('groups a session with its tasks', async () => {
    session(SESSION_A);
    task(SESSION_A, '1.json', { id: '1', subject: 'first', status: 'completed' });
    task(SESSION_A, '2.json', { id: '2', subject: 'second', status: 'in_progress' });

    const groups = await getProjectTasks(projectPath, tasksDir);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessionId).toBe(SESSION_A);
    expect(groups[0].filename).toBe(`${SESSION_A}.jsonl`);
    expect(groups[0].tasks.map(t => t.subject)).toEqual(['first', 'second']);
    expect(groups[0].tasks.map(t => t.status)).toEqual(['completed', 'in_progress']);
  });

  it('skips sessions with no tasks folder', async () => {
    session(SESSION_A);
    session(SESSION_B);
    task(SESSION_B, '1.json', { id: '1', subject: 'only B' });

    const groups = await getProjectTasks(projectPath, tasksDir);
    expect(groups.map(g => g.sessionId)).toEqual([SESSION_B]);
  });

  it('ignores task folders with no session transcript in this project', async () => {
    session(SESSION_A);
    task(SESSION_A, '1.json', { id: '1', subject: 'mine' });
    task('cccccccc-0000-0000-0000-000000000003', '1.json', { id: '1', subject: 'other project' });

    const groups = await getProjectTasks(projectPath, tasksDir);
    expect(groups.map(g => g.sessionId)).toEqual([SESSION_A]);
  });

  it('skips an empty task folder', async () => {
    session(SESSION_A);
    mkdirSync(join(tasksDir, SESSION_A), { recursive: true });

    expect(await getProjectTasks(projectPath, tasksDir)).toEqual([]);
  });

  it('ignores dotfiles and non-json entries', async () => {
    session(SESSION_A);
    task(SESSION_A, '1.json', { id: '1', subject: 'real' });
    task(SESSION_A, '.hidden.json', { id: '9', subject: 'hidden' });
    task(SESSION_A, 'notes.txt', { id: '8', subject: 'text' });

    const groups = await getProjectTasks(projectPath, tasksDir);
    expect(groups[0].tasks.map(t => t.subject)).toEqual(['real']);
  });

  it('follows a symlinked task file, like the previous glob did', async () => {
    session(SESSION_A);
    task(SESSION_A, '1.json', { id: '1', subject: 'real' });
    const target = join(root, 'elsewhere.json');
    writeFileSync(target, JSON.stringify({ id: '2', subject: 'linked' }));
    try {
      symlinkSync(target, join(tasksDir, SESSION_A, '2.json'));
    } catch {
      return; // unprivileged Windows: symlinks aren't creatable, nothing to pin
    }

    const groups = await getProjectTasks(projectPath, tasksDir);
    expect(groups[0].tasks.map(t => t.subject)).toEqual(['real', 'linked']);
  });

  it('ignores a directory named like a task file', async () => {
    session(SESSION_A);
    task(SESSION_A, '1.json', { id: '1', subject: 'real' });
    mkdirSync(join(tasksDir, SESSION_A, '2.json'), { recursive: true });

    const groups = await getProjectTasks(projectPath, tasksDir);
    expect(groups[0].tasks.map(t => t.subject)).toEqual(['real']);
  });

  it('does not treat sub-agent transcripts as sessions (#95)', async () => {
    session(SESSION_A);
    const nested = join(projectPath, SESSION_A, 'subagents');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'agent-x.jsonl'), '{}\n');
    task(SESSION_A, '1.json', { id: '1', subject: 'real' });
    task('agent-x', '1.json', { id: '1', subject: 'should not appear' });

    const groups = await getProjectTasks(projectPath, tasksDir);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessionId).toBe(SESSION_A);
  });

  // Claude Code has two transcript layouts. Reading only `<hash>/*.jsonl` left
  // every `sessions/`-layout project with no session id to intersect against the
  // tasks dir, so `getProjectTasks` always returned [] — an empty Tasks subtab,
  // a 0 badge and an empty Mission Control TASKS island, with a full
  // `~/.claude/tasks/<id>/` on disk and no error anywhere.
  it('finds tasks when transcripts live under sessions/', async () => {
    sessionUnderSessionsDir(SESSION_A);
    task(SESSION_A, '1.json', { id: '1', subject: 'in the sessions layout' });

    const groups = await getProjectTasks(projectPath, tasksDir);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessionId).toBe(SESSION_A);
    expect(groups[0].filename).toBe(`${SESSION_A}.jsonl`);
    expect(groups[0].tasks.map(t => t.subject)).toEqual(['in the sessions layout']);
  });

  it('falls back to the project root when sessions/ exists but is empty', async () => {
    mkdirSync(join(projectPath, 'sessions'), { recursive: true });
    session(SESSION_A);
    task(SESSION_A, '1.json', { id: '1', subject: 'at the root' });

    const groups = await getProjectTasks(projectPath, tasksDir);
    expect(groups.map(g => g.sessionId)).toEqual([SESSION_A]);
  });

  it('orders groups by task-folder mtime, most recent first', async () => {
    session(SESSION_A);
    session(SESSION_B);
    task(SESSION_A, '1.json', { id: '1', subject: 'older' });
    task(SESSION_B, '1.json', { id: '1', subject: 'newer' });

    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(join(tasksDir, SESSION_A), old, old);

    const groups = await getProjectTasks(projectPath, tasksDir);
    expect(groups.map(g => g.sessionId)).toEqual([SESSION_B, SESSION_A]);
  });

  it('orders tasks numerically, falling back to a string compare', async () => {
    session(SESSION_A);
    task(SESSION_A, '10.json', { id: '10', subject: 'ten' });
    task(SESSION_A, '2.json', { id: '2', subject: 'two' });

    const numeric = await getProjectTasks(projectPath, tasksDir);
    expect(numeric[0].tasks.map(t => t.subject)).toEqual(['two', 'ten']);

    task(SESSION_A, 'zz.json', { id: 'zz', subject: 'non-numeric' });
    const mixed = await getProjectTasks(projectPath, tasksDir);
    expect(mixed[0].tasks).toHaveLength(3);
  });

  it('tolerates malformed task files without dropping the group', async () => {
    session(SESSION_A);
    task(SESSION_A, '1.json', { id: '1', subject: 'good' });
    writeFileSync(join(tasksDir, SESSION_A, '2.json'), 'not json at all');

    const groups = await getProjectTasks(projectPath, tasksDir);
    expect(groups[0].tasks.map(t => t.subject)).toEqual(['good']);
  });

  it('returns [] when the tasks dir does not exist', async () => {
    session(SESSION_A);
    expect(await getProjectTasks(projectPath, join(root, 'missing'))).toEqual([]);
  });

  it('defaults an unknown status to pending and normalizes list fields', async () => {
    session(SESSION_A);
    task(SESSION_A, '1.json', { id: '1', subject: 'x', status: 'bogus', blocks: 'nope' });

    const groups = await getProjectTasks(projectPath, tasksDir);
    expect(groups[0].tasks[0].status).toBe('pending');
    expect(groups[0].tasks[0].blocks).toEqual([]);
  });
});
