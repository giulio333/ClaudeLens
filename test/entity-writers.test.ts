import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { createSkill } from '../electron/modules/skills-writer';
import { createAgent } from '../electron/modules/agents-writer';
import { readAgentFile } from '../electron/modules/agents-reader';
import { readSkillDir } from '../electron/modules/skills-reader';
import {
  serializeSkill,
  serializeAgent,
  readOptions,
  SKILL_OPTION_DEFS,
  AGENT_OPTION_DEFS,
} from '../src/components/project/shared/entityOptions';

// The renderer edit path serializes an entity to raw markdown that is written
// verbatim (markdownFile:write), then read back with js-yaml. These helpers pass
// only the fields the serializer reads (name + rawContent) and the current
// option values, mirroring what EntityDetailView hands to serialize().
const asSkill = (s: { name: string; rawContent: string }) =>
  s as unknown as Parameters<typeof serializeSkill>[0];
const asAgent = (a: { name: string; rawContent: string }) =>
  a as unknown as Parameters<typeof serializeAgent>[0];
const asRecord = (o: unknown) => o as Record<string, unknown>;

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
  it('round-trips a description containing YAML metacharacters', async () => {
    const description = 'Use this skill when: editing, fixing, or building # the deck';
    createSkill(
      { name: 'tricky', content: 'Body', description, model: 'sonnet', allowedTools: ['Read', 'Bash'] },
      proj
    );
    const skill = await readSkillDir(join(proj, '.claude', 'skills', 'tricky'), 'project');
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
  it('round-trips a description containing YAML metacharacters', async () => {
    const description = 'Use this agent when the user asks: features, hooks # and more';
    const filePath = createAgent(
      { name: 'guide', content: 'Body', description, model: 'opus', color: 'blue', allowedTools: ['Read', 'Grep'] },
      proj
    );
    const agent = await readAgentFile(filePath, 'project');
    expect(agent).not.toBeNull();
    expect(agent!.missingRequired).toEqual([]);
    expect(agent!.description).toBe(description);
    expect(agent!.model).toBe('opus');
    expect(agent!.color).toBe('blue');
    expect(agent!.allowedTools).toEqual(['Read', 'Grep']);
  });

  // A model/version-like string must stay a string, not be coerced to a number
  // on read (js-yaml would parse a bare 4.8 as a float).
  it('keeps a numeric-looking scalar a string after round-trip', async () => {
    const filePath = createAgent({ name: 'numish', content: 'b', description: 'x', model: '4.8' }, proj);
    const agent = await readAgentFile(filePath, 'project');
    expect(agent!.model).toBe('4.8');
  });
});

// Regression: editing (not creating) a skill/agent goes through the renderer's
// serializeSkill/serializeAgent → raw markdownFile:write, with NO server-side
// re-canonicalization. An unquoted description containing ': ' or '#' used to
// break the YAML on read and drop the whole frontmatter.
describe('edit round-trip via renderer serializer', () => {
  it('skill: preserves a description with a colon and #', async () => {
    createSkill({ name: 'edit-skill', content: 'Body', description: 'old', model: 'sonnet' }, proj);
    const dir = join(proj, '.claude', 'skills', 'edit-skill');
    const skill = (await readSkillDir(dir, 'project'))!;
    const description = 'Use this skill when: editing, fixing # or building the deck';
    const raw = serializeSkill(asSkill(skill), skill.content, {
      description,
      options: readOptions(asRecord(skill), SKILL_OPTION_DEFS),
    });
    writeFileSync(join(dir, 'SKILL.md'), raw, 'utf-8');
    const reread = (await readSkillDir(dir, 'project'))!;
    expect(reread.description).toBe(description);
    expect(reread.model).toBe('sonnet');
  });

  it('agent: preserves a description with a colon and keeps a numeric-looking model a string', async () => {
    const filePath = createAgent(
      { name: 'edit-agent', content: 'Body', description: 'old', model: '4.8', color: 'blue' },
      proj
    );
    const agent = (await readAgentFile(filePath, 'project'))!;
    const description = 'Use this agent when the user asks: X # and Y';
    const raw = serializeAgent(asAgent(agent), agent.content, {
      description,
      options: readOptions(asRecord(agent), AGENT_OPTION_DEFS),
    });
    writeFileSync(filePath, raw, 'utf-8');
    const reread = (await readAgentFile(filePath, 'project'))!;
    expect(reread.missingRequired).toEqual([]);
    expect(reread.description).toBe(description);
    expect(reread.model).toBe('4.8');
    expect(reread.color).toBe('blue');
  });

  it('skill: an edit preserves an unmodeled hooks block', async () => {
    const dir = join(proj, '.claude', 'skills', 'hooked');
    mkdirSync(dir, { recursive: true });
    const original = [
      '---',
      'description: original',
      'hooks:',
      '  PreToolUse:',
      '    - matcher: Bash',
      '---',
      '',
      'Body',
    ].join('\n');
    writeFileSync(join(dir, 'SKILL.md'), original, 'utf-8');
    const skill = (await readSkillDir(dir, 'project'))!;
    expect(skill.hooks).toBeDefined();

    const raw = serializeSkill(asSkill(skill), skill.content, {
      description: 'new desc',
      options: readOptions(asRecord(skill), SKILL_OPTION_DEFS),
    });
    writeFileSync(join(dir, 'SKILL.md'), raw, 'utf-8');
    const reread = (await readSkillDir(dir, 'project'))!;
    expect(reread.description).toBe('new desc');
    expect(reread.hooks).toBeDefined();
    expect(JSON.stringify(reread.hooks)).toContain('PreToolUse');
  });
});
