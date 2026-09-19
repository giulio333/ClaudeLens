import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
} from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import {
  serializeSkill,
  serializeAgent,
  readOptions,
  SKILL_OPTION_DEFS,
  AGENT_OPTION_DEFS,
} from '../src/components/project/shared/entityOptions';

// The config dir and every sandbox project live under the OS temp dir, which is
// OUTSIDE $HOME — that is the claim of #256: the writers used to anchor
// containment on the home directory, which refused every project in /opt or on
// a mounted volume and, since CLAUDE_DIR follows CLAUDE_CONFIG_DIR, a relocated
// config dir too. `realpathSync` because macOS hands out `/var/folders/…` for a
// dir that resolves to `/private/var/folders/…`, and the allowlist compares the
// path the registry resolved with the one the caller passes, as strings.
// CLAUDE_DIR is read once, when utils loads, so the env var goes first and the
// modules that carry it are imported after it.
const configDir = realpathSync(mkdtempSync(join(tmpdir(), 'cl-entity-cfg-')));
process.env.CLAUDE_CONFIG_DIR = configDir;

const { createSkill } = await import('../electron/modules/skills-writer');
const { createAgent } = await import('../electron/modules/agents-writer');
const { readAgentFile } = await import('../electron/modules/agents-reader');
const { readSkillDir } = await import('../electron/modules/skills-reader');
const { encodeProjectHash, invalidateCwdCache } = await import('../electron/utils');

afterAll(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  rmSync(configDir, { recursive: true, force: true });
});

/** Files `cwd` under `<configDir>/projects/<hash>/` the way a Claude Code
 *  session would, which is what makes it a project ClaudeLens knows. */
function registerProject(cwd: string): void {
  const hashDir = join(configDir, 'projects', encodeProjectHash(cwd));
  mkdirSync(hashDir, { recursive: true });
  writeFileSync(join(hashDir, 'session.jsonl'), `${JSON.stringify({ cwd })}\n`);
}

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
// {projectPath}/.claude/(skills|agents), and accept only a projectPath the
// projects registry knows — so each sandbox project is registered, and the cwd
// cache `resolveRealPath` keeps per hash is cleared with it, since the suite
// is shuffled and a stale entry would answer for a dir that no longer exists.
let proj: string;

beforeEach(() => {
  invalidateCwdCache();
  rmSync(join(configDir, 'projects'), { recursive: true, force: true });
  proj = realpathSync(mkdtempSync(join(tmpdir(), 'cl-entity-proj-')));
  registerProject(proj);
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
      {
        name: 'tricky',
        content: 'Body',
        description,
        model: 'sonnet',
        allowedTools: ['Read', 'Bash'],
      },
      proj
    );
    const skill = await readSkillDir(join(proj, '.claude', 'skills', 'tricky'), 'project');
    expect(skill).not.toBeNull();
    expect(skill!.description).toBe(description);
    expect(skill!.model).toBe('sonnet');
    expect(skill!.allowedTools).toEqual(['Read', 'Bash']);
  });
});

// #256: the guard's job is "this is a project ClaudeLens knows", and $HOME was
// a proxy for it. Every `proj` above already sits outside home; these state
// the two refusals the issue reported, and the one that has to stay.
describe('containment root (issue #256)', () => {
  it('creates a skill and an agent in a known project outside $HOME', () => {
    expect(proj.startsWith(realpathSync(homedir()))).toBe(false);
    const skill = createSkill({ name: 'probe', content: 'Body' }, proj);
    const agent = createAgent({ name: 'probe', content: 'Body' }, proj);
    expect(skill).toBe(join(proj, '.claude', 'skills', 'probe', 'SKILL.md'));
    expect(agent).toBe(join(proj, '.claude', 'agents', 'probe.md'));
    expect(existsSync(skill)).toBe(true);
    expect(existsSync(agent)).toBe(true);
  });

  it('writes a global skill and agent into a CLAUDE_CONFIG_DIR outside $HOME', () => {
    const skill = createSkill({ name: 'global-probe', content: 'Body' });
    const agent = createAgent({ name: 'global-probe', content: 'Body' });
    expect(skill).toBe(join(configDir, 'skills', 'global-probe', 'SKILL.md'));
    expect(agent).toBe(join(configDir, 'agents', 'global-probe.md'));
    expect(existsSync(skill)).toBe(true);
    expect(existsSync(agent)).toBe(true);
  });

  it('still refuses a project the registry does not know, wherever it lives', () => {
    // Under the config dir itself, so a root-based check would have let it in.
    const unknown = join(configDir, 'not-a-project');
    mkdirSync(unknown, { recursive: true });
    expect(() => createSkill({ name: 'x', content: 'b' }, unknown)).toThrow(/Unknown project/);
    expect(() => createAgent({ name: 'x', content: 'b' }, unknown)).toThrow(/Unknown project/);
    expect(existsSync(join(unknown, '.claude'))).toBe(false);
  });

  it('a known project cannot be redirected by a traversal name', () => {
    expect(() => createSkill({ name: '../../escape', content: 'b' }, proj)).toThrow(/Invalid name/);
    expect(existsSync(join(proj, 'escape'))).toBe(false);
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

  it('refuses a projectPath the projects registry does not know', () => {
    const unknown = realpathSync(mkdtempSync(join(tmpdir(), 'cl-unknown-')));
    try {
      expect(() => createAgent({ name: 'x', content: 'b' }, unknown)).toThrow(/Unknown project/);
      expect(() => createSkill({ name: 'x', content: 'b' }, unknown)).toThrow(/Unknown project/);
      expect(existsSync(join(unknown, '.claude'))).toBe(false);
    } finally {
      rmSync(unknown, { recursive: true, force: true });
    }
  });

  // Regression: agent descriptions almost always contain a colon ("Use this
  // agent when X: ..."). Written unquoted, the frontmatter failed to parse and
  // the agent read back with every field missing (flagged invalid in the UI).
  it('round-trips a description containing YAML metacharacters', async () => {
    const description = 'Use this agent when the user asks: features, hooks # and more';
    const filePath = createAgent(
      {
        name: 'guide',
        content: 'Body',
        description,
        model: 'opus',
        color: 'blue',
        allowedTools: ['Read', 'Grep'],
      },
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
    const filePath = createAgent(
      { name: 'numish', content: 'b', description: 'x', model: '4.8' },
      proj
    );
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
