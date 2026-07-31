import { describe, it, expect } from 'vitest';
import {
  schemaModelFromLiteral,
  serializeSchemaModel,
  schemaFieldCount,
  type SchemaNodeModel,
} from '../electron/shared/studio-schema';
import { parseWorkflowScript } from '../electron/modules/studio-script';

/** Re-parse a serialized literal through the real script parser (acorn). */
function reparse(source: string): SchemaNodeModel | undefined {
  const script = [
    "export const meta = { name: 'x', description: 'x' }",
    "phase('P')",
    `const r = await agent('do it', { label: 'a', schema: ${source} })`,
  ].join('\n');
  const parsed = parseWorkflowScript(script, 'x.js');
  const node = parsed.blueprint.phases[0]?.nodes[0];
  return node?.kind === 'step' ? node.step.schemaModel : undefined;
}

describe('schemaModelFromLiteral', () => {
  it('models the common object schema with required flags', () => {
    const model = schemaModelFromLiteral({
      type: 'object',
      required: ['testFiles', 'passing'],
      properties: {
        testFiles: { type: 'array', items: { type: 'string' } },
        passing: { type: 'boolean' },
        summary: { type: 'string', description: 'one line' },
      },
    });
    expect(model).not.toBeNull();
    expect(model!.type).toBe('object');
    expect(schemaFieldCount(model!)).toBe(3);
    expect(model!.children!.map(c => [c.name, c.required])).toEqual([
      ['testFiles', true],
      ['passing', true],
      ['summary', false],
    ]);
    expect(model!.children![0].node.items).toEqual({ type: 'string' });
    expect(model!.children![2].node.description).toBe('one line');
  });

  it('captures enums and preserves unmodeled keys as extras', () => {
    const model = schemaModelFromLiteral({
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['real', 'refuted'] },
        score: { type: 'number', minimum: 0 },
      },
      additionalProperties: false,
    });
    expect(model).not.toBeNull();
    expect(model!.extras).toEqual({ additionalProperties: false });
    expect(model!.children![0].node.enum).toEqual(['real', 'refuted']);
    expect(model!.children![1].node.extras).toEqual({ minimum: 0 });
  });

  it('rejects literals it cannot represent without loss', () => {
    expect(schemaModelFromLiteral(null)).toBeNull();
    expect(schemaModelFromLiteral({ properties: {} })).toBeNull(); // no type
    expect(schemaModelFromLiteral({ type: 'weird' })).toBeNull();
    // required naming a property that does not exist cannot be rebuilt
    expect(
      schemaModelFromLiteral({ type: 'object', required: ['ghost'], properties: {} })
    ).toBeNull();
    // a non-literal leaf arrives as undefined from the AST walk
    expect(schemaModelFromLiteral({ type: 'object', properties: { a: undefined } })).toBeNull();
  });
});

describe('serializeSchemaModel round-trip', () => {
  const cases: Record<string, unknown> = {
    flat: {
      type: 'object',
      required: ['verdict'],
      properties: { verdict: { type: 'string' } },
    },
    nested: {
      type: 'object',
      required: ['findings'],
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['file', 'line'],
            properties: {
              file: { type: 'string' },
              line: { type: 'number' },
              notes: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        summary: { type: 'string', description: "what's left, in one line" },
      },
    },
    extrasAndEnum: {
      type: 'object',
      properties: {
        level: { type: 'string', enum: ['low', 'high'] },
        'kebab-key': { type: 'boolean' },
      },
      additionalProperties: false,
      $comment: 'kept verbatim',
    },
    emptyObject: { type: 'object', properties: {} },
    bareArray: { type: 'array' },
  };

  for (const [name, literal] of Object.entries(cases)) {
    it(`serialize → parse → same model (${name})`, () => {
      const model = schemaModelFromLiteral(literal);
      expect(model).not.toBeNull();
      const source = serializeSchemaModel(model!);
      expect(reparse(source)).toEqual(model);
    });
  }

  it('emits the canonical 2-space single-quote style', () => {
    const model = schemaModelFromLiteral({
      type: 'object',
      required: ['ok'],
      properties: { ok: { type: 'boolean' } },
    })!;
    expect(serializeSchemaModel(model)).toBe(
      [
        '{',
        "  type: 'object',",
        "  required: ['ok'],",
        '  properties: {',
        '    ok: {',
        "      type: 'boolean'",
        '    }',
        '  }',
        '}',
      ].join('\n')
    );
  });

  it('escapes quotes and newlines in strings', () => {
    const model = schemaModelFromLiteral({
      type: 'string',
      description: "it's\ntwo lines",
    })!;
    const source = serializeSchemaModel(model);
    expect(reparse(source)).toEqual(model);
  });
});

describe('parser schemaModel derivation', () => {
  it('derives the model from a static schema literal', () => {
    const model = reparse(
      "{ type: 'object', required: ['a'], properties: { a: { type: 'string' } } }"
    );
    expect(model).toBeDefined();
    expect(model!.children![0]).toMatchObject({ name: 'a', required: true });
  });

  it('leaves schemaModel absent for non-static literals, keeping schemaSource', () => {
    const script = [
      "export const meta = { name: 'x', description: 'x' }",
      'const LEVELS = ["low"]',
      "phase('P')",
      "const r = await agent('do it', { label: 'a', schema: { type: 'string', enum: LEVELS } })",
    ].join('\n');
    const parsed = parseWorkflowScript(script, 'x.js');
    const node = parsed.blueprint.phases[0]?.nodes[0];
    expect(node?.kind).toBe('step');
    if (node?.kind === 'step') {
      expect(node.step.schemaModel).toBeUndefined();
      expect(node.step.schemaSource).toBe("{ type: 'string', enum: LEVELS }");
    }
  });
});
