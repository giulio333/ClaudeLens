import { describe, it, expect } from 'vitest';
import {
  parseFrontmatter,
  yamlScalar,
  getBoolean,
  getString,
  getStringArray,
  getNumber,
} from '../electron/modules/frontmatter';

// js-yaml 5 changed two things this module depends on: it dropped the default
// export (a default import silently resolves to undefined under ESM, so every
// frontmatter read would throw), and it defaults to the YAML 1.2 core schema,
// where `yes`/`on` are plain strings rather than booleans. These tests pin both
// so a future bump can't reintroduce either regression unnoticed.
describe('frontmatter parsing under the YAML 1.2 core schema', () => {
  it('parses a frontmatter block into a record plus the remaining body', () => {
    const { frontmatter, body } = parseFrontmatter(
      '---\nname: api\ndescription: API rules\n---\n# API rules\n'
    );
    expect(frontmatter).toEqual({ name: 'api', description: 'API rules' });
    expect(body).toBe('# API rules\n');
  });

  it('reads a real YAML boolean', () => {
    const { frontmatter } = parseFrontmatter('---\nbackground: true\nother: false\n---\nbody');
    expect(getBoolean(frontmatter, 'background')).toBe(true);
    expect(getBoolean(frontmatter, 'other')).toBe(false);
  });

  it('treats YAML 1.1 style truthy words as true even though 1.2 yields strings', () => {
    const { frontmatter } = parseFrontmatter('---\na: yes\nb: on\nc: no\nd: off\n---\nbody');
    // The core schema resolves all four as strings — the point of the test.
    expect(typeof frontmatter.a).toBe('string');
    expect(getBoolean(frontmatter, 'a')).toBe(true);
    expect(getBoolean(frontmatter, 'b')).toBe(true);
    expect(getBoolean(frontmatter, 'c')).toBe(false);
    expect(getBoolean(frontmatter, 'd')).toBe(false);
  });

  it('returns undefined for an absent boolean key rather than false', () => {
    const { frontmatter } = parseFrontmatter('---\nname: x\n---\nbody');
    expect(getBoolean(frontmatter, 'background')).toBeUndefined();
  });

  it('reads sequences and comma-separated strings as string arrays', () => {
    const { frontmatter } = parseFrontmatter('---\npaths: [src/api/**, src/db/**]\n---\nbody');
    expect(getStringArray(frontmatter, 'paths')).toEqual(['src/api/**', 'src/db/**']);

    const { frontmatter: csv } = parseFrontmatter('---\npaths: a, b\n---\nbody');
    expect(getStringArray(csv, 'paths')).toEqual(['a', 'b']);
  });

  it('round-trips a scalar containing a colon-space through yamlScalar', () => {
    const encoded = yamlScalar('Use when: the user asks');
    const { frontmatter } = parseFrontmatter(`---\ndescription: ${encoded}\n---\nbody`);
    expect(getString(frontmatter, 'description')).toBe('Use when: the user asks');
  });

  it('keeps the body when the frontmatter is malformed', () => {
    const { frontmatter, body } = parseFrontmatter('---\nname: [unclosed\n---\n# Title\n');
    expect(frontmatter).toEqual({});
    expect(body).toBe('# Title\n');
  });

  it('reads numbers, including from a numeric string', () => {
    const { frontmatter } = parseFrontmatter('---\na: 7\nb: "8"\n---\nbody');
    expect(getNumber(frontmatter, 'a')).toBe(7);
    expect(getNumber(frontmatter, 'b')).toBe(8);
  });
});

// Skill and agent files are hand-written, and an unquoted `: ` inside a long
// description is the mistake authors actually make. js-yaml reads it as a
// nested mapping and throws — which used to cost the file every field it had,
// so ClaudeLens showed a skill with no description at all while Claude Code
// showed it fine. These pin the line-by-line recovery.
describe('frontmatter recovery when js-yaml refuses the block', () => {
  it('recovers a description carrying an unquoted colon-space, and the fields around it', () => {
    const { frontmatter, body } = parseFrontmatter(
      '---\n' +
        'name: sara-legacy-db\n' +
        'description: Interroga il database del Legacy. Le modifiche controllate: la lettura è libera, la scrittura no.\n' +
        'model: sonnet\n' +
        '---\n# Database\n'
    );
    expect(getString(frontmatter, 'name')).toBe('sara-legacy-db');
    expect(getString(frontmatter, 'description')).toBe(
      'Interroga il database del Legacy. Le modifiche controllate: la lettura è libera, la scrittura no.'
    );
    expect(getString(frontmatter, 'model')).toBe('sonnet');
    expect(body).toBe('# Database\n');
  });

  it('keeps the type of the lines that are valid on their own', () => {
    const { frontmatter } = parseFrontmatter(
      '---\n' +
        'background: true\n' +
        'max-turns: 7\n' +
        'paths: [src/api/**, src/db/**]\n' +
        'quoted: "a: b"\n' +
        'broken: Use when: the user asks\n' +
        '---\nbody'
    );
    expect(getBoolean(frontmatter, 'background')).toBe(true);
    expect(getNumber(frontmatter, 'max-turns')).toBe(7);
    expect(getStringArray(frontmatter, 'paths')).toEqual(['src/api/**', 'src/db/**']);
    expect(getString(frontmatter, 'quoted')).toBe('a: b');
    expect(getString(frontmatter, 'broken')).toBe('Use when: the user asks');
  });

  it('recovers a block list, and drops a bare key no item followed', () => {
    const { frontmatter } = parseFrontmatter(
      '---\n' +
        'allowed-tools:\n' +
        '  - Read\n' +
        '  - Bash\n' +
        'empty:\n' +
        'description: Serve a questo: leggere\n' +
        '---\nbody'
    );
    expect(getStringArray(frontmatter, 'allowed-tools')).toEqual(['Read', 'Bash']);
    expect(frontmatter).not.toHaveProperty('empty');
    expect(getString(frontmatter, 'description')).toBe('Serve a questo: leggere');
  });

  it('drops only the field whose value opens a structure it cannot close', () => {
    const { frontmatter } = parseFrontmatter(
      '---\nname: api\npaths: [src/**\ndescription: Regole: quelle di sempre\n---\nbody'
    );
    expect(getString(frontmatter, 'name')).toBe('api');
    expect(frontmatter).not.toHaveProperty('paths');
    expect(getString(frontmatter, 'description')).toBe('Regole: quelle di sempre');
  });
});
