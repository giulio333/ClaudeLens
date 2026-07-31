import {
  Blueprint,
  BlueprintStep,
  compileBlueprint,
  validateBlueprint,
  stepVarName,
  emitPromptLiteral,
  scanInterpolations,
  blueprintSteps,
  countCodeNodes,
} from '../electron/modules/studio-compiler';

const step = (s: Partial<BlueprintStep> & { id: string; prompt: string }): BlueprintStep => s;

function blueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    name: 'release-triage',
    description: 'triage a release diff',
    version: '0.1.0',
    brief: {
      goal: 'Given a release tag, triage the diff.',
      inputs: [{ name: 'tag', description: 'release tag', required: true }],
      expectedOutput: 'verdict + changelog draft',
      successCriteria: ['every changed file inspected'],
      onError: 'halt and report the failing step',
    },
    phases: [
      {
        title: 'Collect',
        nodes: [
          {
            kind: 'step',
            step: step({
              id: 'collect',
              prompt: 'Collect the release diff for ${args}',
              agentType: 'repo-scout',
              model: 'haiku',
            }),
          },
        ],
      },
      {
        title: 'Inspect',
        detail: 'review + audit in parallel',
        nodes: [
          {
            kind: 'parallel',
            steps: [
              step({ id: 'inspect', prompt: 'Review this diff:\n${collect}', model: 'sonnet' }),
              step({ id: 'security-check', prompt: 'Audit this diff:\n${collect}', model: 'opus' }),
            ],
          },
        ],
      },
      {
        title: 'Finalize',
        nodes: [
          {
            kind: 'step',
            step: step({
              id: 'finalize',
              prompt: 'Merge ${inspect} and ${security-check} into a changelog.',
            }),
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('stepVarName', () => {
  it('camelCases dashed ids', () => {
    expect(stepVarName('security-check')).toBe('securityCheck');
    expect(stepVarName('collect')).toBe('collect');
  });

  it('never emits a reserved workflow global', () => {
    expect(stepVarName('args')).toBe('argsStep');
    expect(stepVarName('parallel')).toBe('parallelStep');
  });

  it('never starts with a digit', () => {
    expect(stepVarName('2nd-pass')).toMatch(/^[A-Za-z]/);
  });
});

describe('scanInterpolations', () => {
  it('finds simple and nested-brace interpolations', () => {
    expect(scanInterpolations('a ${x} b ${JSON.stringify({a: 1})}').map(m => m.expr)).toEqual([
      'x',
      'JSON.stringify({a: 1})',
    ]);
  });

  it('leaves unclosed openers as plain text', () => {
    expect(scanInterpolations('broken ${x')).toEqual([]);
  });
});

describe('emitPromptLiteral', () => {
  const vars = new Map([['collect', 'collect']]);

  it('keeps known refs live and rewrites them to variables', () => {
    const known = new Set(['args', 'collect']);
    expect(emitPromptLiteral('a ${args} b ${collect}', known, vars)).toBe(
      '`a ${args} b ${collect}`'
    );
  });

  it('escapes unknown refs, backticks and interpolation openers', () => {
    const known = new Set(['args']);
    const out = emitPromptLiteral('`x` ${nope} ${args}', known, vars);
    expect(out).toBe('`\\`x\\` \\${nope} ${args}`');
  });

  it('emits unknown expressions live in verbatim mode (hybrid scripts)', () => {
    const out = emitPromptLiteral(
      'x ${JSON.stringify(map)} ${args}',
      new Set(['args']),
      vars,
      true
    );
    expect(out).toBe('`x ${JSON.stringify(map)} ${args}`');
  });

  it('escapes backslashes so windows paths survive', () => {
    const out = emitPromptLiteral('C:\\repo', new Set(), vars);
    expect(out).toBe('`C:\\\\repo`');
  });
});

describe('compileBlueprint', () => {
  const script = compileBlueprint(blueprint());

  it('emits a pure-literal meta block with name, description and phases', () => {
    expect(script).toContain('export const meta = {');
    expect(script).toContain('name: "release-triage"');
    expect(script).toContain('description: "triage a release diff"');
    expect(script).toContain('{ title: "Collect" }');
    expect(script).toContain('{ title: "Inspect", detail: "review + audit in parallel" }');
  });

  it('compiles single-step phases to a sequential awaited agent()', () => {
    expect(script).toContain('phase("Collect")');
    expect(script).toContain(
      'const collect = await agent(`Collect the release diff for ${args}`, { label: "collect", agentType: "repo-scout", model: "haiku" })'
    );
  });

  it('compiles parallel nodes to parallel() with destructuring and per-agent phase opts', () => {
    expect(script).toContain('const [inspect, securityCheck] = await parallel([');
    expect(script).toContain(
      '() => agent(`Review this diff:\n${collect}`, { label: "inspect", phase: "Inspect", model: "sonnet" })'
    );
  });

  it('rewrites dashed step refs to their camelCase variables', () => {
    expect(script).toContain('Merge ${inspect} and ${securityCheck} into a changelog.');
  });

  it('returns the last phase result', () => {
    expect(script.trimEnd().endsWith('return finalize')).toBe(true);
  });

  it('returns an object when the last phase is parallel', () => {
    const bp = blueprint();
    bp.phases = bp.phases.slice(0, 2);
    expect(compileBlueprint(bp).trimEnd().endsWith('return { inspect, securityCheck }')).toBe(true);
  });

  it('documents the run command and success criteria as comments', () => {
    expect(script).toContain('// Run from any session as: /release-triage <tag>');
    expect(script).toContain('// Success: every changed file inspected');
  });

  it('keeps unknown refs literal in pure visual blueprints so a draft still compiles to valid JS', () => {
    const bp = blueprint();
    const first = bp.phases[0].nodes[0];
    if (first.kind === 'step') first.step.prompt = 'uses ${missing-step}';
    expect(compileBlueprint(bp)).toContain('`uses \\${missing-step}`');
  });

  it('dedupes colliding variable names deterministically', () => {
    const bp = blueprint();
    bp.phases = [
      { title: 'A', nodes: [{ kind: 'step', step: step({ id: 'my-step', prompt: 'a' }) }] },
      { title: 'B', nodes: [{ kind: 'step', step: step({ id: 'my--step', prompt: 'b' }) }] },
    ];
    const out = compileBlueprint(bp);
    expect(out).toContain('const myStep = ');
    expect(out).toContain('const myStep2 = ');
  });

  it('preserves parsed variable names via resultVar', () => {
    const bp = blueprint();
    bp.phases = [
      {
        title: 'Map',
        nodes: [
          { kind: 'step', step: step({ id: 'map:repo', prompt: 'map', resultVar: 'repoMap' }) },
          { kind: 'code', source: 'const n = repoMap.modules.length' },
        ],
      },
    ];
    const out = compileBlueprint(bp);
    expect(out).toContain('const repoMap = await agent(');
    expect(out).toContain('label: "map:repo"');
    expect(out).toContain('const n = repoMap.modules.length');
  });

  it('emits schema, isolation, dynamic labels and explicit phase options', () => {
    const bp = blueprint();
    bp.phases = [
      {
        title: 'Run',
        nodes: [
          {
            kind: 'step',
            step: step({
              id: 'run',
              prompt: 'go',
              schemaSource: '{ type: "object" }',
              isolation: 'worktree',
              explicitPhase: true,
            }),
          },
        ],
      },
    ];
    const out = compileBlueprint(bp);
    expect(out).toContain('phase: "Run"');
    expect(out).toContain('isolation: "worktree"');
    expect(out).toContain('schema: { type: "object" }');
  });

  it('emits log, code and pipeline nodes with verbatim sources and suppresses auto-return', () => {
    const bp = blueprint();
    bp.preamble = [
      { kind: 'code', source: "const target = (args && args.target) || '.'", leading: '// scope' },
    ];
    bp.phases = [
      {
        title: 'Write',
        nodes: [
          { kind: 'log', message: 'working on ${target}' },
          {
            kind: 'pipeline',
            resultVar: 'written',
            itemsSource: 'items',
            stages: [
              {
                kind: 'agent',
                params: 'item',
                step: step({ id: 'write', prompt: 'write ${item.path}' }),
              },
              { kind: 'code', source: '(result, item) => (result ? { ...result } : null)' },
            ],
          },
          { kind: 'code', source: 'return written.filter(Boolean)' },
        ],
      },
    ];
    const out = compileBlueprint(bp);
    expect(out).toContain('// scope');
    expect(out).toContain("const target = (args && args.target) || '.'");
    expect(out).toContain('log(`working on ${target}`)'); // hybrid → live interpolation
    expect(out).toContain('const written = await pipeline(');
    expect(out).toContain(
      '(item) => agent(`write ${item.path}`, { label: "write", phase: "Write" }),'
    );
    expect(out).toContain('(result, item) => (result ? { ...result } : null),');
    expect(out).toContain('return written.filter(Boolean)');
    expect(out.trimEnd().endsWith('return written.filter(Boolean)')).toBe(true);
  });
});

describe('validateBlueprint', () => {
  it('accepts the reference blueprint', () => {
    expect(validateBlueprint(blueprint()).filter(i => i.severity === 'error')).toEqual([]);
  });

  it('rejects names that are not command-safe', () => {
    const issues = validateBlueprint(blueprint({ name: 'Release Triage' }));
    expect(issues.some(i => i.code === 'invalid-name')).toBe(true);
  });

  it('rejects an empty flow', () => {
    const issues = validateBlueprint(blueprint({ phases: [] }));
    expect(issues.some(i => i.code === 'no-phases')).toBe(true);
  });

  it('rejects duplicate step ids and empty prompts', () => {
    const bp = blueprint();
    const inspect = bp.phases[1].nodes[0];
    if (inspect.kind === 'parallel') inspect.steps[1] = step({ id: 'inspect', prompt: '' });
    const codes = validateBlueprint(bp).map(i => i.code);
    expect(codes).toContain('duplicate-step');
    expect(codes).toContain('empty-prompt');
  });

  it('flags a same-phase sibling reference as a contract violation', () => {
    const bp = blueprint();
    const inspect = bp.phases[1].nodes[0];
    if (inspect.kind === 'parallel') inspect.steps[0].prompt = 'compare with ${security-check}';
    const issue = validateBlueprint(bp).find(i => i.code === 'sibling-ref');
    expect(issue?.severity).toBe('error');
    expect(issue?.stepId).toBe('inspect');
  });

  it('flags forward references (the no-cycles guarantee)', () => {
    const bp = blueprint();
    const collect = bp.phases[0].nodes[0];
    if (collect.kind === 'step') collect.step.prompt = 'peek at ${finalize}';
    expect(validateBlueprint(bp).some(i => i.code === 'forward-ref')).toBe(true);
  });

  it('explains that brief inputs arrive as ${args}', () => {
    const bp = blueprint();
    const collect = bp.phases[0].nodes[0];
    if (collect.kind === 'step') collect.step.prompt = 'collect ${tag}';
    const issue = validateBlueprint(bp).find(i => i.code === 'input-ref');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toContain('${args}');
  });

  it('warns when a referenced agent does not exist in the provided registry', () => {
    const issues = validateBlueprint(blueprint(), { agentTypes: ['other-agent'] });
    const issue = issues.find(i => i.code === 'unknown-agent');
    expect(issue?.severity).toBe('warning');
  });

  it('stays silent about agents when no registry is provided', () => {
    expect(validateBlueprint(blueprint()).some(i => i.code === 'unknown-agent')).toBe(false);
  });

  it('warns when declared inputs are never interpolated', () => {
    const bp = blueprint();
    const collect = bp.phases[0].nodes[0];
    if (collect.kind === 'step') collect.step.prompt = 'collect the latest tag';
    expect(validateBlueprint(bp).some(i => i.code === 'args-never-used')).toBe(true);
  });

  it('does not flag unknown refs or unresolved identifiers in hybrid blueprints', () => {
    const bp = blueprint();
    bp.preamble = [{ kind: 'code', source: "const target = args || '.'" }];
    const collect = bp.phases[0].nodes[0];
    if (collect.kind === 'step') collect.step.prompt = 'collect under ${target}';
    expect(validateBlueprint(bp).some(i => i.code === 'unknown-ref')).toBe(false);
  });

  it('allows sequential same-phase references between step nodes', () => {
    const bp = blueprint();
    bp.phases = [
      {
        title: 'Seq',
        nodes: [
          { kind: 'step', step: step({ id: 'first', prompt: 'go' }) },
          { kind: 'step', step: step({ id: 'second', prompt: 'refine ${first}' }) },
        ],
      },
    ];
    expect(validateBlueprint(bp).filter(i => i.severity === 'error')).toEqual([]);
  });

  it('accepts colon-namespaced step ids (parsed agent labels)', () => {
    const bp = blueprint();
    const collect = bp.phases[0].nodes[0];
    if (collect.kind === 'step') collect.step.id = 'map:repo';
    expect(validateBlueprint(bp).some(i => i.code === 'invalid-step-id')).toBe(false);
  });
});

describe('node helpers', () => {
  it('flattens steps across step, parallel and pipeline nodes', () => {
    const bp = blueprint();
    bp.phases[0].nodes.push({
      kind: 'pipeline',
      resultVar: 'r',
      itemsSource: 'items',
      stages: [
        { kind: 'agent', params: 'item', step: step({ id: 'stage', prompt: 'p' }) },
        { kind: 'code', source: 'x => x' },
      ],
    });
    expect(blueprintSteps(bp).map(s => s.id)).toEqual([
      'collect',
      'stage',
      'inspect',
      'security-check',
      'finalize',
    ]);
    expect(countCodeNodes(bp)).toBe(1);
  });
});
