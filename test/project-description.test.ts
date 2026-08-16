import { describe, it, expect } from 'vitest';
import {
  deriveProjectDescription,
  firstSentence,
  cleanInline,
  truncate,
  PROJECT_DESCRIPTION_MAX,
} from '../electron/modules/project-description';

// The fixtures below are the openings of REAL CLAUDE.md files (this machine's
// projects), abridged only where the body is irrelevant. The derivation exists
// because the obvious rule — first heading, else first sentence — answers
// "CLAUDE.md" and "This file provides guidance to Claude Code…" on the two that
// were written by `/init`, so idealised fixtures would prove nothing.

const CLAUDELENS = `# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository

## Commands (run from repo root)

\`\`\`bash
npm run dev             # Vite dev server + Electron in parallel
npm run build           # tsc (electron) + vite build (renderer)
\`\`\`

Unit tests (Vitest) live under \`test/\` and cover the pure parsing modules.

## Architecture

ClaudeLens is an Electron app that reads Claude Code's local data from \`~/.claude/\`.

**Main process** (\`electron/main.ts\`):
`;

const PERSONAL = `# Vault personale — istruzioni per agenti AI

Questo è un vault Obsidian con documenti personali sensibili (fisco, lavoro, banca, contratti). Regole per lavorarci.

## Regole fondamentali

- **Dati sensibili**: mai inviare contenuti di questo vault a servizi esterni.
`;

const PYORCHESTRATE = `# PyOrchestrate

Python framework for orchestrating multi-process and multi-thread applications
built out of agents. The package is \`PyOrchestrate/\`, the test suite \`test/\`.

Version 0.2.0, alpha. Requires Python >= 3.11.

## Language
`;

const SARA = `# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SARA** (Sistema Avanzato di Raccolta Allarmi) is a Windows-native C++ integration platform for heterogeneous security devices (cameras, alarm panels, I/O modules). It runs as a Windows service.

## Build Commands
`;

const SARA2 = `# SARA — Contesto per Claude Code

## Cos'è questo progetto

Questo è un **vault Obsidian** che documenta l'architettura di SARA, un sistema distribuito per la gestione di sottosistemi fisici.

---

## Struttura del Vault
`;

describe('deriveProjectDescription — real CLAUDE.md files', () => {
  it('skips the /init boilerplate and takes the prose under a descriptive heading', () => {
    const got = deriveProjectDescription(CLAUDELENS, { projectName: 'ClaudeLens' });
    expect(got).toEqual({
      text: "ClaudeLens is an Electron app that reads Claude Code's local data from ~/.claude/.",
      source: 'section',
      heading: 'Architecture',
    });
  });

  it('prefers the lead paragraph when the file has a real one', () => {
    expect(deriveProjectDescription(PERSONAL, { projectName: 'Personal' })).toEqual({
      text: 'Questo è un vault Obsidian con documenti personali sensibili (fisco, lavoro, banca, contratti).',
      source: 'lead',
    });
  });

  it('takes the lead paragraph over a title that just repeats the folder name', () => {
    const got = deriveProjectDescription(PYORCHESTRATE, { projectName: 'PyOrchestrate' });
    expect(got?.source).toBe('lead');
    expect(got?.text).toBe(
      'Python framework for orchestrating multi-process and multi-thread applications built out of agents.'
    );
  });

  it('reads a bold-led sentence under "Project Overview", stripped of markdown', () => {
    const got = deriveProjectDescription(SARA, { projectName: 'SARA' });
    expect(got?.source).toBe('section');
    expect(got?.text).toBe(
      'SARA (Sistema Avanzato di Raccolta Allarmi) is a Windows-native C++ integration platform for heterogeneous security devices (cameras…'
    );
    expect(got?.text.length).toBeLessThanOrEqual(PROJECT_DESCRIPTION_MAX);
  });

  it('recognises an Italian descriptive heading when there is no lead paragraph', () => {
    const got = deriveProjectDescription(SARA2, { projectName: 'SARA2.0' });
    expect(got?.source).toBe('section');
    expect(got?.text).toBe(
      "Questo è un vault Obsidian che documenta l'architettura di SARA, un sistema distribuito per la gestione di sottosistemi fisici."
    );
  });
});

describe('deriveProjectDescription — structure', () => {
  it('ignores frontmatter, code fences, lists, quotes and badges', () => {
    const md = `---
title: ignored
---

# Acme

![badge](https://img.shields.io/x)

> A quote, not a description.

- a list item

\`\`\`ts
const notProse = 'either';
\`\`\`

Acme ships the invoicing service.
`;
    expect(deriveProjectDescription(md, { projectName: 'acme' })).toEqual({
      text: 'Acme ships the invoicing service.',
      source: 'lead',
    });
  });

  it('falls back to the title when the file has no prose at all', () => {
    const md = `# Payments gateway\n\n- only\n- bullets\n`;
    expect(deriveProjectDescription(md, { projectName: 'payments' })).toEqual({
      text: 'Payments gateway',
      source: 'title',
    });
  });

  it('never falls back to a title that names the file or the tool', () => {
    expect(deriveProjectDescription('# CLAUDE.md\n\n- only bullets\n')).toBeNull();
    expect(
      deriveProjectDescription('# Acme\n\n- only bullets\n', { projectName: 'acme' })
    ).toBeNull();
  });

  it('returns null for an empty or prose-less file', () => {
    expect(deriveProjectDescription('')).toBeNull();
    expect(deriveProjectDescription('\n\n   \n')).toBeNull();
  });

  it('drops a paragraph too short to be a description', () => {
    const md = `# Acme\n\nTODO.\n\n## About\n\nAcme is the billing pipeline for the shop.\n`;
    expect(deriveProjectDescription(md, { projectName: 'acme' })?.source).toBe('section');
  });
});

describe('firstSentence', () => {
  it('keeps a trailing path dot inside the sentence', () => {
    expect(firstSentence('Reads data from ~/.claude/ at startup. Then it waits.')).toBe(
      'Reads data from ~/.claude/ at startup.'
    );
  });

  it('does not split on abbreviations', () => {
    expect(firstSentence('Runs on Node, e.g. 22 LTS. Nothing else.')).toBe(
      'Runs on Node, e.g. 22 LTS.'
    );
  });

  it('does not split before a lowercase continuation', () => {
    expect(firstSentence('Requires Python >= 3.11. done')).toBe('Requires Python >= 3.11. done');
  });

  it('returns the whole text when there is no sentence break', () => {
    expect(firstSentence('A framework for agents')).toBe('A framework for agents');
  });
});

describe('cleanInline / truncate', () => {
  it('strips links, code spans, emphasis and inline HTML', () => {
    expect(cleanInline('See **the** [docs](https://x.dev) for `npm run dev` <br> now')).toBe(
      'See the docs for npm run dev now'
    );
  });

  it('cuts on a word boundary and marks the cut', () => {
    const text = 'a'.repeat(50) + ' ' + 'b'.repeat(50) + ' tail';
    const cut = truncate(text, 60);
    expect(cut.length).toBeLessThanOrEqual(60);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.startsWith('a'.repeat(50))).toBe(true);
  });

  it('leaves a short text untouched', () => {
    expect(truncate('short enough', 60)).toBe('short enough');
  });
});
