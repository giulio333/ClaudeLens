import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Blueprint } from '../electron/modules/studio-compiler';

const configDir = mkdtempSync(join(homedir(), '.cl-studio-test-'));
process.env.CLAUDE_CONFIG_DIR = configDir;

const reader = await import('../electron/modules/studio-reader');
const writer = await import('../electron/modules/studio-writer');
const scriptParser = await import('../electron/modules/studio-script');
const compiler = await import('../electron/modules/studio-compiler');

afterAll(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  rmSync(configDir, { recursive: true, force: true });
});

function blueprint(name = 'release-triage'): Blueprint {
  return {
    name,
    description: 'triage a release diff',
    version: '0.1.0',
    brief: {
      goal: 'Triage the diff.',
      inputs: [{ name: 'tag', required: true }],
      expectedOutput: 'verdict',
      successCriteria: ['every file inspected'],
      onError: 'halt',
    },
    phases: [
      {
        title: 'Collect',
        nodes: [{ kind: 'step', step: { id: 'collect', prompt: 'Collect ${args}' } }],
      },
    ],
  };
}

function firstStep(bp: Blueprint | null | undefined) {
  const node = bp?.phases[0]?.nodes[0];
  return node?.kind === 'step' ? node.step : undefined;
}

describe('script-only Agent Studio persistence', () => {
  it('creates a native workflow directly with no ClaudeLens manifest', async () => {
    const { scriptPath, script } = await writer.createBlueprint(blueprint());
    expect(scriptPath).toBe(join(configDir, 'workflows', 'release-triage.js'));
    expect(readFileSync(scriptPath, 'utf-8')).toBe(script);
    const back = await reader.readBlueprint('release-triage');
    expect(back?.brief.goal).toBe('Triage the diff.');
    expect(back?.brief.expectedOutput).toBe('verdict');
    expect(back?.brief.successCriteria).toEqual(['every file inspected']);
    expect(firstStep(back)).toMatchObject({
      id: 'collect',
      prompt: 'Collect ${args}',
    });
  });

  it('refuses duplicate creation and traversal names', async () => {
    await expect(writer.createBlueprint(blueprint())).rejects.toThrow(/already exists/);
    await expect(writer.saveBlueprint(blueprint('../evil'))).rejects.toThrow(
      /Invalid workflow name/
    );
    await expect(writer.saveBlueprint(blueprint('My Workflow'))).rejects.toThrow(
      /Invalid workflow name/
    );
  });

  it('saves visual edits back to the same script file', async () => {
    const changed = (await reader.readBlueprint('release-triage'))!;
    firstStep(changed)!.prompt = 'Collect carefully for ${args}';
    const result = await writer.saveBlueprint(changed, 'release-triage.js');
    expect(result.scriptPath).toBe(join(configDir, 'workflows', 'release-triage.js'));
    expect(readFileSync(result.scriptPath, 'utf-8')).toContain('Collect carefully for ${args}');
    expect(firstStep(await reader.readBlueprint('release-triage'))?.prompt).toBe(
      'Collect carefully for ${args}'
    );
  });

  it('rejects invalid visual flows instead of writing a broken script', async () => {
    await expect(writer.createBlueprint({ ...blueprint('broken'), phases: [] })).rejects.toThrow(
      /Cannot save workflow/
    );
    expect(existsSync(join(configDir, 'workflows', 'broken.js'))).toBe(false);
  });

  it('refuses to write a compiled script whose code nodes no longer parse', async () => {
    const bp = blueprint('broken-code');
    bp.phases[0].nodes.push({ kind: 'code', source: 'const oops = {' });
    await expect(writer.saveBlueprint(bp)).rejects.toThrow(/syntax error/);
    expect(existsSync(join(configDir, 'workflows', 'broken-code.js'))).toBe(false);
  });

  it('refuses a visual save when the native script changed after the draft opened', async () => {
    const created = await writer.createBlueprint(blueprint('visual-conflict'));
    const draft = (await reader.readBlueprint('visual-conflict'))!;
    firstStep(draft)!.prompt = 'Local draft';
    const external = `${created.script}\n// external edit\n`;
    writeFileSync(created.scriptPath, external, 'utf-8');

    await expect(
      writer.saveBlueprint(draft, 'visual-conflict.js', undefined, created.script)
    ).rejects.toThrow(/changed on disk/i);
    expect(readFileSync(created.scriptPath, 'utf-8')).toBe(external);
  });
});

describe('native script parsing', () => {
  it('projects an external representable workflow into the same Brief and Flow model', async () => {
    const source = `export const meta = {
  name: "external-review",
  description: "review a patch",
  whenToUse: "Inspect a supplied patch",
  phases: [{ title: "Review" }],
}

phase("Review")
const reviewer = await agent(\`Review \${args}\`, { label: "reviewer", model: "sonnet" })

return reviewer
`;
    writeFileSync(join(configDir, 'workflows', 'external-review.js'), source, 'utf-8');

    const detail = await reader.getBlueprintDetail('external-review.js');
    expect(detail?.structured).toBe(true);
    expect(detail?.source).toBe(source);
    expect(detail?.blueprint.brief.goal).toBe('Inspect a supplied patch');
    expect(firstStep(detail?.blueprint)).toMatchObject({
      id: 'reviewer',
      prompt: 'Review ${args}',
      model: 'sonnet',
      resultVar: 'reviewer',
    });
    // The safe auto-return is regenerated, never stored as a code node.
    expect(compiler.countCodeNodes(detail!.blueprint)).toBe(0);
  });

  it('keeps arbitrary JavaScript as verbatim code nodes with Flow still available', async () => {
    const source = `export const meta = { name: "custom", description: "custom control flow", phases: [] }
if (args) {
  await agent("dynamic", { label: "dynamic" })
}
return args
`;
    writeFileSync(join(configDir, 'workflows', 'custom.js'), source, 'utf-8');

    const detail = await reader.getBlueprintDetail('custom.js');
    expect(detail?.structured).toBe(true);
    expect(detail?.source).toBe(source);
    const preamble = detail?.blueprint.preamble ?? [];
    expect(preamble.map(n => n.kind)).toEqual(['code', 'code']);
    expect(preamble[0]).toMatchObject({
      source: 'if (args) {\n  await agent("dynamic", { label: "dynamic" })\n}',
    });
    expect(
      (await reader.getStudioLibrary()).blueprints.find(item => item.fileName === 'custom.js')
    ).toMatchObject({
      name: 'custom',
      structured: true,
      codeNodeCount: 2,
    });
  });

  it('tags a shared schema const with its name and static model, round-tripping verbatim', () => {
    const source = `export const meta = { name: "rel", description: "release", phases: [{ title: "Release" }] }
const RELEASE_SCHEMA = {
  type: "object",
  properties: {
    tag: { type: "string", description: "the tag" },
  },
  required: ["tag"],
}
phase("Release")
const release = await agent("cut the release", { label: "release", schema: RELEASE_SCHEMA })
return release
`;
    const parsed = scriptParser.parseWorkflowScript(source, 'rel.js');
    expect(parsed.structured).toBe(true);
    const schemaNode = (parsed.blueprint.preamble ?? [])[0];
    expect(schemaNode).toMatchObject({ kind: 'code', schemaName: 'RELEASE_SCHEMA' });
    expect(schemaNode.kind === 'code' && schemaNode.schemaModel?.type).toBe('object');
    expect(schemaNode.kind === 'code' && schemaNode.schemaModel?.children?.[0].name).toBe('tag');
    // the schema/name are display-only metadata: the const is preserved verbatim,
    // both on the node and when re-emitted by the compiler.
    const constBlock =
      'const RELEASE_SCHEMA = {\n' +
      '  type: "object",\n' +
      '  properties: {\n' +
      '    tag: { type: "string", description: "the tag" },\n' +
      '  },\n' +
      '  required: ["tag"],\n' +
      '}';
    expect(schemaNode.kind === 'code' && schemaNode.source).toBe(constBlock);
    expect(compiler.compileBlueprint(parsed.blueprint)).toContain(constBlock);
  });

  it('demotes agent calls with unsupported options to code nodes instead of dropping them', () => {
    const source = `export const meta = { name: "tooling", description: "uses custom opts", phases: [{ title: "Run" }] }
phase("Run")
const run = await agent("run", { label: "run", tools: ["Bash"] })
return run
`;
    const parsed = scriptParser.parseWorkflowScript(source, 'tooling.js');
    expect(parsed.structured).toBe(true);
    const runNodes = parsed.blueprint.phases[0].nodes;
    expect(runNodes[0]).toMatchObject({
      kind: 'code',
      source: 'const run = await agent("run", { label: "run", tools: ["Bash"] })',
    });
    // `return run` cannot be proven to match a regenerated auto-return → preserved.
    expect(runNodes[1]).toMatchObject({ kind: 'code', source: 'return run' });
  });

  it('reads through the `...`.trim() prompt idiom and re-emits the call', () => {
    const source = `export const meta = { name: "audit", description: "trimmed prompts", phases: [{ title: "Scan" }] }
phase("Scan")
log(\`
  scanning
\`.trim())
const inventory = await agent(\`
List the payslips.
\`.trim(), { label: 'inventory' })

const results = await pipeline(
  inventory.items,
  (item) => agent(\`
Extract \${item.pdf}.
\`.trim(), { label: \`extract:\${item.id}\`, phase: 'Scan' }),
)
`;
    const parsed = scriptParser.parseWorkflowScript(source, 'audit.js');
    const nodes = parsed.blueprint.phases[0].nodes;
    expect(nodes[0]).toMatchObject({ kind: 'log', message: '\n  scanning\n', trim: true });
    expect(nodes[1]).toMatchObject({ kind: 'step' });
    const step = nodes[1].kind === 'step' ? nodes[1].step : undefined;
    expect(step).toMatchObject({ id: 'inventory', resultVar: 'inventory', promptTrim: true });
    expect(step?.prompt).toBe('\nList the payslips.\n');
    expect(nodes[2].kind === 'pipeline' && nodes[2].stages[0]).toMatchObject({
      kind: 'agent',
      params: 'item',
      step: { promptTrim: true },
    });

    // The `.trim()` survives compilation, so the prompt keeps being stripped.
    const compiled = compiler.compileBlueprint(parsed.blueprint);
    expect(compiled).toContain('`.trim(), { label: "inventory" }');
    expect(compiled).toContain('`.trim())');
    expect(scriptParser.parseWorkflowScript(compiled, 'audit.js').blueprint).toEqual(
      parsed.blueprint
    );
  });

  it('round-trips quoted and prototype-like literal metadata keys safely', () => {
    const source = `export const meta = {
  name: "unusual-meta-keys",
  description: "keeps valid quoted keys",
  "x-feature": true,
  "__proto__": { safe: true },
  phases: [{ title: "Run", "x-budget": 2 }],
}
phase("Run")
const run = await agent("run", { label: "run" })
return run
`;
    const first = scriptParser.parseWorkflowScript(source, 'unusual-meta-keys.js');
    expect(first.structured).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(first.blueprint.metaExtras, '__proto__')).toBe(
      true
    );

    const compiled = compiler.compileBlueprint(first.blueprint);
    expect(compiled).toContain('"x-feature": true');
    expect(compiled).toContain('"__proto__": {"safe":true}');
    expect(compiled).toContain('"x-budget": 2');
    const second = scriptParser.parseWorkflowScript(compiled, 'unusual-meta-keys.js');
    expect(second.parseError).toBeNull();
    expect(second.blueprint).toEqual(first.blueprint);
  });

  it('reports syntax errors but still returns the source editor model', () => {
    const parsed = scriptParser.parseWorkflowScript('export const meta = {', 'bad.js');
    expect(parsed.structured).toBe(false);
    expect(parsed.parseError).toBeTruthy();
    expect(parsed.blueprint.name).toBe('bad');
  });

  it('keeps dynamic workflow metadata source-only instead of offering a lossy visual save', async () => {
    const source = `const DEFAULT_TIMEOUT = 30
const sharedMeta = { owner: "platform" }
const phaseDefaults = { model: "sonnet" }
const dynamicKey = "retries"

export const meta = {
  name: "dynamic-meta",
  description: "must stay verbatim",
  timeout: DEFAULT_TIMEOUT,
  ...sharedMeta,
  [dynamicKey]: 2,
  phases: [{
    title: "Review",
    budget: DEFAULT_TIMEOUT,
    ...phaseDefaults,
    [dynamicKey]: true,
  }],
}

phase("Review")
const review = await agent("Review the change", { label: "review" })
return review
`;
    const parsed = scriptParser.parseWorkflowScript(source, 'dynamic-meta.js');
    expect(parsed.structured).toBe(false);
    expect(parsed.parseError).toMatch(/cannot be represented safely/i);
    expect(parsed.blueprint.name).toBe('dynamic-meta');

    const path = join(configDir, 'workflows', 'dynamic-meta.js');
    writeFileSync(path, source, 'utf-8');
    const detail = await reader.getBlueprintDetail('dynamic-meta.js');
    expect(detail).toMatchObject({ structured: false, source });
    expect(readFileSync(path, 'utf-8')).toBe(source);
  });

  it('keeps a meta export with sibling declarations source-only', () => {
    const source = `export const meta = { name: "shared-declaration" }, helper = 1
return helper
`;
    const parsed = scriptParser.parseWorkflowScript(source, 'shared-declaration.js');
    expect(parsed.structured).toBe(false);
    expect(parsed.parseError).toMatch(/cannot be represented safely/i);
  });

  it('keeps mutable workflow metadata source-only', () => {
    const source = `export let meta = { name: "mutable-meta" }
meta = { ...meta, version: "next" }
`;
    const parsed = scriptParser.parseWorkflowScript(source, 'mutable-meta.js');
    expect(parsed.structured).toBe(false);
    expect(parsed.parseError).toMatch(/cannot be represented safely/i);
  });
});

describe('hybrid round-trip (update-tests-style script)', () => {
  const source = `export const meta = {
  name: 'update-tests',
  description: 'Create or update the test suite of a repository',
  whenToUse: 'When tests must catch up with the code',
  phases: [
    { title: 'Map', detail: 'understand the repo', model: 'sonnet' },
    { title: 'Write', detail: 'one agent per module' },
  ],
}

// args: { target: string }
const target = (args && args.target) || '.'
const maxModules = (args && args.maxModules) || 8

// ── Fase 1 ──
phase('Map')
log(\`Mapping test setup under \${target}\`)

const repoMap = await agent(
  \`Analizza il repository (scope: "\${target}") e restituisci SOLO dati strutturati\`,
  {
    label: 'map:repo',
    phase: 'Map',
    model: 'sonnet',
    effort: 'medium',
    schema: {
      type: 'object',
      required: ['modules'],
      properties: { modules: { type: 'array' } },
    },
  }
)

if (!repoMap || !repoMap.modules.length) {
  return { error: 'Nessun modulo testabile trovato' }
}

phase('Write')

const written = await pipeline(
  repoMap.modules.slice(0, maxModules),
  (item) => agent(\`Scrivi i test per \${item.sourcePath} secondo \${repoMap.conventions}\`, { label: \`write:\${item.sourcePath}\`, phase: 'Write', model: 'sonnet', effort: 'medium', schema: { type: 'object', required: ['passing'], properties: { passing: { type: 'boolean' } } } }),
  (result, item) => (result ? { ...result, sourcePath: item.sourcePath } : null),
)

const done = written.filter(Boolean)

return {
  modulesWorked: done.map((d) => d.sourcePath),
}
`;

  it('parses every construct into structured or verbatim nodes', () => {
    const parsed = scriptParser.parseWorkflowScript(source, 'update-tests.js');
    expect(parsed.structured).toBe(true);
    const bp = parsed.blueprint;
    expect(bp.name).toBe('update-tests');
    expect(bp.phases.map(p => p.title)).toEqual(['Map', 'Write']);
    expect(bp.phases[0].metaExtra).toEqual({ model: 'sonnet' });
    expect((bp.preamble ?? []).map(n => n.kind)).toEqual(['code', 'code']);

    const mapNodes = bp.phases[0].nodes;
    expect(mapNodes[0]).toMatchObject({
      kind: 'log',
      message: 'Mapping test setup under ${target}',
    });
    expect(mapNodes[1]).toMatchObject({ kind: 'step' });
    const mapStep = mapNodes[1].kind === 'step' ? mapNodes[1].step : undefined;
    expect(mapStep).toMatchObject({
      id: 'map:repo',
      resultVar: 'repoMap',
      model: 'sonnet',
      effort: 'medium',
      explicitPhase: true,
    });
    expect(mapStep?.schemaSource).toContain("required: ['modules']");
    expect(mapNodes[2]).toMatchObject({ kind: 'code' });

    const writeNodes = bp.phases[1].nodes;
    expect(writeNodes[0].kind).toBe('pipeline');
    if (writeNodes[0].kind === 'pipeline') {
      expect(writeNodes[0].resultVar).toBe('written');
      expect(writeNodes[0].itemsSource).toBe('repoMap.modules.slice(0, maxModules)');
      expect(writeNodes[0].stages[0]).toMatchObject({ kind: 'agent', params: 'item' });
      const stageStep =
        writeNodes[0].stages[0].kind === 'agent' ? writeNodes[0].stages[0].step : undefined;
      expect(stageStep?.dynamicLabel).toBe('`write:${item.sourcePath}`');
      expect(stageStep?.prompt).toBe(
        'Scrivi i test per ${item.sourcePath} secondo ${repoMap.conventions}'
      );
      expect(writeNodes[0].stages[1]).toMatchObject({ kind: 'code' });
    }
    // filter + final return stay verbatim
    expect(writeNodes.slice(1).map(n => n.kind)).toEqual(['code', 'code']);
  });

  it('round-trips: compile(parse(src)) parses back to the same blueprint and stays valid JS', () => {
    const first = scriptParser.parseWorkflowScript(source, 'update-tests.js');
    const compiled = compiler.compileBlueprint(first.blueprint);
    const second = scriptParser.parseWorkflowScript(compiled, 'update-tests.js');
    expect(second.parseError).toBeNull();
    expect(second.blueprint).toEqual(first.blueprint);
    // Verbatim fragments survive byte-for-byte.
    expect(compiled).toContain("const target = (args && args.target) || '.'");
    expect(compiled).toContain('if (!repoMap || !repoMap.modules.length) {');
    expect(compiled).toContain('label: `write:${item.sourcePath}`');
    expect(compiled).toContain(
      '(result, item) => (result ? { ...result, sourcePath: item.sourcePath } : null),'
    );
    expect(compiled).toContain('// ── Fase 1 ──');
    expect(compiled).toContain('model: "sonnet" },');
  });

  it('passes validation as a hybrid blueprint (no unknown-ref noise) and saves to disk', async () => {
    const parsed = scriptParser.parseWorkflowScript(source, 'update-tests.js');
    const errors = compiler.validateBlueprint(parsed.blueprint).filter(i => i.severity === 'error');
    expect(errors).toEqual([]);
    const { scriptPath } = await writer.saveBlueprint(
      parsed.blueprint,
      'update-tests.js'.replace('.js', '') + '.js'
    );
    expect(existsSync(scriptPath)).toBe(true);
    rmSync(scriptPath);
  });
});

describe('round-trip corruption guards', () => {
  function stepOf(bp: Blueprint) {
    const node = bp.phases[0]?.nodes.find(n => n.kind === 'step');
    return node?.kind === 'step' ? node.step : undefined;
  }

  it('keeps a literal ${...} in a hybrid prompt from turning into a live interpolation', () => {
    // A preamble makes this hybrid; the plain-string prompt's `${cost}` is
    // literal text (a plain JS string never interpolates) and must stay literal
    // on Visual Save, not become a runtime interpolation that would throw.
    const source =
      'export const meta = { name: "literal-interp", description: "d", phases: [{ title: "Run" }] }\n' +
      'const budgetHint = 5\n' +
      '\n' +
      'phase("Run")\n' +
      'const explain = await agent("Total is ${cost}", { label: "explain" })\n' +
      'return explain\n';

    const parsed = scriptParser.parseWorkflowScript(source, 'literal-interp.js');
    expect(parsed.structured).toBe(true);
    // The parser records the literal ${cost} escaped so it never scans as a ref.
    expect(stepOf(parsed.blueprint)?.prompt).toBe('Total is \\${cost}');

    const compiled = compiler.compileBlueprint(parsed.blueprint);
    // Emitted as an escaped (literal) interpolation, never a live one.
    expect(compiled).toContain('agent(`Total is \\${cost}`');
    expect(compiled).not.toContain('agent(`Total is ${cost}`');

    // And the whole thing is idempotent through a second round-trip.
    const second = scriptParser.parseWorkflowScript(compiled, 'literal-interp.js');
    expect(second.parseError).toBeNull();
    expect(second.blueprint).toEqual(parsed.blueprint);
  });

  it('regenerates the auto-return even when a code node has a nested return', () => {
    // The nested `return x * 2` lives inside an arrow — it must NOT be mistaken
    // for the workflow's own return, or the top-level result is silently lost.
    const source =
      'export const meta = { name: "nested-return", description: "d", phases: [{ title: "Work" }] }\n' +
      'const doubler = (xs) => xs.map((x) => {\n  return x * 2\n})\n' +
      '\n' +
      'phase("Work")\n' +
      'const summary = await agent("summarize", { label: "summary" })\n' +
      'return summary\n';

    const parsed = scriptParser.parseWorkflowScript(source, 'nested-return.js');
    expect(parsed.structured).toBe(true);

    const compiled = compiler.compileBlueprint(parsed.blueprint);
    // The auto-return the parser dropped is regenerated (not suppressed by the
    // arrow's nested return), so the workflow still returns its result.
    expect(compiled).toContain('return summary');

    const second = scriptParser.parseWorkflowScript(compiled, 'nested-return.js');
    expect(second.parseError).toBeNull();
    expect(second.blueprint).toEqual(parsed.blueprint);
  });
});

describe('raw source operations', () => {
  it('reads and overwrites an existing workflow verbatim', async () => {
    const before = (await reader.getBlueprintDetail('external-review.js'))!;
    const changed = `${before.source}\n// manual edit\n`;
    await writer.writeNativeScript('external-review.js', changed);
    expect((await reader.getBlueprintDetail('external-review.js'))?.source).toBe(changed);
  });

  it('rejects traversal and refuses to create a missing script', async () => {
    await expect(reader.getBlueprintDetail('../outside.js')).rejects.toThrow(
      /Invalid workflow script name/
    );
    await expect(writer.writeNativeScript('missing.js', 'export default {}')).rejects.toThrow(
      /not found/
    );
  });

  it('refuses a source save based on stale native content', async () => {
    const before = (await reader.getBlueprintDetail('external-review.js'))!;
    const external = `${before.source}\n// external winner\n`;
    writeFileSync(before.scriptPath, external, 'utf-8');

    await expect(
      writer.writeNativeScript(
        before.fileName,
        `${before.source}\n// local draft\n`,
        undefined,
        before.source
      )
    ).rejects.toThrow(/changed on disk/i);
    expect(readFileSync(before.scriptPath, 'utf-8')).toBe(external);
  });

  it('deletes the native script itself', async () => {
    writer.deleteBlueprint('release-triage.js');
    expect(existsSync(join(configDir, 'workflows', 'release-triage.js'))).toBe(false);
    expect(await reader.readBlueprint('release-triage')).toBeNull();
  });
});

describe('project-local workflows (.claude/workflows in the project cwd)', () => {
  const projectDir = mkdtempSync(join(homedir(), '.cl-studio-proj-'));
  const projectWorkflows = join(projectDir, '.claude', 'workflows');
  afterAll(() => rmSync(projectDir, { recursive: true, force: true }));

  it('saves and reads back a blueprint in the project scope', async () => {
    const { scriptPath } = await writer.saveBlueprint(
      blueprint('proj-flow'),
      undefined,
      projectDir
    );
    expect(scriptPath).toBe(join(projectWorkflows, 'proj-flow.js'));
    const detail = await reader.getBlueprintDetail('proj-flow', undefined, projectDir);
    expect(detail).toMatchObject({ scope: 'project', projectPath: projectDir });
    expect(detail?.blueprint.brief.goal).toBe('Triage the diff.');
    // The same identifier does not exist in the global scope.
    expect(await reader.readBlueprint('proj-flow')).toBeNull();
  });

  it('lists global and project scripts together, tagged with their scope', async () => {
    const all = await reader.getBlueprints([projectDir]);
    const projFlow = all.find(bp => bp.name === 'proj-flow');
    expect(projFlow).toMatchObject({ scope: 'project', projectPath: projectDir });
    const globalOnes = all.filter(bp => bp.scope === 'global');
    expect(globalOnes.length).toBeGreaterThan(0);
    expect(globalOnes.every(bp => bp.projectPath === null)).toBe(true);
  });

  it('discovers project workflow dirs from the projects registry', async () => {
    const hashDir = join(configDir, 'projects', projectDir.replace(/\//g, '-'));
    mkdirSync(hashDir, { recursive: true });
    writeFileSync(join(hashDir, 'session.jsonl'), `${JSON.stringify({ cwd: projectDir })}\n`);
    expect(reader.discoverProjectsWithWorkflows()).toContain(projectDir);
    expect(reader.isKnownProjectPath(projectDir)).toBe(true);
    expect(reader.isKnownProjectPath(join(homedir(), 'nowhere'))).toBe(false);
    expect(
      (await reader.getStudioLibrary()).blueprints.some(bp => bp.projectPath === projectDir)
    ).toBe(true);
  });

  it('discovers known project paths before their workflows directory exists', () => {
    const knownOnlyProject = join(configDir, 'known-without-workflows');
    mkdirSync(knownOnlyProject, { recursive: true });
    const hashDir = join(configDir, 'projects', knownOnlyProject.replace(/\//g, '-'));
    mkdirSync(hashDir, { recursive: true });
    writeFileSync(join(hashDir, 'session.jsonl'), `${JSON.stringify({ cwd: knownOnlyProject })}\n`);

    expect(reader.discoverKnownProjectPaths()).toContain(knownOnlyProject);
    expect(reader.discoverProjectsWithWorkflows()).not.toContain(knownOnlyProject);
  });

  it('rejects relative project paths', async () => {
    await expect(reader.getBlueprintDetail('proj-flow', undefined, 'relative/dir')).rejects.toThrow(
      /Invalid project path/
    );
    await expect(
      writer.saveBlueprint(blueprint('evil-flow'), undefined, '../evil')
    ).rejects.toThrow(/Invalid project path/);
  });

  it('overwrites and deletes only within the project workflows dir', async () => {
    const changed = `${(await reader.getBlueprintDetail('proj-flow', undefined, projectDir))!.source}\n// edit\n`;
    await writer.writeNativeScript('proj-flow.js', changed, projectDir);
    expect((await reader.getBlueprintDetail('proj-flow', undefined, projectDir))?.source).toBe(
      changed
    );
    await expect(writer.writeNativeScript('../../outside.js', 'x', projectDir)).rejects.toThrow(
      /Invalid workflow script name/
    );
    writer.deleteBlueprint('proj-flow', true, projectDir);
    expect(existsSync(join(projectWorkflows, 'proj-flow.js'))).toBe(false);
  });
});
