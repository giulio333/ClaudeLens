// One-line project description, derived from the project's CLAUDE.md.
//
// The file is read as a SOURCE only — nothing here ever writes back to it. The
// user's own wording lives in ClaudeLens' own prefs store (renderer key
// `cl-project-descriptions`), and overrides whatever this module derives.
//
// Why the naive rule ("first heading, else first sentence") is not enough:
// measured against the CLAUDE.md files on this machine, it produced a title of
// `CLAUDE.md` and the lead sentence "This file provides guidance to Claude Code
// (claude.ai/code) when working with code in this repository" on 2 of 5
// projects — the boilerplate `/init` writes, which describes the *file*, not
// the project. So the derivation walks a short ladder of candidates and skips
// the ones that say nothing:
//
//   1. the lead paragraph (the prose right under the H1) — the canonical spot
//   2. the first paragraph under a descriptive heading (Overview, Architecture,
//      "Cos'è questo progetto", …) — where `/init`-style files put it
//   3. the first ordinary paragraph anywhere
//   4. the H1 itself, if it isn't generic or just the folder name again
//
// On the five real files this picks the right sentence for all of them.

export const PROJECT_DESCRIPTION_MAX = 140;

export type DescriptionSource = 'lead' | 'section' | 'prose' | 'title';

export interface DerivedDescription {
  text: string;
  /** Which rung of the ladder produced it (shown as provenance in the UI). */
  source: DescriptionSource;
  /** The heading the text was taken from, when it came from one. */
  heading?: string;
}

export interface DeriveOptions {
  /** Project folder name; a title that merely repeats it adds nothing. */
  projectName?: string;
  max?: number;
}

// Prose the `/init` command writes about the file itself. It is the single most
// common first paragraph in the wild and describes nothing about the project.
const BOILERPLATE = [
  /^this file provides guidance to claude/i,
  /^this document provides guidance to claude/i,
  /^questo file fornisce (istruzioni|indicazioni)/i,
  /^guidance for claude code when working/i,
];

// Titles that name the file or the tool instead of the project.
const GENERIC_TITLES = new Set([
  'claude.md',
  'claude',
  'claude code',
  'claude code configuration',
  'claude code instructions',
  'agents.md',
  'agent instructions',
  'readme',
  'instructions',
  'project instructions',
]);

// Headings under which a file that starts with boilerplate keeps its actual
// description. Matched as substrings on the lowercased heading text.
const DESCRIPTIVE_HEADINGS = [
  'overview',
  'panoramica',
  'about',
  'introduction',
  'intro',
  'what is',
  "cos'è",
  'cos è',
  'che cosa',
  'purpose',
  'scopo',
  'architecture',
  'architettura',
  'summary',
  'descrizione',
  'description',
  'il progetto',
  'the project',
  'context',
  'contesto',
];

// Dots that end an abbreviation rather than a sentence.
const ABBREVIATIONS = /(?:^|\s)(?:e\.g|i\.e|etc|vs|cf|ecc|es|ca|approx|fig|no)\.$/i;

type Block = { kind: 'heading'; level: number; text: string } | { kind: 'paragraph'; text: string };

/**
 * Split markdown into the two block kinds this derivation cares about, dropping
 * everything that cannot be a description: frontmatter, fenced code, lists,
 * tables, quotes, badge/image-only lines and HTML.
 */
export function blocksOf(markdown: string): Block[] {
  const lines = stripFrontmatter(markdown).split(/\r?\n/);
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join(' ').trim();
    buffer = [];
    if (text) blocks.push({ kind: 'paragraph', text });
  };

  for (const raw of lines) {
    const line = raw.trim();

    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      if (fence === null) {
        flush();
        fence = fenceMatch[1][0];
      } else if (line.startsWith(fence)) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) continue;

    if (!line) {
      flush();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const text = cleanInline(heading[2]).replace(/\s*#+\s*$/, '');
      if (text) blocks.push({ kind: 'heading', level: heading[1].length, text });
      continue;
    }

    // Not prose: lists, tables, quotes, thematic breaks, HTML, badge rows.
    if (/^([-*+]\s|\d+[.)]\s|>|\||<|-{3,}$|={3,}$|!\[)/.test(line)) {
      flush();
      continue;
    }

    buffer.push(line);
  }
  flush();

  return blocks;
}

export function deriveProjectDescription(
  markdown: string,
  opts: DeriveOptions = {}
): DerivedDescription | null {
  const max = opts.max ?? PROJECT_DESCRIPTION_MAX;
  const blocks = blocksOf(markdown);
  if (!blocks.length) return null;

  const usable = (text: string) => {
    const clean = cleanInline(text);
    if (!clean || isBoilerplate(clean)) return null;
    const sentence = firstSentence(clean);
    return sentence.length >= 12 ? sentence : null;
  };

  const firstHeadingIndex = blocks.findIndex(b => b.kind === 'heading');
  const title =
    firstHeadingIndex >= 0 ? (blocks[firstHeadingIndex] as Block & { text: string }).text : null;

  // 1. Lead paragraph: the prose between the H1 and the next heading.
  for (let i = firstHeadingIndex + 1; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind === 'heading') break;
    const text = usable(block.text);
    if (text) return { text: truncate(text, max), source: 'lead' };
  }

  // 2. First paragraph under a heading that promises a description.
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind !== 'heading' || !isDescriptiveHeading(block.text)) continue;
    for (let j = i + 1; j < blocks.length; j++) {
      const next = blocks[j];
      if (next.kind === 'heading') break;
      const text = usable(next.text);
      if (text) return { text: truncate(text, max), source: 'section', heading: block.text };
    }
  }

  // 3. Any paragraph that isn't boilerplate.
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue;
    const text = usable(block.text);
    if (text) return { text: truncate(text, max), source: 'prose' };
  }

  // 4. The title, unless it names the file or repeats the folder name.
  if (title && !isGenericTitle(title, opts.projectName)) {
    return { text: truncate(title, max), source: 'title' };
  }

  return null;
}

function stripFrontmatter(markdown: string): string {
  const match = markdown.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? markdown.slice(match[0].length) : markdown;
}

function isBoilerplate(text: string): boolean {
  return BOILERPLATE.some(re => re.test(text));
}

function isDescriptiveHeading(heading: string): boolean {
  const lower = heading.toLowerCase();
  return DESCRIPTIVE_HEADINGS.some(word => lower.includes(word));
}

function isGenericTitle(title: string, projectName?: string): boolean {
  const normalized = title.toLowerCase().trim();
  if (GENERIC_TITLES.has(normalized)) return true;
  if (!projectName) return false;
  // "PyOrchestrate" over a project named PyOrchestrate says nothing the header
  // above it doesn't already say.
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return slug(normalized) === slug(projectName);
}

/** Strip the inline markdown that would otherwise reach the UI as syntax. */
export function cleanInline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images / badges
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → their label
    .replace(/<[^>]+>/g, '') // inline HTML
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(?<![\w*])[*_]([^*_]+)[*_](?![\w*])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The first sentence of a paragraph. Splits on `.`/`!`/`?` followed by
 * whitespace, but keeps abbreviations ("e.g.") and paths (`~/.claude/`) whole —
 * a path's dot is never followed by a space.
 */
export function firstSentence(text: string): string {
  const re = /[.!?]+(?=\s)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const head = text.slice(0, end);
    if (ABBREVIATIONS.test(head)) continue;
    const rest = text.slice(end).trim();
    // A lone capital-less continuation ("… v. 2 of the spec") isn't a new
    // sentence; require the next chunk to read like one.
    if (rest && !/^["'“(]?[A-Z0-9]/.test(rest)) continue;
    return head.trim();
  }
  return text.trim();
}

/** Cap at `max` characters, cutting on a word boundary and marking the cut. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const space = slice.lastIndexOf(' ');
  const head = (space > max * 0.6 ? slice.slice(0, space) : slice).replace(/[\s,;:.!?-]+$/, '');
  return `${head}…`;
}
