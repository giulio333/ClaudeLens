// Agent Studio structured-output schema model, shared between the Electron
// main process and the renderer (same rationale as chat-types.ts: one
// definition, no hand-mirrored drift). Unlike chat-types this module also
// carries runtime code — pure functions with no imports — which compiles
// unchanged under both module systems (CommonJS main, ESNext renderer).
//
// The model covers the JSON-Schema subset the Workflow tool actually uses
// (type / description / enum / required / properties / items). Anything a
// schema node carries beyond that is preserved verbatim in `extras`, so
// serialize(parse(x)) is semantically lossless for every schema the model
// accepts; a literal the model can NOT fully represent must be rejected at
// derivation time (the editor then falls back to raw-source editing).

export type SchemaTypeName = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';

const SCHEMA_TYPES: readonly SchemaTypeName[] = [
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
];

export interface SchemaFieldModel {
  name: string;
  required: boolean;
  node: SchemaNodeModel;
}

export interface SchemaNodeModel {
  type: SchemaTypeName;
  description?: string;
  /** For string/number nodes: the allowed values. */
  enum?: (string | number)[];
  /** For array nodes: the item schema (absent = untyped items). */
  items?: SchemaNodeModel;
  /** For object nodes: the properties, in source order. */
  children?: SchemaFieldModel[];
  /** Unmodeled schema keys, re-emitted verbatim on serialize. */
  extras?: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Derive the editable model from a statically-evaluated schema literal.
 * Returns null when the literal cannot be represented without loss — the
 * caller must then keep the step in raw-source mode.
 */
export function schemaModelFromLiteral(value: unknown): SchemaNodeModel | null {
  if (!isPlainObject(value)) return null;
  const type = value.type;
  if (typeof type !== 'string' || !SCHEMA_TYPES.includes(type as SchemaTypeName)) return null;

  const node: SchemaNodeModel = { type: type as SchemaTypeName };
  const extras: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) return null; // a non-literal leaf the parser could not evaluate
    switch (key) {
      case 'type':
        break;
      case 'description':
        if (typeof raw !== 'string') return null;
        node.description = raw;
        break;
      case 'enum': {
        if (!Array.isArray(raw) || !raw.every(v => typeof v === 'string' || typeof v === 'number'))
          return null;
        node.enum = raw as (string | number)[];
        break;
      }
      case 'items': {
        if (node.type !== 'array') return null;
        const items = schemaModelFromLiteral(raw);
        if (!items) return null;
        node.items = items;
        break;
      }
      case 'properties': {
        if (node.type !== 'object' || !isPlainObject(raw)) return null;
        const children: SchemaFieldModel[] = [];
        for (const [name, child] of Object.entries(raw)) {
          const childNode = schemaModelFromLiteral(child);
          if (!childNode) return null;
          children.push({ name, required: false, node: childNode });
        }
        node.children = children;
        break;
      }
      case 'required': {
        if (node.type !== 'object') return null;
        if (!Array.isArray(raw) || !raw.every(v => typeof v === 'string')) return null;
        break; // applied after the loop, once properties are known
      }
      default:
        extras[key] = raw;
    }
  }

  if (node.type === 'object') {
    const required = Array.isArray(value.required) ? (value.required as string[]) : [];
    const names = new Set((node.children ?? []).map(c => c.name));
    // A `required` entry naming a property that does not exist cannot be
    // rebuilt from field flags — reject rather than silently drop it.
    if (!required.every(name => names.has(name))) return null;
    for (const child of node.children ?? []) child.required = required.includes(child.name);
  }

  if (Object.keys(extras).length > 0) node.extras = extras;
  return node;
}

/** Number of top-level fields, for the "object · N fields" label. */
export function schemaFieldCount(node: SchemaNodeModel): number {
  return node.children?.length ?? 0;
}

// ── Serialization ────────────────────────────────────────────────────────────

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

function key(name: string): string {
  return IDENT_RE.test(name) ? name : quote(name);
}

/** Generic JS-literal emitter for `extras` values (JSON data, single-quote style). */
function emitValue(value: unknown, pad: string): string {
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null)
    return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inline = value.map(v => emitValue(v, pad)).join(', ');
    if (inline.length <= 72 && !inline.includes('\n')) return `[${inline}]`;
    return `[\n${value.map(v => `${pad}  ${emitValue(v, pad + '  ')}`).join(',\n')}\n${pad}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `{\n${entries
      .map(([k, v]) => `${pad}  ${key(k)}: ${emitValue(v, pad + '  ')}`)
      .join(',\n')}\n${pad}}`;
  }
  return 'null';
}

/**
 * Emit the canonical schema literal (2-space indent, single quotes) for the
 * agent() `schema` option. `indent` is the nesting level of the opening brace.
 */
export function serializeSchemaModel(node: SchemaNodeModel, indent = 0): string {
  const pad = '  '.repeat(indent);
  const inner = '  '.repeat(indent + 1);
  const lines: string[] = [`type: ${quote(node.type)}`];
  if (node.description !== undefined) lines.push(`description: ${quote(node.description)}`);
  if (node.enum) lines.push(`enum: ${emitValue(node.enum, inner)}`);
  if (node.type === 'object') {
    const required = (node.children ?? []).filter(c => c.required).map(c => c.name);
    if (required.length > 0) lines.push(`required: ${emitValue(required, inner)}`);
    const children = node.children ?? [];
    if (children.length === 0) {
      lines.push('properties: {}');
    } else {
      const props = children
        .map(c => `${inner}  ${key(c.name)}: ${serializeSchemaModel(c.node, indent + 2)}`)
        .join(',\n');
      lines.push(`properties: {\n${props}\n${inner}}`);
    }
  }
  if (node.type === 'array' && node.items) {
    lines.push(`items: ${serializeSchemaModel(node.items, indent + 1)}`);
  }
  for (const [k, v] of Object.entries(node.extras ?? {})) {
    lines.push(`${key(k)}: ${emitValue(v, inner)}`);
  }
  return `{\n${lines.map(l => `${inner}${l}`).join(',\n')}\n${pad}}`;
}
