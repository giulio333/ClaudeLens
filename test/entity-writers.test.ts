import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { createSkill } from '../electron/modules/skills-writer';
import { createAgent } from '../electron/modules/agents-writer';
import { readAgentFile } from '../electron/modules/agents-reader';
import { readSkillDir } from '../electron/modules/skills-reader';

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

  // Regression: a description with a colon (or '#') used to be written into the
  // YAML frontmatter unquoted, making js-yaml throw on read and silently drop
  // the WHOLE block — the skill came back with no description/tools/model.
  it('round-trips a description containing YAML metacharacters', () => {
    const description = 'Use this skill when: editing, fixing, or building # the deck';
    createSkill(
      { name: 'tricky', content: 'Body', description, model: 'sonnet', allowedTools: ['Read', 'Bash'] },
      proj
    );
    const skill = readSkillDir(join(proj, '.claude', 'skills', 'tricky'), 'project');
    expect(skill).not.toBeNull();
    expect(skill!.description).toBe(description);
    expect(skill!.model).toBe('sonnet');
    expect(skill!.allowedTools).toEqual(['Read', 'Bash']);
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

  // Regression: agent descriptions almost always contain a colon ("Use this
  // agent when X: ..."). Written unquoted, the frontmatter failed to parse and
  // the agent read back with every field missing (flagged invalid in the UI).
  it('round-trips a description containing YAML metacharacters', () => {
    const description = 'Use this agent when the user asks: features, hooks # and more';
    const filePath = createAgent(
      { name: 'guide', content: 'Body', description, model: 'opus', color: 'blue', allowedTools: ['Read', 'Grep'] },
      proj
    );
    const agent = readAgentFile(filePath, 'project');
    expect(agent).not.toBeNull();
    expect(agent!.missingRequired).toEqual([]);
    expect(agent!.description).toBe(description);
    expect(agent!.model).toBe('opus');
    expect(agent!.color).toBe('blue');
    expect(agent!.allowedTools).toEqual(['Read', 'Grep']);
  });

  // A model/version-like string must stay a string, not be coerced to a number
  // on read (js-yaml would parse a bare 4.8 as a float).
  it('keeps a numeric-looking scalar a string after round-trip', () => {
    const filePath = createAgent({ name: 'numish', content: 'b', description: 'x', model: '4.8' }, proj);
    const agent = readAgentFile(filePath, 'project');
    expect(agent!.model).toBe('4.8');
  });
});
