import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { createSkill } from '../electron/modules/skills-writer';
import { createAgent } from '../electron/modules/agents-writer';

// createSkill/createAgent honor a projectPath by writing under
// {projectPath}/.claude/(skills|agents). The writers anchor containment on the
// home dir (project agents/skills are always under $HOME by convention), so the
// sandbox project must live under home too.
let proj: string;

beforeEach(() => {
  proj = mkdtempSync(join(homedir(), '.cl-entity-test-'));
});

afterEach(() => {
  rmSync(proj, { recursive: true, force: true });
});

describe('createSkill (issue #58)', () => {
  it('writes SKILL.md under .claude/skills/<name>', () => {
    const filePath = createSkill({ name: 'my-skill', content: 'Body' }, proj);
    expect(filePath).toBe(join(proj, '.claude', 'skills', 'my-skill', 'SKILL.md'));
    expect(readFileSync(filePath, 'utf-8')).toContain('Body');
  });

  it('rejects a traversal name instead of escaping the skills dir', () => {
    expect(() => createSkill({ name: '../../../../tmp/x', content: 'x' }, proj)).toThrow(
      /Invalid name/
    );
    expect(existsSync(join(proj, '.claude', 'skills'))).toBe(false);
  });

  it('refuses to overwrite an existing skill', () => {
    createSkill({ name: 'dup', content: 'first' }, proj);
    expect(() => createSkill({ name: 'dup', content: 'second' }, proj)).toThrow(/already exists/);
    expect(readFileSync(join(proj, '.claude', 'skills', 'dup', 'SKILL.md'), 'utf-8')).toContain(
      'first'
    );
  });
});

describe('createAgent (issue #58)', () => {
  it('writes <name>.md under .claude/agents', () => {
    const filePath = createAgent({ name: 'reviewer', content: 'Body' }, proj);
    expect(filePath).toBe(join(proj, '.claude', 'agents', 'reviewer.md'));
    expect(readFileSync(filePath, 'utf-8')).toContain('name: reviewer');
  });

  it('rejects a traversal name instead of escaping the agents dir', () => {
    expect(() => createAgent({ name: '../../evil', content: 'x' }, proj)).toThrow(/Invalid name/);
    expect(existsSync(join(proj, '.claude', 'agents'))).toBe(false);
  });

  it('refuses to overwrite an existing agent', () => {
    createAgent({ name: 'dup', content: 'first' }, proj);
    expect(() => createAgent({ name: 'dup', content: 'second' }, proj)).toThrow(/already exists/);
  });

  it('refuses a projectPath that escapes the home directory', () => {
    const outside = mkdtempSync(join(tmpdir(), 'cl-outside-'));
    try {
      expect(() => createAgent({ name: 'x', content: 'b' }, outside)).toThrow(/outside/);
      expect(() => createSkill({ name: 'x', content: 'b' }, outside)).toThrow(/outside/);
      expect(existsSync(join(outside, '.claude'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
