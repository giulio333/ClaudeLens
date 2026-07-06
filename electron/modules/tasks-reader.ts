import { readFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { glob } from 'glob';

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

function parseTaskFile(filePath: string): Task | null {
  try {
    const json = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
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

// Per ogni sessione del progetto, controlla se esiste ~/.claude/tasks/{sessionId}/
// con file JSON e li raggruppa. Restituisce solo i gruppi non vuoti, sessione più recente prima.
export async function getProjectTasks(projectPath: string, tasksDir: string): Promise<TaskGroup[]> {
  try {
    // Non-recursive: real session files are direct children. `**/*.jsonl` would
    // also match `{sessionId}/subagents/**/agent-*.jsonl`, triggering an extra
    // per-file glob for transcripts that never have a tasks folder (#95).
    const sessionFiles = await glob('*.jsonl', { cwd: projectPath, absolute: false });
    const groups: { group: TaskGroup; mtime: number }[] = [];

    for (const sessionFile of sessionFiles) {
      const filename = basename(sessionFile);
      const sessionId = basename(filename, '.jsonl');
      const taskFolder = join(tasksDir, sessionId);

      const taskFiles = await glob('*.json', { cwd: taskFolder, absolute: true });
      if (taskFiles.length === 0) continue;

      const tasks = taskFiles
        .map(parseTaskFile)
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
        mtime = statSync(taskFolder).mtimeMs;
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
