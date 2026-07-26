import { useRef, useState } from 'react';
import type { BlueprintStep } from '../../../types';
import { FieldHint } from '../shared/CreateFormKit';
import PromptPreview from './PromptPreview';
import { SchemaBuilder } from './SchemaBuilder';
import { inputCls, labelCls } from './studioLang';

const STEP_MODELS = ['inherit', 'sonnet', 'opus', 'haiku'] as const;
const STEP_EFFORTS = ['inherit', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

function TogglePills<T extends string>({
  values,
  active,
  onPick,
}: {
  values: readonly T[];
  active: T;
  onPick: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map(value => (
        <button
          key={value}
          type="button"
          onClick={() => onPick(value)}
          className={`font-mono text-[10.5px] uppercase tracking-[0.1em] px-2.5 py-1.5 rounded-[6px] border transition-colors ${
            active === value
              ? 'bg-[var(--cl-ink)] border-[var(--cl-ink)] text-[var(--cl-paper)]'
              : 'bg-[var(--cl-paper)] border-[var(--cl-line)] text-[var(--cl-ink-3)] hover:border-[var(--cl-ink-2)] hover:text-[var(--cl-ink)]'
          }`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

/**
 * Structured editor for one agent step. `refIds` are the step ids whose
 * output is available to this prompt (earlier steps); pipeline stages also
 * get `${item}`.
 */
export function StepInspector({
  step,
  agentNames,
  refIds,
  inPipeline,
  nested = false,
  onChange,
  onDuplicate,
  onRemove,
}: {
  step: BlueprintStep;
  agentNames: string[];
  refIds: string[];
  inPipeline: boolean;
  /** Hosted inside a group box (paper-2): flush margins, paper background. */
  nested?: boolean;
  onChange: (patch: Partial<BlueprintStep>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // Read prompts rendered by default (they are often long markdown); flip to
  // the raw textarea to edit. Sticky across step switches — a mode preference.
  const [previewPrompt, setPreviewPrompt] = useState(() => step.prompt.trim() !== '');

  const insertRef = (token: string) => {
    const textarea = promptRef.current;
    if (!textarea) {
      onChange({ prompt: step.prompt + token });
      return;
    }
    const at = textarea.selectionStart ?? step.prompt.length;
    const end = textarea.selectionEnd ?? at;
    onChange({ prompt: step.prompt.slice(0, at) + token + step.prompt.slice(end) });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(at + token.length, at + token.length);
    });
  };

  const refTokens = ['args', ...(inPipeline ? ['item'] : []), ...refIds];
  const section = 'pt-4 mt-4 border-t border-[var(--cl-line-soft)]';

  return (
    <div
      className={
        nested
          ? 'px-1'
          : 'ml-10 mb-3 rounded-[10px] border border-[var(--cl-line)] bg-[var(--cl-paper-2)] px-4 py-4'
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls}>
            <span>Step id</span>
            <FieldHint text="Lowercase slug, unique in the flow. Later steps reference this output as ${id}." />
          </label>
          <input
            className={inputCls}
            value={step.id}
            onChange={e => onChange({ id: e.target.value })}
          />
          {step.dynamicLabel && (
            <p className="mt-1 font-mono text-[10px] text-[var(--cl-ink-4)]">
              runtime label is computed: <code>{step.dynamicLabel}</code>
            </p>
          )}
        </div>
        <div>
          <label className={labelCls}>
            <span>Agent</span>
            <FieldHint text="A native agent type from ~/.claude/agents (optional — empty runs the default workflow subagent)." />
          </label>
          <input
            className={inputCls}
            list="studio-agent-types"
            placeholder="default subagent"
            value={step.agentType ?? ''}
            onChange={e => onChange({ agentType: e.target.value || undefined })}
          />
          <datalist id="studio-agent-types">
            {agentNames.map(n => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
      </div>

      <div className={`space-y-3.5 ${section}`}>
        <div>
          <label className={labelCls}>
            <span>Model</span>
          </label>
          <TogglePills
            values={STEP_MODELS}
            active={(step.model ?? 'inherit') as (typeof STEP_MODELS)[number]}
            onPick={m => onChange({ model: m === 'inherit' ? undefined : m })}
          />
        </div>
        <div>
          <label className={labelCls}>
            <span>Effort</span>
          </label>
          <TogglePills
            values={STEP_EFFORTS}
            active={(step.effort ?? 'inherit') as (typeof STEP_EFFORTS)[number]}
            onPick={ef => onChange({ effort: ef === 'inherit' ? undefined : ef })}
          />
        </div>
      </div>

      <div className={section}>
        <div className="flex items-center mb-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--cl-ink-3)]">
            Prompt
          </span>
          <FieldHint text="The subagent's task. Interpolate the workflow argument as ${args} and any earlier step's output as ${step-id}. In hybrid scripts any ${expression} stays live." />
          {step.prompt.trim() !== '' && (
            <button
              type="button"
              className="ml-auto font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--cl-ink-4)] hover:text-[var(--cl-ink-2)] transition-colors"
              onClick={() => setPreviewPrompt(p => !p)}
            >
              {previewPrompt ? 'edit' : 'preview'}
            </button>
          )}
        </div>
        {previewPrompt && step.prompt.trim() !== '' ? (
          <div
            className="rounded-[8px] border border-[var(--cl-line)] bg-[var(--cl-paper-2)] px-3.5 py-2.5 max-h-[420px] overflow-y-auto cursor-text"
            onDoubleClick={() => setPreviewPrompt(false)}
            title="Double-click to edit"
          >
            <PromptPreview prompt={step.prompt} />
          </div>
        ) : (
          <>
            <textarea
              ref={promptRef}
              className={inputCls + ' resize-y font-mono text-[12px] leading-relaxed'}
              style={
                { fieldSizing: 'content', minHeight: 120, maxHeight: 420 } as React.CSSProperties
              }
              placeholder={'Review this diff for regressions:\n${collect}'}
              value={step.prompt}
              onChange={e => onChange({ prompt: e.target.value })}
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--cl-ink-4)]">
                insert
              </span>
              {refTokens.map(token => (
                <button
                  key={token}
                  type="button"
                  className="font-mono text-[10.5px] px-2 py-1 rounded-[5px] border border-[var(--cl-line)] bg-[var(--cl-paper)] text-[var(--cl-ink-2)] hover:border-[var(--cl-ink-2)] hover:text-[var(--cl-ink)] transition-colors"
                  onClick={() => insertRef(`\${${token}}`)}
                  title={
                    token === 'args'
                      ? 'The /command argument string'
                      : token === 'item'
                        ? 'The current pipeline item'
                        : `Output of step "${token}"`
                  }
                >
                  {`\${${token}}`}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className={section}>
        <SchemaBuilder step={step} onPatch={onChange} />
      </div>

      <div className={`flex justify-end gap-2 ${section}`}>
        <button
          type="button"
          className="font-mono text-[10px] uppercase tracking-[0.14em] px-2.5 py-1.5 rounded-[6px] border border-[var(--cl-line)] text-[var(--cl-ink-3)] hover:border-[var(--cl-ink-2)] hover:text-[var(--cl-ink)] transition-colors"
          onClick={onDuplicate}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="font-mono text-[10px] uppercase tracking-[0.14em] px-2.5 py-1.5 rounded-[6px] border border-[var(--cl-line)] text-[var(--cl-danger)] hover:border-[var(--cl-danger)] transition-colors"
          onClick={onRemove}
        >
          Remove step
        </button>
      </div>
    </div>
  );
}
