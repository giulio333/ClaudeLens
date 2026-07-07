import { writeFileSync, existsSync, unlinkSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { assertWithin } from '../utils';
import { yamlScalar } from './frontmatter';

const VALID_TOPIC_TYPES = ['user', 'feedback', 'project', 'reference'] as const;

export interface TopicInput {
  name: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  content: string;
  originSessionId?: string;
}

function nameToFilename(type: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return `${type}_${slug}.md`;
}

// Both the YAML frontmatter and the line-oriented MEMORY.md index are
// single-line structures. Collapse any newline/whitespace run to a single
// space so a multi-line value can't break the frontmatter block or inject a
// stray line into the index.
function sanitizeInline(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildTopicFileContent(input: TopicInput): string {
  const name = sanitizeInline(input.name);
  const description = sanitizeInline(input.description);
  // Preserva la provenienza (sessione che ha generato la memoria) attraverso
  // un re-save dalla UI: senza questa riga l'edit di un topic ne perderebbe
  // l'originSessionId. Annidato sotto `metadata:` per restare compatibile col
  // formato dell'auto-memory dell'harness.
  // Quote every scalar (yamlScalar) so a value with a colon — extremely common
  // in a description — doesn't break the YAML block. memory-reader parses this
  // with js-yaml, which throws on an unquoted `: ` and drops the whole block,
  // losing the topic's type and originSessionId on read.
  const origin = input.originSessionId
    ? `metadata:\n  originSessionId: ${yamlScalar(sanitizeInline(input.originSessionId))}\n`
    : '';
  return `---\nname: ${yamlScalar(name)}\ndescription: ${yamlScalar(description)}\ntype: ${input.type}\n${origin}---\n\n${input.content.trimEnd()}\n`;
}

function addLineToMemoryMd(memoryPath: string, filename: string, description: string): void {
  const line = `- [${filename}](${filename}) — ${sanitizeInline(description)}`;
  if (!existsSync(memoryPath)) {
    writeFileSync(memoryPath, `# Memory Index\n\n${line}\n`, 'utf-8');
    return;
  }
  const lines = readFileSync(memoryPath, 'utf-8').split('\n');
  const idx = lines.findIndex(l => l.includes(`(${filename})`));
  if (idx >= 0) {
    // Already indexed: replace in place rather than appending a duplicate.
    lines[idx] = line;
    writeFileSync(memoryPath, lines.join('\n'), 'utf-8');
  } else {
    const current = lines.join('\n').trimEnd();
    writeFileSync(memoryPath, current + '\n' + line + '\n', 'utf-8');
  }
}

function removeLineFromMemoryMd(memoryPath: string, filename: string): void {
  if (!existsSync(memoryPath)) return;
  const lines = readFileSync(memoryPath, 'utf-8')
    .split('\n')
    .filter(l => !l.includes(`(${filename})`));
  writeFileSync(memoryPath, lines.join('\n'), 'utf-8');
}

function updateLineInMemoryMd(memoryPath: string, filename: string, newDescription: string): void {
  if (!existsSync(memoryPath)) return;
  const lines = readFileSync(memoryPath, 'utf-8').split('\n').map(l =>
    l.includes(`(${filename})`)
      ? `- [${filename}](${filename}) — ${sanitizeInline(newDescription)}`
      : l
  );
  writeFileSync(memoryPath, lines.join('\n'), 'utf-8');
}

// Distinct display names can fold to the same slug (e.g. `Café`, `Cafe`,
// `Café!` → `user_cafe.md`). Append a numeric suffix so a new topic never
// silently overwrites an existing one.
function uniqueFilename(memoryDir: string, base: string): string {
  if (!existsSync(join(memoryDir, base))) return base;
  const stem = base.replace(/\.md$/, '');
  let n = 2;
  while (existsSync(join(memoryDir, `${stem}_${n}.md`))) n++;
  return `${stem}_${n}.md`;
}

// The slug only keeps [a-z0-9_], so the name can't traverse; but `type` is
// interpolated into the filename, and a name that slugs to empty would yield a
// bare "type_.md". Guard both before touching the filesystem.
function validateTopicInput(input: TopicInput): void {
  if (!VALID_TOPIC_TYPES.includes(input.type)) {
    throw new Error(`Invalid topic type "${input.type}".`);
  }
  const slug = nameToFilename(input.type, input.name).replace(`${input.type}_`, '').replace(/\.md$/, '');
  if (!slug) {
    throw new Error(`Invalid topic name "${input.name}": produces an empty slug.`);
  }
}

export function createTopic(memoryDir: string, input: TopicInput): string {
  validateTopicInput(input);
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
  const filename = uniqueFilename(memoryDir, nameToFilename(input.type, input.name));
  const target = join(memoryDir, filename);
  assertWithin(memoryDir, target);
  writeFileSync(target, buildTopicFileContent(input), 'utf-8');
  addLineToMemoryMd(join(memoryDir, 'MEMORY.md'), filename, input.description);
  return filename;
}

export function updateTopic(memoryDir: string, filename: string, input: TopicInput): void {
  validateTopicInput(input);
  const target = join(memoryDir, filename);
  assertWithin(memoryDir, target);
  // Update must target an existing topic. Without this guard writeFileSync would
  // silently CREATE the file, and updateLineInMemoryMd — which only rewrites an
  // already-present index line — would leave it out of MEMORY.md: an orphaned,
  // unindexed topic. Creation is createTopic's job (it indexes + dedupes names).
  if (!existsSync(target)) {
    throw new Error(`Cannot update topic "${filename}": it does not exist.`);
  }
  writeFileSync(target, buildTopicFileContent(input), 'utf-8');
  updateLineInMemoryMd(join(memoryDir, 'MEMORY.md'), filename, input.description);
}

export function deleteTopic(memoryDir: string, filename: string): void {
  const filePath = join(memoryDir, filename);
  assertWithin(memoryDir, filePath);
  if (existsSync(filePath)) unlinkSync(filePath);
  removeLineFromMemoryMd(join(memoryDir, 'MEMORY.md'), filename);
}
