import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

export interface ClaudeMdLayer {
  scope: 'global' | 'project' | 'local' | 'subdir';
  filePath: string;
  content: string;
}

export interface ClaudeMdHierarchy {
  layers: ClaudeMdLayer[];
}

export function readGlobalClaudeMd(claudeDir: string): string | undefined {
  const globalPath = join(claudeDir, 'CLAUDE.md');
  if (!existsSync(globalPath)) return undefined;

  try {
    return readFileSync(globalPath, 'utf-8');
  } catch (error) {
    console.error(`Errore leggendo CLAUDE.md globale: ${error}`);
    return undefined;
  }
}

export function readProjectClaudeMd(realProjectPath: string): string | undefined {
  function searchClaudeMd(dir: string, depth: number = 0): string | undefined {
    if (depth > 3) return undefined;
    if (!existsSync(dir)) return undefined;

    const claudeMdPath = join(dir, 'CLAUDE.md');
    if (existsSync(claudeMdPath)) {
      try {
        return readFileSync(claudeMdPath, 'utf-8');
      } catch (error) {
        // Continua la ricerca
      }
    }

    return undefined;
  }

  try {
    return searchClaudeMd(realProjectPath, 0);
  } catch (error) {
    console.error(`Errore cercando CLAUDE.md nel progetto: ${error}`);
    return undefined;
  }
}

function tryRead(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
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

export function getClaudeMdHierarchy(realPath: string): ClaudeMdHierarchy {
  const claudeDir = join(os.homedir(), '.claude');
  const layers: ClaudeMdLayer[] = [];

  // 1. Global
  const globalContent = tryRead(join(claudeDir, 'CLAUDE.md'));
  if (globalContent !== undefined) {
    layers.push({ scope: 'global', filePath: join(claudeDir, 'CLAUDE.md'), content: globalContent });
  }

  // 2. Project root
  const projectContent = tryRead(join(realPath, 'CLAUDE.md'));
  if (projectContent !== undefined) {
    layers.push({ scope: 'project', filePath: join(realPath, 'CLAUDE.md'), content: projectContent });
  }

  // 3. Local override
  const localContent = tryRead(join(realPath, 'CLAUDE.local.md'));
  if (localContent !== undefined) {
    layers.push({ scope: 'local', filePath: join(realPath, 'CLAUDE.local.md'), content: localContent });
  }

  // 4. .claude/CLAUDE.md nel progetto
  const subdirContent = tryRead(join(realPath, '.claude', 'CLAUDE.md'));
  if (subdirContent !== undefined) {
    layers.push({ scope: 'subdir', filePath: join(realPath, '.claude', 'CLAUDE.md'), content: subdirContent });
  }

  // 5. Cerca ricorsivamente tutti i CLAUDE.md nelle sottocartelle
  const allClaudeMdFiles = findAllClaudeMd(realPath);
  for (const filePath of allClaudeMdFiles) {
    // Salta i file già aggiunti
    if (!layers.some(l => l.filePath === filePath)) {
      const content = tryRead(filePath);
      if (content !== undefined) {
        layers.push({ scope: 'subdir', filePath, content });
      }
    }
  }

  return { layers };
}
