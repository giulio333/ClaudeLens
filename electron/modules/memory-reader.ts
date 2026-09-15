import { stat } from 'fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path';
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
  isExternal?: boolean; // true = il file vive nella memory dir di un ALTRO progetto (link assoluto in MEMORY.md)
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
// Sul basename e non sul target grezzo: una riga d'indice può portare un path
// (`sub/topic.md`, o un link assoluto alla memory dir di un altro progetto), e
// nessun prefisso combacerebbe mai.
function typeFromFilename(file: string): TopicType {
  const name = basename(file);
  if (name.startsWith('feedback_')) return 'feedback';
  if (name.startsWith('project_')) return 'project';
  if (name.startsWith('reference_')) return 'reference';
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
 * Read one topic file, by absolute path. `readTextFile` (async + timeout) instead
 * of `readFileSync` because a memory dir can sit on a real project path
 * (`{realPath}/.claude/memory`) — on iCloud Drive a dataless file materializes on
 * first read and can stall for seconds, which a sync read would pay for by
 * freezing the whole main process.
 * Returns null when the file is gone or unreadable (the caller keeps going).
 */
async function readTopicFile(filePath: string): Promise<TopicFile | null> {
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

/** Dove un target di `MEMORY.md` va letto davvero, o `null` se non va letto. */
interface IndexTarget {
  path: string;
  /** Il file sta nella memory dir di un ALTRO progetto: qui si legge, non si scrive. */
  external: boolean;
}

/**
 * Risolve il target di una riga d'indice al file da aprire.
 *
 * Un target **relativo** resta confinato nella memory dir, come sempre.
 *
 * Un target **assoluto** esiste perché l'utente condivide a mano una memoria fra
 * due progetti — il `MEMORY.md` di ACME_CORE indicizza sei memorie che vivono
 * nella dir di ACME_CORE_4.0. Prima finiva in `join(memoryDir, '/Users/…')`,
 * che NON resetta su un path assoluto: concatena, e il path inventato che ne
 * usciva passava il controllo di contenimento, non esisteva, e lasciava la
 * memoria senza corpo — quindi senza wikilink, quindi per sempre fra le
 * "unconnected" della mappa.
 *
 * Il permesso è stretto di proposito: solo un `.md` dentro la `memory/` di un
 * progetto **fratello** (`<projects>/<altro progetto>/memory/…`), e solo per la
 * memory dir utente. Per quella di progetto (`{realPath}/.claude/memory`, che sta
 * nel repo ed è scritta da chiunque committi) i link assoluti restano rifiutati:
 * un `MEMORY.md` versionato non deve poter far aprire all'app un file scelto da
 * lui altrove nell'albero.
 */
function resolveIndexTarget(
  memoryDir: string,
  target: string,
  allowSiblingProjects: boolean
): IndexTarget | null {
  if (!isAbsolute(target)) {
    const path = join(memoryDir, target);
    try {
      assertWithin(memoryDir, path);
    } catch {
      return null;
    }
    return { path, external: false };
  }

  if (!allowSiblingProjects) return null;
  const path = resolve(target);
  if (!path.endsWith('.md')) return null;
  // `~/.claude/projects` quando `memoryDir` è `~/.claude/projects/{hash}/memory`.
  const projectsRoot = dirname(dirname(memoryDir));
  try {
    assertWithin(projectsRoot, path);
  } catch {
    return null;
  }
  // Forma richiesta: `<projects>/<un solo segmento>/memory/…`. Il contenimento
  // da solo aprirebbe qualunque file sotto la root, transcript compresi.
  const segments = relative(projectsRoot, path).split(sep);
  if (segments.length < 3 || segments[1] !== 'memory') return null;
  return { path, external: relative(memoryDir, path).startsWith('..') };
}

/** Build a topic entry from an already-read file (or from nothing, for an index line whose file is missing). */
function toTopic(
  filename: string,
  file: TopicFile | null,
  overrides: { name?: string; description?: string; isExternal?: boolean }
): MemoryTopic {
  const fm: TopicFrontmatter = file?.fm ?? {};
  const now = new Date().toISOString();
  return {
    name: overrides.name ?? fm.name ?? basename(filename),
    description: overrides.description ?? fm.description ?? `(from ${basename(filename)})`,
    type: fm.type ?? typeFromFilename(filename),
    filename,
    createdAt: file?.createdAt ?? now,
    updatedAt: file?.updatedAt ?? now,
    originSessionId: fm.originSessionId,
    ...(overrides.isExternal ? { isExternal: true as const } : {}),
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
  byFile: Map<string, TopicFile>,
  allowSiblingProjects: boolean
): Promise<{ index: MemoryTopic[]; extra: Map<string, TopicFile> }> {
  const lines = parseIndexLines(indexContent);

  // An index line may point outside the flat `*.md` listing (e.g. `sub/topic.md`,
  // or the memory dir of a sibling project). Read only those, once each, in
  // parallel — everything else is already in hand. A link `resolveIndexTarget`
  // refuses is never read: it stays "missing", so the entry still shows up in the
  // UI but no outside file is ever opened.
  const targets = new Map<string, IndexTarget>();
  for (const f of new Set(lines.map(l => l.file))) {
    if (byFile.has(f)) continue;
    const target = resolveIndexTarget(memoryDir, f, allowSiblingProjects);
    if (target) targets.set(f, target);
  }
  const read = await Promise.all(
    [...targets].map(async ([f, t]) => [f, await readTopicFile(t.path)] as const)
  );
  // Chiave = il target grezzo della riga d'indice, cioè `MemoryTopic.filename`:
  // è con quello che il renderer cerca il corpo in `MemoryData.topics`.
  const extra = new Map<string, TopicFile>();
  for (const [f, file] of read) if (file) extra.set(f, file);

  const index = lines.map(line => {
    const file = byFile.get(line.file) ?? extra.get(line.file) ?? null;
    // Preferisce il nome dalla frontmatter del file topic se il link text è un filename
    const name = line.linkText.endsWith('.md') && file?.fm.name ? file.fm.name : line.linkText;
    return toTopic(line.file, file, {
      name,
      description: line.description,
      isExternal: targets.get(line.file)?.external,
    });
  });
  return { index, extra };
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
    Promise.all(topicNames.map(async f => [f, await readTopicFile(join(memoryDir, f))] as const)),
    indexName ? readTextFile(join(memoryDir, indexName)).catch(() => null) : null,
  ]);

  const byFile = new Map<string, TopicFile>();
  for (const [filename, file] of read) {
    if (file) byFile.set(filename, file);
  }

  const fromIndex =
    indexContent !== null
      ? await indexFromMarkdown(memoryDir, indexContent, byFile, !isProjectLevel)
      : null;
  const rawIndex = fromIndex?.index ?? autoIndex(byFile);

  const index = isProjectLevel
    ? rawIndex.map(t => ({ ...t, isProjectLevel: true as const }))
    : rawIndex;

  // Chiave = filename: univoco e sempre allineato a MemoryTopic.filename.
  // Il name della frontmatter può divergere dal link text di MEMORY.md.
  // I file che l'indice ha fatto leggere fuori dal listato piatto entrano qui:
  // senza di loro una memoria indicizzata per path avrebbe una scheda vuota e
  // nessun `[[wikilink]]` da mettere sulla mappa.
  const topics = new Map(
    [...byFile, ...(fromIndex?.extra ?? [])].map(([filename, file]) => [filename, file.content])
  );

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
