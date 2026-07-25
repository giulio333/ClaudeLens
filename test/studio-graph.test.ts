import { describe, it, expect } from 'vitest';
import { buildGraph } from '../src/components/project/studio/canvas/graph';
import type { Blueprint, BlueprintStep } from '../src/types';

/** release-triage shaped fixture: parallel + for-each + a guard + a return object. */
function releaseTriage(): Blueprint {
  return {
    name: 'release-triage',
    description: 'triage a release diff',
    version: '0.1.0',
    brief: {
      goal: 'Triage the diff.',
      inputs: [{ name: 'tag', required: true }],
      expectedOutput: 'verdict + changelog',
      successCriteria: ['every file inspected'],
      onError: 'halt',
    },
    phases: [
      {
        title: 'Collect',
        nodes: [
          { kind: 'step', step: { id: 'collect', prompt: 'Collect the diff for ${args}' } },
          {
            kind: 'code',
            source: "if (!collect) return { verdict: 'hold', changelog: 'nothing' }",
          },
        ],
      },
      {
        title: 'Inspect',
        nodes: [
          {
            kind: 'parallel',
            steps: [
              { id: 'inspect', prompt: 'Review the changes:\n${collect}' },
              { id: 'security-check', prompt: 'Audit for vulnerabilities:\n${collect}' },
            ],
          },
        ],
      },
      {
        title: 'Per package',
        nodes: [
          {
            kind: 'pipeline',
            resultVar: 'notes',
            itemsSource: 'packages',
            stages: [
              {
                kind: 'agent',
                params: 'pkg',
                step: {
                  id: 'note',
                  prompt: 'Draft notes for ${pkg.name} from ${inspect}',
                  dynamicLabel: '`notes:${pkg.name}`',
                },
              },
              { kind: 'code', source: '(r, pkg) => ({ ...r, package: pkg.name })' },
            ],
          },
        ],
      },
      {
        title: 'Finalize',
        nodes: [
          {
            kind: 'step',
            step: {
              id: 'finalize',
              prompt: 'Merge ${inspect} and ${security-check} into a changelog.',
            },
          },
          {
            kind: 'code',
            source: 'return { verdict: finalize.verdict, changelog: finalize.changelog, notes }',
          },
        ],
      },
    ],
  };
}

/** find a block by kind (first match) or by the step id it hosts. */
const byStep = (g: ReturnType<typeof buildGraph>, id: string) =>
  g.blocks.find(b => b.step?.id === id || b.members?.some(m => m.step.id === id));
const byKind = (g: ReturnType<typeof buildGraph>, kind: string) =>
  g.blocks.find(b => b.kind === kind);
const hasEdge = (g: ReturnType<typeof buildGraph>, from: string, to: string, kind = 'data') =>
  g.edges.some(e => e.from === from && e.to === to && e.kind === kind);

describe('buildGraph — Canvas read-model', () => {
  it('makes one column per phase', () => {
    const g = buildGraph(releaseTriage());
    expect(g.columns.map(c => c.title)).toEqual(['Collect', 'Inspect', 'Per package', 'Finalize']);
    expect(g.columns.every(c => c.phase !== 'pre')).toBe(true);
  });

  it('classifies each construct into a typed block', () => {
    const g = buildGraph(releaseTriage());
    expect(byStep(g, 'collect')?.kind).toBe('agent');
    expect(byStep(g, 'inspect')?.kind).toBe('parallel');
    expect(byStep(g, 'security-check')?.kind).toBe('parallel');
    expect(byKind(g, 'foreach')?.pipeline?.resultVar).toBe('notes');
    expect(byKind(g, 'guard')).toBeTruthy();
    expect(byKind(g, 'output')).toBeTruthy();
  });

  it('derives data-flow edges from ${ref} and code identifiers', () => {
    const g = buildGraph(releaseTriage());
    const collect = byStep(g, 'collect')!;
    const parallel = byStep(g, 'inspect')!; // inspect + security-check folded into one block
    const foreach = byKind(g, 'foreach')!;
    const finalize = byStep(g, 'finalize')!;
    const output = byKind(g, 'output')!;
    const guard = byKind(g, 'guard')!;

    // collect → parallel (both members interpolate ${collect})
    expect(hasEdge(g, collect.id, parallel.id)).toBe(true);
    // parallel → finalize (${inspect} and ${security-check} both resolve to the parallel block)
    expect(hasEdge(g, parallel.id, finalize.id)).toBe(true);
    // parallel → for-each (the per-item stage interpolates ${inspect})
    expect(hasEdge(g, parallel.id, foreach.id)).toBe(true);
    // The output NAMES what its return composes instead of pulling an edge from
    // every producer across the whole canvas.
    expect(output.returnTokens).toEqual(['finalize', 'notes']);
    expect(g.edges.some(e => e.to === output.id)).toBe(false);
    // collect → guard (the guard tests `collect`)
    expect(hasEdge(g, collect.id, guard.id)).toBe(true);
  });

  it('does not connect a guard to the output (its own termination, not a feeder)', () => {
    const g = buildGraph(releaseTriage());
    const guard = byKind(g, 'guard')!;
    const output = byKind(g, 'output')!;
    // The guard returns its own value (`{ verdict: 'hold', … }`) and short-circuits;
    // it must not draw a (false) edge into the workflow's unrelated final output.
    expect(g.edges.some(e => e.from === guard.id && e.to === output.id)).toBe(false);
  });

  it('folds parallel members into a single container block (no cross-column hairball)', () => {
    const g = buildGraph(releaseTriage());
    const parallelBlocks = g.blocks.filter(b => b.kind === 'parallel');
    expect(parallelBlocks).toHaveLength(1);
    expect(parallelBlocks[0].members).toHaveLength(2);
  });

  it('lays out columns left-to-right with stable, deterministic coordinates', () => {
    const a = buildGraph(releaseTriage());
    const b = buildGraph(releaseTriage());
    expect(JSON.stringify(a.blocks.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })))).toBe(
      JSON.stringify(b.blocks.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })))
    );
    // x strictly increases with column index
    const cols = [...new Set(a.blocks.map(bl => bl.col))].sort((m, n) => m - n);
    const xForCol = cols.map(c => a.blocks.find(bl => bl.col === c)!.x);
    for (let i = 1; i < xForCol.length; i++) expect(xForCol[i]).toBeGreaterThan(xForCol[i - 1]);
  });

  it('synthesizes an OUTPUT block naming the auto-returned value', () => {
    const bp = releaseTriage();
    // drop the explicit `return { … }` code node
    bp.phases[3].nodes = bp.phases[3].nodes.filter(n => n.kind !== 'code');
    const g = buildGraph(bp);
    const output = byKind(g, 'output')!;
    expect(output.nodeRef).toBeNull(); // synthetic, read-only
    expect(output.returnTokens).toEqual(['finalize']);
    expect(g.edges.some(e => e.to === output.id)).toBe(false);
  });

  it('promotes a non-empty preamble to a "Setup" column at index 0', () => {
    const bp = releaseTriage();
    bp.preamble = [{ kind: 'code', source: 'const packages = args.split(",")' }];
    const g = buildGraph(bp);
    expect(g.columns[0].title).toBe('Setup');
    expect(g.columns[0].phase).toBe('pre');
    // the setup declaration feeds the for-each items expression (`packages`)
    const setup = g.blocks.find(b => b.kind === 'setup')!;
    const foreach = byKind(g, 'foreach')!;
    expect(hasEdge(g, setup.id, foreach.id)).toBe(true);
  });

  it('promotes a shared schema const to a "schema" block wired to every consumer', () => {
    const bp = releaseTriage();
    // A named schema const in the preamble, referenced by two agents via `schema: X`.
    bp.preamble = [{ kind: 'code', source: 'const VERDICT_SCHEMA = { type: "object" }' }];
    bp.phases[3].nodes[0] = {
      kind: 'step',
      step: {
        id: 'finalize',
        prompt: 'Merge ${inspect} and ${security-check} into a changelog.',
        schemaSource: 'VERDICT_SCHEMA',
      },
    };
    const parallelNode = bp.phases[1].nodes[0];
    if (parallelNode.kind === 'parallel') parallelNode.steps[0].schemaSource = 'VERDICT_SCHEMA';

    const g = buildGraph(bp);
    // ONE card for the two consumers — and it is the declaring node itself, so
    // the definition is edited where the script writes it.
    expect(g.blocks.filter(b => b.kind === 'schema')).toHaveLength(1);
    const schema = byKind(g, 'schema')!;
    expect(schema.label).toBe('VERDICT_SCHEMA');
    expect(schema.nodeRef).not.toBeNull();
    // it is NOT left as an anonymous setup block
    expect(byKind(g, 'setup')).toBeUndefined();
    // a `schema` edge reaches both the finalize agent and the parallel container
    const finalize = byStep(g, 'finalize')!;
    const parallel = byKind(g, 'parallel')!;
    expect(hasEdge(g, schema.id, finalize.id, 'schema')).toBe(true);
    expect(hasEdge(g, schema.id, parallel.id, 'schema')).toBe(true);
  });

  it('gives every agent-declared schema a card, whatever form the option takes', () => {
    const bp = releaseTriage();
    // A literal written on the call…
    const finalizeStep = (bp.phases[3].nodes[0] as { kind: 'step'; step: BlueprintStep }).step;
    finalizeStep.schemaSource = '{ type: "object", properties: { verdict: { type: "string" } } }';
    finalizeStep.schemaModel = {
      type: 'object',
      children: [{ name: 'verdict', required: false, node: { type: 'string' } }],
    };
    // …and a name this script never declares (imported / computed elsewhere).
    const parallelNode = bp.phases[1].nodes[0];
    if (parallelNode.kind === 'parallel') parallelNode.steps[0].schemaSource = 'VERDICT_SCHEMA';

    const g = buildGraph(bp);
    const finalize = byStep(g, 'finalize')!;
    const parallel = byKind(g, 'parallel')!;
    const cards = g.blocks.filter(b => b.kind === 'schema');
    expect(cards).toHaveLength(2);

    // Same shape for both: a card with no node of its own, parked under its agent.
    for (const card of cards) {
      expect(card.nodeRef).toBeNull();
      const owner = g.blocks.find(b => b.id === card.schemaOwnerBlockId)!;
      expect(card.col).toBe(owner.col);
      expect(card.y).toBeGreaterThan(owner.y);
      expect(hasEdge(g, card.id, owner.id, 'schema')).toBe(true);
    }

    const literal = cards.find(c => c.schemaOwnerBlockId === finalize.id)!;
    expect(literal.label).toBe('finalize');
    expect(literal.schemaOwnerStepId).toBe('finalize'); // editable on its step
    expect(literal.schemaModel?.children).toHaveLength(1);

    const named = cards.find(c => c.schemaOwnerBlockId === parallel.id)!;
    expect(named.label).toBe('VERDICT_SCHEMA');
    expect(named.schemaOwnerStepId).toBeUndefined(); // definition lives elsewhere
  });

  it('reads a guard’s condition, not the payload it returns on the way out', () => {
    const bp = parsedNativeShape();
    // The guard tests `fix` only; `picked` and `branch` are values it passes
    // along in its early return — not things it consumes.
    bp.phases[1].nodes.push({
      kind: 'code',
      source: 'if (!fix || !fix.green) {\n  return { issue: picked, branch, fix }\n}',
    });
    bp.phases[1].nodes.splice(0, 0, { kind: 'code', source: 'const branch = "fix/x"' });
    const g = buildGraph(bp);
    const guards = g.blocks.filter(b => b.kind === 'guard');
    const late = guards[guards.length - 1];
    const pick = byStep(g, 'pick-issue')!;
    const fix = byStep(g, 'fix')!;
    const setup = g.blocks.find(b => b.kind === 'setup')!;
    expect(hasEdge(g, fix.id, late.id)).toBe(true);
    expect(hasEdge(g, pick.id, late.id)).toBe(false);
    expect(hasEdge(g, setup.id, late.id)).toBe(false);
  });

  // Hand-written native scripts name the result variable freely, so the step id
  // (the agent's `label`) and the binding routinely differ — every consumer then
  // refs the binding, which the id/compiled-name pair alone cannot resolve.
  it('resolves refs to a step’s parsed result variable, not just its id', () => {
    const bp = parsedNativeShape();
    const g = buildGraph(bp);
    const pick = byStep(g, 'pick-issue')!;
    const fix = byStep(g, 'fix')!;
    const guard = byKind(g, 'guard')!;
    const log = byKind(g, 'log')!;

    // `${picked.number}` in a later prompt → an edge from the agent that bound it
    expect(hasEdge(g, pick.id, fix.id)).toBe(true);
    expect(g.edges.find(e => e.from === pick.id && e.to === fix.id)?.label).toBe('picked');
    // the guard tests the same binding in verbatim code
    expect(hasEdge(g, pick.id, guard.id)).toBe(true);
    // a progress line, though, is NOT wired: it consumes nothing, and its arrow
    // only restated the pick→fix dependency the canvas already draws.
    expect(hasEdge(g, pick.id, log.id)).toBe(false);
  });

  it('labels a step’s output with the variable the script binds, not its label', () => {
    const g = buildGraph(parsedNativeShape());
    // `agent(…, { label: 'pick-issue' })` assigned to `const picked`: every
    // consumer downstream writes `picked`, so that — not the label — is what
    // the card announces as the step's output.
    expect(byStep(g, 'pick-issue')!.produces).toEqual(['picked']);
  });

  it('falls back to the step id when the step binds no variable', () => {
    const bp = parsedNativeShape();
    delete bp.phases[0].nodes[0].step!.resultVar;
    const g = buildGraph(bp);
    expect(byStep(g, 'pick-issue')!.produces).toEqual(['pick-issue']);
  });
});

/** fix-issue shaped fixture: labels and result variables deliberately differ. */
function parsedNativeShape(): Blueprint {
  return {
    name: 'fix-issue',
    description: 'pick an issue and fix it',
    version: '0.1.0',
    brief: {
      goal: '',
      inputs: [],
      expectedOutput: '',
      successCriteria: [],
      onError: '',
    },
    phases: [
      {
        title: 'Pick',
        nodes: [
          {
            kind: 'step',
            step: { id: 'pick-issue', resultVar: 'picked', prompt: 'Choose one open issue.' },
          },
          { kind: 'code', source: 'if (!picked || !picked.number) {\n  return { error: null }\n}' },
          { kind: 'log', message: 'Picked #${picked.number} — ${picked.title}' },
        ],
      },
      {
        title: 'Fix',
        nodes: [
          {
            kind: 'step',
            step: { id: 'fix', resultVar: 'fix', prompt: 'Fix issue #${picked.number}.' },
          },
        ],
      },
    ],
  };
}
