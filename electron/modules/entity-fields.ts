import { getString, getBoolean, getStringArray, getNumber, yamlScalar } from './frontmatter';

/**
 * Single source of truth for the frontmatter fields of an agent / skill: the
 * model key (`key`), the YAML key it maps to (`yamlKey`), and its scalar kind.
 * Both the reader (`parseFields`) and the writer (`emitFields`) consume this,
 * so a field's name and type are declared exactly once — the reader can never
 * drift from the writer (e.g. an agent reading `tools:` while the writer emits
 * `allowed-tools:`).
 */
export type FieldKind = 'string' | 'boolean' | 'number' | 'string[]';

export interface EntityField {
  key: string;
  yamlKey: string;
  kind: FieldKind;
}

// Order mirrors the frontmatter block each writer used to emit by hand.
// `name` is handled separately by the reader/writer (required + filename
// fallback for agents, directory-derived for skills), so it is NOT listed here.
export const AGENT_FIELDS: EntityField[] = [
  { key: 'description', yamlKey: 'description', kind: 'string' },
  { key: 'model', yamlKey: 'model', kind: 'string' },
  { key: 'allowedTools', yamlKey: 'tools', kind: 'string[]' },
  { key: 'disallowedTools', yamlKey: 'disallowedTools', kind: 'string[]' },
  { key: 'permissionMode', yamlKey: 'permissionMode', kind: 'string' },
  { key: 'maxTurns', yamlKey: 'maxTurns', kind: 'number' },
  { key: 'background', yamlKey: 'background', kind: 'boolean' },
  { key: 'isolation', yamlKey: 'isolation', kind: 'string' },
  { key: 'memory', yamlKey: 'memory', kind: 'string' },
  { key: 'effort', yamlKey: 'effort', kind: 'string' },
  { key: 'color', yamlKey: 'color', kind: 'string' },
  { key: 'skills', yamlKey: 'skills', kind: 'string[]' },
  { key: 'mcpServers', yamlKey: 'mcpServers', kind: 'string[]' },
  { key: 'disableModelInvocation', yamlKey: 'disable_model_invocation', kind: 'boolean' },
];

export const SKILL_FIELDS: EntityField[] = [
  { key: 'description', yamlKey: 'description', kind: 'string' },
  { key: 'argumentHint', yamlKey: 'argument-hint', kind: 'string' },
  { key: 'disableModelInvocation', yamlKey: 'disable-model-invocation', kind: 'boolean' },
  { key: 'userInvocable', yamlKey: 'user-invocable', kind: 'boolean' },
  { key: 'allowedTools', yamlKey: 'allowed-tools', kind: 'string[]' },
  { key: 'model', yamlKey: 'model', kind: 'string' },
  { key: 'context', yamlKey: 'context', kind: 'string' },
  { key: 'agent', yamlKey: 'agent', kind: 'string' },
];

type FieldValue = string | boolean | number | string[];

/**
 * Read every field in `fields` from a parsed frontmatter record, keyed by the
 * model `key`. A field absent (or holding an unusable value) is omitted, so the
 * caller keeps optional fields `undefined` rather than forcing empty values.
 */
export function parseFields(
  raw: Record<string, unknown>,
  fields: EntityField[]
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const f of fields) {
    let v: FieldValue | undefined;
    switch (f.kind) {
      case 'string':
        v = getString(raw, f.yamlKey);
        break;
      case 'boolean':
        v = getBoolean(raw, f.yamlKey);
        break;
      case 'number':
        v = getNumber(raw, f.yamlKey);
        break;
      case 'string[]':
        v = getStringArray(raw, f.yamlKey);
        break;
    }
    if (v !== undefined) out[f.key] = v;
  }
  return out;
}

/**
 * Emit the frontmatter lines for `input` per `fields`. Strings and list entries
 * are quoted via `yamlScalar` so a value with a colon, `#`, etc. can't break the
 * YAML block (which would make the reader drop ALL frontmatter on load). Absent,
 * null, empty-string, and empty-array values are skipped.
 */
export function emitFields(input: Record<string, unknown>, fields: EntityField[]): string[] {
  const lines: string[] = [];
  for (const f of fields) {
    const v = input[f.key];
    if (v === undefined || v === null) continue;
    if (f.kind === 'string[]') {
      const arr = v as string[];
      if (arr.length > 0) lines.push(`${f.yamlKey}: [${arr.map(yamlScalar).join(', ')}]`);
    } else if (f.kind === 'boolean' || f.kind === 'number') {
      lines.push(`${f.yamlKey}: ${v}`);
    } else if (v !== '') {
      lines.push(`${f.yamlKey}: ${yamlScalar(v as string)}`);
    }
  }
  return lines;
}
