import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';

export interface MemoryTopic {
  name: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  filename: string;
  createdAt: string;
  updatedAt: string;
  isProjectLevel?: boolean; // true = in {realPath}/.claude/memory/ (committed to repo)
}

export interface MemoryData {
  index: MemoryTopic[];
  topics: Map<string, string>;
  memoryMd: { content: string; lineCount: number } | null;
  projectLevelIndex: MemoryTopic[];
  projectLevelTopics: Map<string, string>;
  projectLevelMemoryMd: { content: string; lineCount: number } | null;
}

async function readMemoryIndex(memoryDir: string): Promise<MemoryTopic[]> {
  const memoryPath = join(memoryDir, 'MEMORY.md');

  if (existsSync(memoryPath)) {
    try {
      const content = readFileSync(memoryPath, 'utf-8');
      const lines = content.split('\n');
      const topics: MemoryTopic[] = [];

      for (const line of lines) {
        const match = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*[-—]\s*(.+)$/);
        if (match) {
          const [, linkText, file, description] = match;

          // Inferisce il tipo dal nome del file (fonte più affidabile)
          let type: 'user' | 'feedback' | 'project' | 'reference' = 'user';
          if (file.startsWith('feedback_')) type = 'feedback';
          else if (file.startsWith('project_')) type = 'project';
          else if (file.startsWith('reference_')) type = 'reference';

          // Preferisce il nome dalla frontmatter del file topic se il link text è un filename
          let name = linkText;
          if (linkText.endsWith('.md')) {
            const topicPath = join(memoryDir, file);
            if (existsSync(topicPath)) {
              const topicContent = readFileSync(topicPath, 'utf-8');
              const nameMatch = topicContent.match(/^name:\s*(.+)$/m);
              if (nameMatch) name = nameMatch[1].trim();
            }
          }

          let createdAt = new Date().toISOString();
          let updatedAt = new Date().toISOString();
          try {
            const s = statSync(join(memoryDir, file));
            createdAt = s.birthtime.toISOString();
            updatedAt = s.mtime.toISOString();
          } catch {}

          topics.push({ name, description, type, filename: file, createdAt, updatedAt });
        }
      }

      return topics;
    } catch (error) {
      console.error(`Errore leggendo MEMORY.md: ${error}`);
      return [];
    }
  }

  try {
    const files = await glob('*.md', { cwd: memoryDir, absolute: false });
    const topics: MemoryTopic[] = [];

    for (const file of files) {
      if (file === 'MEMORY.md') continue;

      try {
        const content = readFileSync(join(memoryDir, file), 'utf-8');
        const nameMatch = content.match(/^---\nname:\s*(.+?)\n/m);
        const descMatch = content.match(/^---\nname:.*?\ndescription:\s*(.+?)\n/ms);

        if (nameMatch) {
          const name = nameMatch[1];
          const description = descMatch ? descMatch[1] : `(from ${file})`;

          let type: 'user' | 'feedback' | 'project' | 'reference' = 'user';
          if (file.startsWith('feedback_')) type = 'feedback';
          else if (file.startsWith('project_')) type = 'project';
          else if (file.startsWith('reference_')) type = 'reference';

          let createdAt = new Date().toISOString();
          let updatedAt = new Date().toISOString();
          try {
            const s = statSync(join(memoryDir, file));
            createdAt = s.birthtime.toISOString();
            updatedAt = s.mtime.toISOString();
          } catch {}

          topics.push({ name, description, type, filename: file, createdAt, updatedAt });
        }
      } catch (e) {
        // Ignora file non leggibili
      }
    }

    return topics;
  } catch (error) {
    console.error(`Errore generando indice automatico: ${error}`);
    return [];
  }
}

async function readTopicFiles(memoryDir: string): Promise<Map<string, string>> {
  const topics = new Map<string, string>();

  try {
    const files = await glob('*.md', { cwd: memoryDir, absolute: false });

    for (const file of files) {
      if (file === 'MEMORY.md') continue;

      const filePath = join(memoryDir, file);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const nameMatch = content.match(/^name:\s*(.+)$/m);
        const name = nameMatch ? nameMatch[1].trim() : file.replace('.md', '');
        topics.set(name, content);
      } catch (e) {
        // Ignora file non leggibili
      }
    }
  } catch (error) {
    console.error(`Errore leggendo topic files: ${error}`);
  }

  return topics;
}

async function readMemoryDir(memoryDir: string, isProjectLevel: boolean): Promise<{
  index: MemoryTopic[];
  topics: Map<string, string>;
  memoryMd: { content: string; lineCount: number } | null;
}> {
  if (!existsSync(memoryDir)) {
    return { index: [], topics: new Map(), memoryMd: null };
  }

  const [rawIndex, topics] = await Promise.all([
    readMemoryIndex(memoryDir),
    readTopicFiles(memoryDir),
  ]);

  const index = isProjectLevel
    ? rawIndex.map(t => ({ ...t, isProjectLevel: true as const }))
    : rawIndex;

  let memoryMd: { content: string; lineCount: number } | null = null;
  const memoryPath = join(memoryDir, 'MEMORY.md');
  if (existsSync(memoryPath)) {
    const content = readFileSync(memoryPath, 'utf-8');
    memoryMd = { content, lineCount: content.split('\n').length };
  }

  return { index, topics, memoryMd };
}

export async function readMemory(projectPath: string, realPath?: string): Promise<MemoryData> {
  const userMemoryDir = join(projectPath, 'memory');
  const { index, topics, memoryMd } = await readMemoryDir(userMemoryDir, false);

  let projectLevelIndex: MemoryTopic[] = [];
  let projectLevelTopics = new Map<string, string>();
  let projectLevelMemoryMd: { content: string; lineCount: number } | null = null;

  if (realPath) {
    const projectMemoryDir = join(realPath, '.claude', 'memory');
    const projectData = await readMemoryDir(projectMemoryDir, true);
    projectLevelIndex = projectData.index;
    projectLevelTopics = projectData.topics;
    projectLevelMemoryMd = projectData.memoryMd;
  }

  return { index, topics, memoryMd, projectLevelIndex, projectLevelTopics, projectLevelMemoryMd };
}

export async function listProjectsWithMemory(claudeDir: string): Promise<string[]> {
  try {
    const projectDirs = await glob('*', { cwd: claudeDir, absolute: false });
    return projectDirs.sort();
  } catch (error) {
    console.error(`Errore listando progetti: ${error}`);
    return [];
  }
}
