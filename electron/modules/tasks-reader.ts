import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { listProjectSessionFiles } from './session-files';

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  blocks: string[];
  blockedBy: string[];
  activeForm?: string;
}

export interface TaskGroup {
  sessionId: string;
  filename: string;
  tasks: Task[];
}

function toStatus(raw: unknown): TaskStatus {
  return raw === 'completed' || raw === 'in_progress' ? raw : 'pending';
}

function toStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(String) : [];
}

async function parseTaskFile(filePath: string): Promise<Task | null> {
  try {
    const json = JSON.parse(await readFile(filePath, 'utf-8')) as Record<string, unknown>;
    const id = String(json.id ?? basename(filePath, '.json'));
    return {
      id,
      subject: typeof json.subject === 'string' ? json.subject : '',
      description: typeof json.description === 'string' ? json.description : '',
      status: toStatus(json.status),
      blocks: toStringArray(json.blocks),
      blockedBy: toStringArray(json.blockedBy),
      ...(typeof json.activeForm === 'string' && json.activeForm
        ? { activeForm: json.activeForm }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The session ids that actually have a `~/.claude/tasks/<id>/` folder.
 *
 * One listing of the tasks dir replaces one directory probe PER SESSION: the
 * previous `glob('*.json', { cwd: tasksDir/<id> })` inside the loop ran once for
 * every transcript in the project — hundreds of probes on a long-lived project,
 * nearly all against folders that don't exist, on a query mounted by every
 * project view and by Mission Control.
 */
async function sessionsWithTaskFolder(tasksDir: string): Promise<Set<string>> {
  try {
    const entries = await readdir(tasksDir, { withFileTypes: true });
    // Symlinks are kept: `glob` resolved them, so a symlinked task folder used to
    // work and must keep working. A symlink that turns out NOT to be a directory
    // costs one failed `readdir` in `taskFilesIn` and drops out there.
    return new Set(entries.filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => e.name));
  } catch {
    // Tasks dir assente/illeggibile: nessuna sessione ha task.
    return new Set();
  }
}

/** The task files of one session folder. Mirrors the previous `glob('*.json')`:
 *  direct children only, no dotfiles (glob's `*` never matches a leading dot),
 *  symlinks followed like glob did, and directories named `*.json` skipped
 *  rather than read (a directory that slips through fails `parseTaskFile`'s
 *  `readFile` and is dropped as unparseable, exactly as before). */
async function taskFilesIn(taskFolder: string): Promise<string[]> {
  try {
    const entries = await readdir(taskFolder, { withFileTypes: true });
    return entries
      .filter(
        e =>
          (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.json') && !e.name.startsWith('.')
      )
      .map(e => join(taskFolder, e.name));
  } catch {
    return [];
  }
}

// Per ogni sessione del progetto, controlla se esiste ~/.claude/tasks/{sessionId}/
// con file JSON e li raggruppa. Restituisce solo i gruppi non vuoti, sessione più recente prima.
export async function getProjectTasks(projectPath: string, tasksDir: string): Promise<TaskGroup[]> {
  try {
    // Both native layouts (`<hash>/sessions/*.jsonl` and `<hash>/*.jsonl`), like
    // every other project-transcript enumerator. Reading the root alone made this
    // return [] for every `sessions/`-layout project — no session id to intersect
    // with, so a full `~/.claude/tasks/<id>/` showed up as "no tasks" with no
    // error anywhere.
    const sessionFiles = await listProjectSessionFiles(projectPath);
    const withTasks = await sessionsWithTaskFolder(tasksDir);
    const groups: { group: TaskGroup; mtime: number }[] = [];

    for (const sessionFile of sessionFiles) {
      const filename = basename(sessionFile);
      const sessionId = basename(filename, '.jsonl');
      if (!withTasks.has(sessionId)) continue;
      const taskFolder = join(tasksDir, sessionId);

      const taskFiles = await taskFilesIn(taskFolder);
      if (taskFiles.length === 0) continue;

      const tasks = (await Promise.all(taskFiles.map(parseTaskFile)))
        .filter((t): t is Task => t !== null)
        // NaN-safe: a non-numeric id would make `Number(id)` NaN and the whole
        // comparator NaN → arbitrary order. Fall back to a stable string compare.
        .sort((a, b) => {
          const na = Number(a.id);
          const nb = Number(b.id);
          if (Number.isNaN(na) || Number.isNaN(nb)) return String(a.id).localeCompare(String(b.id));
          return na - nb;
        });

      if (tasks.length === 0) continue;

      let mtime = 0;
      try {
        mtime = (await stat(taskFolder)).mtimeMs;
      } catch {
        // ignora: ordina in fondo
      }

      groups.push({ group: { sessionId, filename, tasks }, mtime });
    }

    return groups.sort((a, b) => b.mtime - a.mtime).map(g => g.group);
  } catch (error) {
    console.error(`Errore leggendo task progetto: ${error}`);
    return [];
  }
}
