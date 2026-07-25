import { useState } from 'react';
import type {
  BlueprintStep,
  SchemaFieldModel,
  SchemaNodeModel,
  SchemaTypeName,
} from '../../../types';
import { serializeSchemaModel, schemaFieldCount } from '../../../../electron/shared/studio-schema';
import { dedentSource } from './studioLang';
import { FieldHint } from '../shared/CreateFormKit';

const TYPES: SchemaTypeName[] = ['string', 'number', 'integer', 'boolean', 'array', 'object'];

const fieldInput =
  'w-full rounded-[7px] border border-[var(--cl-line)] bg-[var(--cl-paper)] px-2.5 py-1.5 text-[12.5px] text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none focus:border-[var(--cl-ink-2)] transition-colors';
const fieldSelect =
  'shrink-0 rounded-[7px] border border-[var(--cl-line)] bg-[var(--cl-paper)] px-2 py-1.5 font-mono text-[11px] text-[var(--cl-ink-2)] outline-none focus:border-[var(--cl-ink-2)] cursor-pointer transition-colors';

function retype(node: SchemaNodeModel, type: SchemaTypeName): SchemaNodeModel {
  const next: SchemaNodeModel = { ...node, type };
  if (type !== 'object') delete next.children;
  else next.children = node.children ?? [];
  if (type !== 'array') delete next.items;
  if (type !== 'string' && type !== 'number' && type !== 'integer') delete next.enum;
  return next;
}

/**
 * Chip-based editor for a field's enum. Each value is a removable pill; a
 * trailing input appends more — Enter or comma commits, Backspace on an empty
 * input pops the last, and pasting a comma-separated list adds them all. Numeric
 * strings are coerced to numbers, matching the schema serializer. Removing the
 * last value collapses the enum back to "+ allowed values" (never emits `[]`).
 */
function EnumEditor({
  values,
  onChange,
}: {
  values: (string | number)[];
  onChange: (next: (string | number)[] | undefined) => void;
}) {
  const [draft, setDraft] = useState('');
  const coerce = (raw: string): string | number =>
    /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  const addMany = (parts: string[]) => {
    const next = [...values];
    for (const p of parts.map(s => s.trim()).filter(Boolean)) {
      const v = coerce(p);
      if (!next.some(x => String(x) === String(v))) next.push(v);
    }
    onChange(next.length ? next : undefined);
  };
  const removeAt = (i: number) => {
    const next = values.filter((_, j) => j !== i);
    onChange(next.length ? next : undefined);
  };
  const commitDraft = () => {
    if (draft.trim()) {
      addMany([draft]);
      setDraft('');
    }
  };
  return (
    <div>
      <span className="block mb-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--cl-ink-4)]">
        allowed values
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--cl-line)] bg-[var(--cl-paper-2)] pl-2 pr-1 py-0.5 font-mono text-[11px] text-[var(--cl-ink-2)]"
          >
            {String(v)}
            <button
              type="button"
              className="grid place-items-center w-4 h-4 rounded-[4px] text-[var(--cl-ink-4)] hover:text-[var(--cl-danger)] transition-colors"
              onClick={() => removeAt(i)}
              title="Remove value"
              aria-label={`Remove ${String(v)}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[110px] rounded-[7px] border border-[var(--cl-line)] bg-[var(--cl-paper)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none focus:border-[var(--cl-ink-2)] transition-colors"
          value={draft}
          placeholder={values.length ? 'add another…' : 'type a value, Enter to add'}
          aria-label="Add allowed value"
          onChange={e => {
            const val = e.target.value;
            if (val.includes(',')) {
              addMany(val.split(','));
              setDraft('');
            } else {
              setDraft(val);
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
            } else if (e.key === 'Backspace' && !draft && values.length) {
              removeAt(values.length - 1);
            }
          }}
          onBlur={commitDraft}
        />
      </div>
    </div>
  );
}

/** Compact one-line rendering of an unmodeled schema value (pattern, min, format, …). */
function formatExtra(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null)
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Read-only chips for schema keys the field editor doesn't model (e.g. `pattern`,
 * `minimum`, `format`). They're preserved verbatim on save; this just makes them
 * visible instead of silently living in the source. Edit them via the source view.
 */
function ConstraintChips({ extras }: { extras: Record<string, unknown> }) {
  const entries = Object.entries(extras);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-[2px]">
      {entries.map(([k, v]) => {
        const value = formatExtra(v);
        return (
          <span
            key={k}
            className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--cl-line)] bg-[var(--cl-paper-2)] px-1.5 py-1 font-mono text-[10px] leading-none"
            title={`${k}: ${value}  ·  edit via the source view`}
          >
            <span className="uppercase tracking-[0.08em] text-[var(--cl-ink-4)]">{k}</span>
            <span className="max-w-[220px] truncate text-[var(--cl-ink-2)]">{value}</span>
          </span>
        );
      })}
    </div>
  );
}

/** One property row of an object node; recurses into object/array children. */
function FieldRow({
  field,
  depth,
  onChange,
  onRemove,
}: {
  field: SchemaFieldModel;
  depth: number;
  onChange: (next: SchemaFieldModel) => void;
  onRemove: () => void;
}) {
  const { node } = field;
  const setNode = (next: SchemaNodeModel) => onChange({ ...field, node: next });
  const isEnumType = node.type === 'string' || node.type === 'number' || node.type === 'integer';
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <input
          className={fieldInput + ' flex-1 min-w-0 font-mono text-[13px] text-[var(--cl-ink)]'}
          placeholder="field name"
          value={field.name}
          onChange={e => onChange({ ...field, name: e.target.value })}
          aria-label="Field name"
        />
        <select
          className={fieldSelect}
          value={node.type}
          onChange={e => setNode(retype(node, e.target.value as SchemaTypeName))}
          aria-label="Field type"
        >
          {TYPES.map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onChange({ ...field, required: !field.required })}
          className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.12em] px-2 py-1.5 rounded-[6px] border transition-colors"
          style={
            field.required
              ? {
                  color: 'var(--cl-paper)',
                  background: 'var(--cl-ink)',
                  borderColor: 'var(--cl-ink)',
                }
              : { color: 'var(--cl-ink-4)', borderColor: 'var(--cl-line)' }
          }
          title={
            field.required ? 'Required — click to make optional' : 'Optional — click to require'
          }
        >
          req
        </button>
        <button
          type="button"
          className="shrink-0 grid place-items-center w-7 h-7 rounded-[6px] text-[12px] text-[var(--cl-ink-4)] hover:text-[var(--cl-danger)] hover:bg-[var(--cl-paper-2)] transition-colors"
          onClick={onRemove}
          title="Remove field"
        >
          ✕
        </button>
      </div>
      <div className="mt-2.5 ml-1 pl-3 border-l-2 border-[var(--cl-line-soft)] space-y-2.5">
        {node.type === 'array' && (
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--cl-ink-4)]">
              items of
            </span>
            <select
              className={fieldSelect}
              value={node.items?.type ?? 'any'}
              onChange={e => {
                const t = e.target.value;
                setNode({
                  ...node,
                  items:
                    t === 'any'
                      ? undefined
                      : retype(node.items ?? { type: 'string' }, t as SchemaTypeName),
                });
              }}
              aria-label="Array item type"
            >
              <option value="any">any</option>
              {TYPES.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}
        <input
          className={fieldInput}
          placeholder="description (optional)"
          value={node.description ?? ''}
          onChange={e => setNode({ ...node, description: e.target.value || undefined })}
          aria-label="Field description"
        />
        {isEnumType && node.enum !== undefined && (
          <EnumEditor
            values={node.enum ?? []}
            onChange={next => setNode({ ...node, enum: next })}
          />
        )}
        {isEnumType && node.enum === undefined && (
          <button
            type="button"
            className="font-mono text-[9.5px] text-[var(--cl-ink-4)] hover:text-[var(--cl-ink-2)] transition-colors"
            onClick={() => setNode({ ...node, enum: [] })}
          >
            + allowed values
          </button>
        )}
        {node.extras && <ConstraintChips extras={node.extras} />}
        {node.type === 'object' && (
          <ObjectFields node={node} depth={depth + 1} onChange={setNode} />
        )}
        {node.type === 'array' && node.items?.type === 'object' && (
          <ObjectFields
            node={node.items}
            depth={depth + 1}
            onChange={items => setNode({ ...node, items })}
          />
        )}
      </div>
    </div>
  );
}

export function ObjectFields({
  node,
  depth,
  onChange,
}: {
  node: SchemaNodeModel;
  depth: number;
  onChange: (next: SchemaNodeModel) => void;
}) {
  const children = node.children ?? [];
  return (
    <div className={depth > 0 ? 'pl-3 ml-0.5 border-l border-[var(--cl-line)]' : ''}>
      {children.map((child, i) => (
        <div key={i} className={i > 0 ? 'pt-4 mt-4 border-t border-[var(--cl-line)]' : ''}>
          <FieldRow
            field={child}
            depth={depth}
            onChange={next =>
              onChange({ ...node, children: children.map((c, j) => (j === i ? next : c)) })
            }
            onRemove={() => onChange({ ...node, children: children.filter((_, j) => j !== i) })}
          />
        </div>
      ))}
      <button
        type="button"
        className="mt-3 w-full px-3 py-2 rounded-[9px] border border-dashed border-[var(--cl-line)] text-center text-[11.5px] text-[var(--cl-ink-4)] hover:text-[var(--cl-ink-2)] hover:border-[var(--cl-ink-4)] transition-colors"
        onClick={() =>
          onChange({
            ...node,
            children: [...children, { name: '', required: false, node: { type: 'string' } }],
          })
        }
      >
        + field
      </button>
    </div>
  );
}

/**
 * Structured-output editor for a step. The saved value is always
 * `schemaSource`; the builder keeps `schemaModel` alongside it (re-serialized
 * on every edit). Editing the raw source drops the model — the step stays in
 * source mode until the file is re-parsed (reload/save).
 */
export function SchemaBuilder({
  step,
  onPatch,
}: {
  step: BlueprintStep;
  onPatch: (patch: Partial<BlueprintStep>) => void;
}) {
  const [showSource, setShowSource] = useState(false);
  const model = step.schemaModel;

  const patchModel = (next: SchemaNodeModel) =>
    onPatch({ schemaModel: next, schemaSource: serializeSchemaModel(next) });

  const labelRow = (summary: string, actions: React.ReactNode) => (
    <div className="flex items-center mb-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--cl-ink-3)]">
        Structured output
      </span>
      <FieldHint text="JSON Schema for the agent() schema option — the subagent then returns a validated object instead of free text." />
      <span className="ml-2 font-mono text-[10px] text-[var(--cl-ink-4)]">{summary}</span>
      <span className="ml-auto flex items-center gap-2">{actions}</span>
    </div>
  );

  const smallAction = (label: string, onClick: () => void, danger = false) => (
    <button
      type="button"
      className={`font-mono text-[9.5px] uppercase tracking-[0.12em] transition-colors ${
        danger
          ? 'text-[var(--cl-ink-4)] hover:text-[var(--cl-danger)]'
          : 'text-[var(--cl-ink-4)] hover:text-[var(--cl-ink-2)]'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );

  // No schema yet — offer to add one.
  if (!step.schemaSource) {
    return (
      <div>
        {labelRow('none — the agent returns text', null)}
        <button
          type="button"
          className="font-mono text-[10.5px] px-3 py-1.5 border border-dashed border-[var(--cl-ink-4)] text-[var(--cl-ink-3)] hover:text-[var(--cl-ink)] hover:border-[var(--cl-ink-2)] transition-colors"
          onClick={() => {
            const seed: SchemaNodeModel = {
              type: 'object',
              children: [{ name: 'summary', required: true, node: { type: 'string' } }],
            };
            patchModel(seed);
            setShowSource(false);
          }}
        >
          + structured output
        </button>
      </div>
    );
  }

  // Hand-written / non-static schema: source is the only editable form.
  if (!model) {
    return (
      <div>
        {labelRow(
          'source only',
          smallAction(
            'remove',
            () => onPatch({ schemaSource: undefined, schemaModel: undefined }),
            true
          )
        )}
        <textarea
          className="w-full rounded-none border border-[var(--cl-line)] bg-[var(--cl-paper)] px-3 py-2 font-mono text-[12px] leading-[1.6] text-[var(--cl-ink)] outline-none focus:border-[var(--cl-ink)] resize-y"
          style={{ minHeight: Math.min(280, 48 + step.schemaSource.split('\n').length * 19) }}
          value={dedentSource(step.schemaSource)}
          onChange={e =>
            onPatch({ schemaSource: e.target.value || undefined, schemaModel: undefined })
          }
          spellCheck={false}
          aria-label="Schema source"
        />
        <p className="mt-1 font-mono text-[9.5px] text-[var(--cl-ink-4)]">
          This schema uses live expressions or shapes the field editor can't represent, so it is
          edited as source. It is written into the script verbatim.
        </p>
      </div>
    );
  }

  const summary = `${model.type}${model.type === 'object' ? ` · ${schemaFieldCount(model)} fields` : ''}`;

  return (
    <div>
      {labelRow(
        summary,
        <>
          {smallAction(showSource ? 'fields' : 'source', () => setShowSource(s => !s))}
          {smallAction(
            'remove',
            () => onPatch({ schemaSource: undefined, schemaModel: undefined }),
            true
          )}
        </>
      )}
      {showSource ? (
        <textarea
          className="w-full rounded-none border border-[var(--cl-line)] bg-[var(--cl-paper)] px-3 py-2 font-mono text-[12px] leading-[1.6] text-[var(--cl-ink)] outline-none focus:border-[var(--cl-ink)] resize-y"
          style={{ minHeight: Math.min(280, 48 + step.schemaSource.split('\n').length * 19) }}
          value={dedentSource(step.schemaSource)}
          onChange={e =>
            onPatch({ schemaSource: e.target.value || undefined, schemaModel: undefined })
          }
          spellCheck={false}
          aria-label="Schema source"
        />
      ) : model.type === 'object' ? (
        <ObjectFields node={model} depth={0} onChange={patchModel} />
      ) : (
        <p className="font-mono text-[10.5px] text-[var(--cl-ink-4)]">
          Top-level {model.type} schema — switch to source to edit it.
        </p>
      )}
    </div>
  );
}
