import { randomUUID } from 'crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import {
  MAX_TEMPLATE_NAME_LENGTH,
  type PromptTemplate,
  type PromptTemplateInput,
} from '../shared/playbook-types';
import { MAX_PROMPT_LENGTH, normalizePrompt, promptFingerprint } from './playbook-detector';

interface PlaybookStore {
  version: 1;
  templates: PromptTemplate[];
  dismissed: string[];
}

const mutations = new Map<string, Promise<unknown>>();
const MAX_STORE_BYTES = 8 * 1024 * 1024;
const MAX_TEMPLATES = 200;
const MAX_DISMISSED = 10_000;

export function validatePlaybookHash(hash: unknown): asserts hash is string {
  if (typeof hash !== 'string' || !/^[a-zA-Z0-9_-]{1,255}$/.test(hash)) {
    throw new Error('Invalid project hash.');
  }
}

export function validateTemplateInput(input: unknown): PromptTemplateInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('A template needs a name and text.');
  }
  const { name, text } = input as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_TEMPLATE_NAME_LENGTH) {
    throw new Error('Template names must contain 1–120 characters.');
  }
  validatePromptText(text);
  return { name: name.trim(), text };
}

function validatePromptText(text: unknown): asserts text is string {
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > MAX_PROMPT_LENGTH ||
    text.includes('\0')
  ) {
    throw new Error(`Prompt text must contain 1–${MAX_PROMPT_LENGTH} characters.`);
  }
}

function validateId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)) {
    throw new Error('Invalid template id.');
  }
}

async function assertSafePath(path: string, directory: boolean): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) {
      throw new Error('Playbook paths must be regular files and directories, not symbolic links.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function storePath(root: string, hash: unknown): Promise<string> {
  validatePlaybookHash(hash);
  await assertSafePath(dirname(root), true);
  await assertSafePath(root, true);
  await assertSafePath(join(root, hash), true);
  const file = join(root, hash, 'playbook.json');
  await assertSafePath(file, false);
  return file;
}

function parseStore(raw: string): PlaybookStore {
  const value = JSON.parse(raw) as PlaybookStore;
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.templates) ||
    !Array.isArray(value.dismissed) ||
    value.templates.length > MAX_TEMPLATES ||
    value.dismissed.length > MAX_DISMISSED
  ) {
    throw new Error('Invalid playbook format.');
  }
  const ids = new Set<string>();
  const texts = new Set<string>();
  for (const template of value.templates) {
    validateTemplateInput(template);
    validateId(template.id);
    if (
      typeof template.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(template.createdAt)) ||
      typeof template.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(template.updatedAt)) ||
      ids.has(template.id) ||
      texts.has(normalizePrompt(template.text))
    )
      throw new Error('Invalid template record.');
    ids.add(template.id);
    texts.add(normalizePrompt(template.text));
  }
  if (value.dismissed.some(id => typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id))) {
    throw new Error('Invalid dismissed fingerprints.');
  }
  return value;
}

export async function readPlaybook(root: string, hash: unknown): Promise<PlaybookStore> {
  const file = await storePath(root, hash);
  let raw: string;
  try {
    const info = await lstat(file);
    if (info.size > MAX_STORE_BYTES) throw new Error('Playbook store is too large.');
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 1, templates: [], dismissed: [] };
    throw error;
  }
  try {
    return parseStore(raw);
  } catch {
    throw new Error('The playbook store is corrupted. Restore or repair it before saving changes.');
  }
}

async function writeStore(root: string, hash: string, store: PlaybookStore): Promise<void> {
  const file = await storePath(root, hash);
  const raw = JSON.stringify(store, null, 2) + '\n';
  if (Buffer.byteLength(raw) > MAX_STORE_BYTES) throw new Error('Playbook storage limit reached.');
  await mkdir(join(root, hash), { recursive: true, mode: 0o700 });
  await storePath(root, hash);
  const temporary = join(root, hash, `.playbook-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function mutate<T>(root: string, hash: unknown, change: (store: PlaybookStore) => T): Promise<T> {
  validatePlaybookHash(hash);
  const key = join(root, hash);
  const operation = (mutations.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const store = await readPlaybook(root, hash);
      const result = change(store);
      await writeStore(root, hash, store);
      return result;
    });
  mutations.set(key, operation);
  void operation
    .finally(() => {
      if (mutations.get(key) === operation) mutations.delete(key);
    })
    .catch(() => undefined);
  return operation;
}

export function createPromptTemplate(
  root: string,
  hash: unknown,
  input: unknown
): Promise<PromptTemplate> {
  const validated = validateTemplateInput(input);
  return mutate(root, hash, store => {
    if (
      store.templates.some(item => normalizePrompt(item.text) === normalizePrompt(validated.text))
    ) {
      throw new Error('This prompt is already saved.');
    }
    if (store.templates.length >= MAX_TEMPLATES)
      throw new Error('This project already has 200 templates.');
    const now = new Date().toISOString();
    const template = { ...validated, id: randomUUID(), createdAt: now, updatedAt: now };
    store.templates.push(template);
    return template;
  });
}

export function updatePromptTemplate(
  root: string,
  hash: unknown,
  id: unknown,
  input: unknown
): Promise<PromptTemplate> {
  validateId(id);
  const validated = validateTemplateInput(input);
  return mutate(root, hash, store => {
    const existing = store.templates.find(item => item.id === id);
    if (!existing) throw new Error('Template not found.');
    if (
      store.templates.some(
        item => item.id !== id && normalizePrompt(item.text) === normalizePrompt(validated.text)
      )
    ) {
      throw new Error('This prompt is already saved.');
    }
    Object.assign(existing, validated, { updatedAt: new Date().toISOString() });
    return existing;
  });
}

export function deletePromptTemplate(root: string, hash: unknown, id: unknown): Promise<null> {
  validateId(id);
  return mutate(root, hash, store => {
    if (!store.templates.some(item => item.id === id)) throw new Error('Template not found.');
    store.templates = store.templates.filter(item => item.id !== id);
    return null;
  });
}

export function dismissPrompt(root: string, hash: unknown, text: unknown): Promise<null> {
  validatePromptText(text);
  return mutate(root, hash, store => {
    const id = promptFingerprint(text);
    if (!store.dismissed.includes(id)) {
      if (store.dismissed.length >= MAX_DISMISSED)
        throw new Error('Dismissed prompt limit reached.');
      store.dismissed.push(id);
    }
    return null;
  });
}
