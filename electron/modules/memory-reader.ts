import { stat } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';
import { assertWithin } from '../utils';
import { parseFrontmatter, getString } from './frontmatter';
import { readTextFile } from './safe-fs';

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

/** One index line of `MEMORY.md`: `- [link text](file.md) — description`. */
export interface MemoryIndexLine {
  linkText: string;
  file: string;
  description: string;
}

const INDEX_LINE = /^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*[-—]\s*(.+)$/;

/** Pure: the index lines of a `MEMORY.md`, in file order. Non-matching lines (headers, blanks, prose) are skipped. */
export function parseIndexLines(content: string): MemoryIndexLine[] {
  const lines: MemoryIndexLine[] = [];
  for (const line of content.split('\n')) {
    const match = line.match(INDEX_LINE);
    if (match) lines.push({ linkText: match[1], file: match[2], description: match[3] });
  }
  return lines;
}

/**
 * A topic file read once: raw content, its parsed frontmatter and the birth/mtime
 * stamps the UI shows. The frontmatter is parsed here so the index and the body
 * map share one YAML load per file instead of one each.
 */
interface TopicFile {
  content: string;
  fm: TopicFrontmatter;
  createdAt: string;
  updatedAt: string;
}

/**
 * Read one topic file. `readTextFile` (async + timeout) instead of `readFileSync`
 * because a memory dir can sit on a real project path (`{realPath}/.claude/memory`)
 * — on iCloud Drive a dataless file materializes on first read and can stall for
 * seconds, which a sync read would pay for by freezing the whole main process.
 * Returns null when the file is gone or unreadable (the caller keeps going).
 */
async function readTopicFile(memoryDir: string, filename: string): Promise<TopicFile | null> {
  const filePath = join(memoryDir, filename);
  const [content, stamps] = await Promise.all([
    readTextFile(filePath).catch(() => null),
    stat(filePath).then(
      s => ({ createdAt: s.birthtime.toISOString(), updatedAt: s.mtime.toISOString() }),
      () => null
    ),
  ]);
  if (content === null) return null;

  const now = new Date().toISOString();
  return {
    content,
    fm: parseTopicFrontmatter(content),
    createdAt: stamps?.createdAt ?? now,
    updatedAt: stamps?.updatedAt ?? now,
  };
}

/** Whether a link target from `MEMORY.md` still resolves inside the memory dir. */
function isInside(memoryDir: string, relPath: string): boolean {
  try {
    assertWithin(memoryDir, join(memoryDir, relPath));
    return true;
  } catch {
    return false;
  }
}

/** Build a topic entry from an already-read file (or from nothing, for an index line whose file is missing). */
function toTopic(
  filename: string,
  file: TopicFile | null,
  overrides: { name?: string; description?: string }
): MemoryTopic {
  const fm: TopicFrontmatter = file?.fm ?? {};
  const now = new Date().toISOString();
  return {
    name: overrides.name ?? fm.name ?? filename,
    description: overrides.description ?? fm.description ?? `(from ${filename})`,
    type: fm.type ?? typeFromFilename(filename),
    filename,
    createdAt: file?.createdAt ?? now,
    updatedAt: file?.updatedAt ?? now,
    originSessionId: fm.originSessionId,
  };
}

/**
 * The index as declared by `MEMORY.md`: order and descriptions come from the
 * index, everything else from the topic file's frontmatter. An index line whose
 * file is missing stays in the index (the type falls back to the filename
 * prefix) so a desynced index is visible in the UI instead of silently short.
 */
async function indexFromMarkdown(
  memoryDir: string,
  indexContent: string,
  byFile: Map<string, TopicFile>
): Promise<MemoryTopic[]> {
  const lines = parseIndexLines(indexContent);

  // An index line may point outside the flat `*.md` listing (e.g. `sub/topic.md`).
  // Read only those, once each, in parallel — everything else is already in hand.
  // A link that escapes the memory dir is never read: it stays "missing", so the
  // entry still shows up in the UI but no outside file is ever opened.
  const unlisted = [...new Set(lines.map(l => l.file).filter(f => !byFile.has(f)))].filter(f =>
    isInside(memoryDir, f)
  );
  const extra = new Map(
    await Promise.all(unlisted.map(async f => [f, await readTopicFile(memoryDir, f)] as const))
  );

  return lines.map(line => {
    const file = byFile.get(line.file) ?? extra.get(line.file) ?? null;
    // Preferisce il nome dalla frontmatter del file topic se il link text è un filename
    const name = line.linkText.endsWith('.md') && file?.fm.name ? file.fm.name : line.linkText;
    return toTopic(line.file, file, { name, description: line.description });
  });
}

/** No `MEMORY.md`: index the topic files that declare a `name` in their frontmatter. */
function autoIndex(byFile: Map<string, TopicFile>): MemoryTopic[] {
  const topics: MemoryTopic[] = [];
  for (const [filename, file] of byFile) {
    if (!file.fm.name) continue;
    topics.push(toTopic(filename, file, {}));
  }
  return topics;
}

/**
 * Read a whole memory dir with ONE directory listing and ONE read per file.
 *
 * The previous version read every topic twice — once for the index's frontmatter,
 * once for the `topics` body map — plus `MEMORY.md` twice, all synchronously and
 * one after another. That cost is paid far more often than it looks: an append to
 * any session transcript carries the `memory` scope (topics record their origin
 * session), so a live chat re-invokes `memory:getProject` on every watcher burst.
 * On a 39-topic dir that was ~80 blocking reads per burst.
 */
async function readMemoryDir(
  memoryDir: string,
  isProjectLevel: boolean
): Promise<{
  index: MemoryTopic[];
  topics: Map<string, string>;
  memoryMd: { content: string; lineCount: number } | null;
}> {
  // A missing dir globs to nothing, which is also the right answer for an empty
  // one — no `existsSync` probe needed, and the listing decides whether
  // `MEMORY.md` exists too.
  let files: string[];
  try {
    files = await glob('*.md', { cwd: memoryDir, absolute: false });
  } catch (error) {
    console.error(`Errore listando la memory dir: ${error}`);
    return { index: [], topics: new Map(), memoryMd: null };
  }

  // Case-insensitively: the previous `existsSync('MEMORY.md')` probe found a
  // `memory.md` on macOS/Windows, and an index file must not degrade into a topic
  // just because of its case (nor behave differently per platform).
  const indexName = files.find(f => f.toLowerCase() === 'memory.md');
  const topicNames = files.filter(f => f !== indexName).sort();

  const [read, indexContent] = await Promise.all([
    Promise.all(topicNames.map(async f => [f, await readTopicFile(memoryDir, f)] as const)),
    indexName ? readTextFile(join(memoryDir, indexName)).catch(() => null) : null,
  ]);

  const byFile = new Map<string, TopicFile>();
  for (const [filename, file] of read) {
    if (file) byFile.set(filename, file);
  }

  const rawIndex =
    indexContent !== null
      ? await indexFromMarkdown(memoryDir, indexContent, byFile)
      : autoIndex(byFile);

  const index = isProjectLevel
    ? rawIndex.map(t => ({ ...t, isProjectLevel: true as const }))
    : rawIndex;

  // Chiave = filename: univoco e sempre allineato a MemoryTopic.filename.
  // Il name della frontmatter può divergere dal link text di MEMORY.md.
  const topics = new Map([...byFile].map(([filename, file]) => [filename, file.content]));

  const memoryMd =
    indexContent !== null
      ? { content: indexContent, lineCount: indexContent.split('\n').length }
      : null;

  return { index, topics, memoryMd };
}

export async function readMemory(projectPath: string, realPath?: string): Promise<MemoryData> {
  const userMemoryDir = join(projectPath, 'memory');

  // The two dirs are independent: read them concurrently instead of waiting for
  // the `~/.claude` one before touching the project-level (iCloud-prone) one.
  const [user, projectLevel] = await Promise.all([
    readMemoryDir(userMemoryDir, false),
    realPath ? readMemoryDir(join(realPath, '.claude', 'memory'), true) : null,
  ]);

  return {
    index: user.index,
    topics: user.topics,
    memoryMd: user.memoryMd,
    projectLevelIndex: projectLevel?.index ?? [],
    projectLevelTopics: projectLevel?.topics ?? new Map(),
    projectLevelMemoryMd: projectLevel?.memoryMd ?? null,
  };
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
