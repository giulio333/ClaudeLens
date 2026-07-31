import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';
import { parseFrontmatter, getString } from './frontmatter';

export interface MemoryTopic {
  name: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  filename: string;
  createdAt: string;
  updatedAt: string;
  isProjectLevel?: boolean; // true = in {realPath}/.claude/memory/ (committed to repo)
  originSessionId?: string; // sessione (.jsonl UUID) che ha generato la memoria, se dichiarata nel frontmatter
}

type TopicType = 'user' | 'feedback' | 'project' | 'reference';

interface TopicFrontmatter {
  name?: string;
  description?: string;
  type?: TopicType;
  originSessionId?: string;
}

// Inferenza di fallback: il prefisso del filename codifica il tipo per i topic
// scritti da ClaudeLens. Usato solo quando il frontmatter non dichiara `type`.
function typeFromFilename(file: string): TopicType {
  if (file.startsWith('feedback_')) return 'feedback';
  if (file.startsWith('project_')) return 'project';
  if (file.startsWith('reference_')) return 'reference';
  return 'user';
}

// Legge i campi rilevanti dal frontmatter YAML, gestendo sia il formato piatto
// di ClaudeLens (`type:` top-level) sia quello annidato dell'auto-memory
// dell'harness (`metadata:` → `type:`/`originSessionId:`). Ogni chiave è cercata
// prima al top-level e poi sotto `metadata:`, così entrambe le forme funzionano.
// `node_type` non viene mai scambiato per `type`: si interroga la chiave esatta.
function parseTopicFrontmatter(content: string): TopicFrontmatter {
  const { frontmatter } = parseFrontmatter(content);
  const metadata =
    frontmatter.metadata && typeof frontmatter.metadata === 'object'
      ? (frontmatter.metadata as Record<string, unknown>)
      : {};

  // Top-level prima, poi fallback su metadata (replica la vecchia ricerca
  // "ovunque nel blocco" senza confondere chiavi tipo `node_type`).
  const get = (k: string) => getString(frontmatter, k) ?? getString(metadata, k);

  const rawType = get('type');
  const type =
    rawType === 'user' || rawType === 'feedback' || rawType === 'project' || rawType === 'reference'
      ? rawType
      : undefined;
  return {
    name: get('name'),
    description: get('description'),
    type,
    originSessionId: get('originSessionId'),
  };
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

          // Legge il frontmatter del file topic: il `type` dichiarato prevale
          // sull'inferenza dal nome file, ed espone l'eventuale originSessionId.
          const topicPath = join(memoryDir, file);
          const fm: TopicFrontmatter = existsSync(topicPath)
            ? parseTopicFrontmatter(readFileSync(topicPath, 'utf-8'))
            : {};

          const type = fm.type ?? typeFromFilename(file);

          // Preferisce il nome dalla frontmatter del file topic se il link text è un filename
          let name = linkText;
          if (linkText.endsWith('.md') && fm.name) name = fm.name;

          let createdAt = new Date().toISOString();
          let updatedAt = new Date().toISOString();
          try {
            const s = statSync(join(memoryDir, file));
            createdAt = s.birthtime.toISOString();
            updatedAt = s.mtime.toISOString();
          } catch {}

          topics.push({
            name,
            description,
            type,
            filename: file,
            createdAt,
            updatedAt,
            originSessionId: fm.originSessionId,
          });
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
        const fm = parseTopicFrontmatter(content);

        if (fm.name) {
          const name = fm.name;
          const description = fm.description ?? `(from ${file})`;
          const type = fm.type ?? typeFromFilename(file);

          let createdAt = new Date().toISOString();
          let updatedAt = new Date().toISOString();
          try {
            const s = statSync(join(memoryDir, file));
            createdAt = s.birthtime.toISOString();
            updatedAt = s.mtime.toISOString();
          } catch {}

          topics.push({
            name,
            description,
            type,
            filename: file,
            createdAt,
            updatedAt,
            originSessionId: fm.originSessionId,
          });
        }
      } catch {
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
        // Chiave = filename: univoco e sempre allineato a MemoryTopic.filename.
        // Il name della frontmatter può divergere dal link text di MEMORY.md.
        topics.set(file, content);
      } catch {
        // Ignora file non leggibili
      }
    }
  } catch (error) {
    console.error(`Errore leggendo topic files: ${error}`);
  }

  return topics;
}

async function readMemoryDir(
  memoryDir: string,
  isProjectLevel: boolean
): Promise<{
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
