import { writeFileSync, existsSync, unlinkSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface TopicInput {
  name: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
  content: string;
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

function buildTopicFileContent(input: TopicInput): string {
  return `---\nname: ${input.name}\ndescription: ${input.description}\ntype: ${input.type}\n---\n\n${input.content.trimEnd()}\n`;
}

function addLineToMemoryMd(memoryPath: string, filename: string, description: string): void {
  const line = `- [${filename}](${filename}) — ${description}`;
  if (existsSync(memoryPath)) {
    const current = readFileSync(memoryPath, 'utf-8').trimEnd();
    writeFileSync(memoryPath, current + '\n' + line + '\n', 'utf-8');
  } else {
    writeFileSync(memoryPath, `# Memory Index\n\n${line}\n`, 'utf-8');
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
      ? `- [${filename}](${filename}) — ${newDescription}`
      : l
  );
  writeFileSync(memoryPath, lines.join('\n'), 'utf-8');
}

export function createTopic(memoryDir: string, input: TopicInput): string {
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
  const filename = nameToFilename(input.type, input.name);
  writeFileSync(join(memoryDir, filename), buildTopicFileContent(input), 'utf-8');
  addLineToMemoryMd(join(memoryDir, 'MEMORY.md'), filename, input.description);
  return filename;
}

export function updateTopic(memoryDir: string, filename: string, input: TopicInput): void {
  writeFileSync(join(memoryDir, filename), buildTopicFileContent(input), 'utf-8');
  updateLineInMemoryMd(join(memoryDir, 'MEMORY.md'), filename, input.description);
}

export function deleteTopic(memoryDir: string, filename: string): void {
  const filePath = join(memoryDir, filename);
  if (existsSync(filePath)) unlinkSync(filePath);
  removeLineFromMemoryMd(join(memoryDir, 'MEMORY.md'), filename);
}
