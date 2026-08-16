import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { basename, dirname, join } from 'path';
import { CLAUDE_DIR } from '../utils';
import { readTextFile } from './safe-fs';

export interface ClaudeMdLayer {
  scope: 'global' | 'project' | 'local' | 'subdir';
  filePath: string;
  content: string;
}

export interface ClaudeMdHierarchy {
  layers: ClaudeMdLayer[];
}

export async function readGlobalClaudeMd(claudeDir: string): Promise<string | undefined> {
  const globalPath = join(claudeDir, 'CLAUDE.md');
  if (!existsSync(globalPath)) return undefined;

  try {
    return await readTextFile(globalPath);
  } catch (error) {
    console.error(`Errore leggendo CLAUDE.md globale: ${error}`);
    return undefined;
  }
}

async function tryRead(filePath: string): Promise<string | undefined> {
  if (!existsSync(filePath)) return undefined;
  try {
    return await readTextFile(filePath);
  } catch (error) {
    console.error(`Errore leggendo ${filePath}: ${error}`);
    return undefined;
  }
}

function findAllClaudeMd(dir: string, maxDepth: number = 5, currentDepth: number = 0): string[] {
  if (currentDepth >= maxDepth || !existsSync(dir)) return [];

  const claudeMdFiles: string[] = [];
  const excludeDirs = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.venv', 'venv']);

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !excludeDirs.has(entry.name)) {
        const subDir = join(dir, entry.name);
        claudeMdFiles.push(...findAllClaudeMd(subDir, maxDepth, currentDepth + 1));
      }
    }
  } catch {
    // Ignora errori di lettura directory
  }

  // Cerca CLAUDE.md nella directory attuale
  const claudeMdPath = join(dir, 'CLAUDE.md');
  if (existsSync(claudeMdPath)) {
    claudeMdFiles.unshift(claudeMdPath);
  }

  return claudeMdFiles;
}

/**
 * The single CLAUDE.md a project description can be derived from: the project
 * root, else the `.claude/` one. Deliberately NOT `getClaudeMdHierarchy`, which
 * walks the whole source tree to depth 5 — this read is mounted by the project
 * hero, where that scan would be paid on every open.
 */
export async function readProjectClaudeMd(
  realPath: string
): Promise<{ content: string; filePath: string } | null> {
  for (const filePath of [join(realPath, 'CLAUDE.md'), join(realPath, '.claude', 'CLAUDE.md')]) {
    const content = await tryRead(filePath);
    if (content !== undefined && content.trim()) return { content, filePath };
  }
  return null;
}

export function writeClaudeMdFile(filePath: string, content: string): void {
  const allowedBasenames = new Set(['CLAUDE.md', 'CLAUDE.local.md']);
  const base = basename(filePath);
  if (!allowedBasenames.has(base)) {
    throw new Error(`Refusing to write non-CLAUDE.md file: ${filePath}`);
  }
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

export async function getClaudeMdHierarchy(realPath: string): Promise<ClaudeMdHierarchy> {
  const claudeDir = CLAUDE_DIR;
  const layers: ClaudeMdLayer[] = [];

  // 1. Global
  const globalContent = await tryRead(join(claudeDir, 'CLAUDE.md'));
  if (globalContent !== undefined) {
    layers.push({
      scope: 'global',
      filePath: join(claudeDir, 'CLAUDE.md'),
      content: globalContent,
    });
  }

  // 2. Project root
  const projectContent = await tryRead(join(realPath, 'CLAUDE.md'));
  if (projectContent !== undefined) {
    layers.push({
      scope: 'project',
      filePath: join(realPath, 'CLAUDE.md'),
      content: projectContent,
    });
  }

  // 3. Local override
  const localContent = await tryRead(join(realPath, 'CLAUDE.local.md'));
  if (localContent !== undefined) {
    layers.push({
      scope: 'local',
      filePath: join(realPath, 'CLAUDE.local.md'),
      content: localContent,
    });
  }

  // 4. .claude/CLAUDE.md nel progetto
  const subdirContent = await tryRead(join(realPath, '.claude', 'CLAUDE.md'));
  if (subdirContent !== undefined) {
    layers.push({
      scope: 'subdir',
      filePath: join(realPath, '.claude', 'CLAUDE.md'),
      content: subdirContent,
    });
  }

  // 5. Cerca ricorsivamente tutti i CLAUDE.md nelle sottocartelle
  const allClaudeMdFiles = findAllClaudeMd(realPath);
  for (const filePath of allClaudeMdFiles) {
    // Salta i file già aggiunti
    if (!layers.some(l => l.filePath === filePath)) {
      const content = await tryRead(filePath);
      if (content !== undefined) {
        layers.push({ scope: 'subdir', filePath, content });
      }
    }
  }

  return { layers };
}
