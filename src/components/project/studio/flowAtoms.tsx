// Presentational atoms shared by the Flow spine (BlueprintEditorView) and the
// Canvas projection (canvas/*). Components only — the pure helpers they rely on
// (modelDot / promptExcerpt / describeCode) live in ./studioLang so this file
// stays a clean components-only module (react-refresh/only-export-components).

import { useState } from 'react';
import type { BlueprintStep } from '../../../types';
import { schemaFieldCount } from '../../../../electron/shared/studio-schema';
import {
  compactExpr,
  describeCode,
  inputCls,
  isSimpleRef,
  labelParts,
  modelDot,
  promptExcerpt,
  promptRefs,
  resolveRef,
} from './studioLang';

/** Vertical rail the flow hangs from; markers sit on the line. */
export function SpineRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className="absolute top-1 bottom-1"
        style={{ left: 13, width: 2, background: 'var(--cl-line)' }}
      />
      {children}
    </div>
  );
}

export function SpineMarker({ kind }: { kind: 'agent' | 'note' | 'group' }) {
  if (kind === 'agent') {
    return (
      <span
        className="absolute"
        style={{
          left: 7,
          top: 20,
          width: 14,
          height: 14,
          borderRadius: 4,
          background: 'var(--cl-accent)',
          boxShadow: '0 0 0 3px var(--cl-paper)',
        }}
      />
    );
  }
  if (kind === 'group') {
    return (
      <span
        className="absolute"
        style={{
          left: 9,
          top: 14,
          width: 10,
          height: 10,
          borderRadius: 3,
          border: '2px solid var(--cl-accent)',
          background: 'var(--cl-paper)',
          boxShadow: '0 0 0 3px var(--cl-paper)',
        }}
      />
    );
  }
  return (
    <span
      className="absolute"
      style={{
        left: 11,
        top: 15,
        width: 6,
        height: 6,
        borderRadius: 999,
        background: 'var(--cl-ink-4)',
        boxShadow: '0 0 0 3px var(--cl-paper)',
      }}
    />
  );
}

/** Card title: the step id, or the dynamic label with `${expr}` pieces rendered as code chips. */
export function StepTitle({ step }: { step: BlueprintStep }) {
  if (!step.dynamicLabel) return <>{step.id}</>;
  return (
    <>
      {labelParts(step.dynamicLabel).map((part, i) =>
        part.kind === 'text' ? (
          <span key={i}>{part.text}</span>
        ) : (
          <code
            key={i}
            className="font-mono text-[12px] font-normal px-1 py-[1px] mx-0.5 border border-[var(--cl-line)] text-[var(--cl-ink-2)]"
            title="Computed at runtime"
          >
            {part.expr}
          </code>
        )
      )}
    </>
  );
}

/** A data token on the flow: `${step-id}` a prompt can interpolate, or a plain variable. */
export function RefChip({
  token,
  dollar = true,
  on = false,
  muted = false,
  title,
}: {
  token: string;
  dollar?: boolean;
  on?: boolean;
  muted?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="font-mono text-[10px] px-1.5 py-[1px] border transition-colors"
      style={{
        borderColor: on ? 'var(--cl-accent)' : 'var(--cl-line)',
        color: on ? 'var(--cl-accent-ink)' : muted ? 'var(--cl-ink-4)' : 'var(--cl-ink-2)',
        background: on
          ? 'color-mix(in oklch, var(--cl-accent-soft) 55%, transparent)'
          : 'transparent',
      }}
    >
      {dollar ? `\${${token}}` : token}
    </span>
  );
}

export function AgentCard({
  step,
  kicker,
  showOut = true,
  nested = false,
  hideRefs = false,
  selected,
  selectedId,
  selectedRefs,
  refIndex,
  onSelect,
}: {
  step: BlueprintStep;
  kicker?: string;
  showOut?: boolean;
  /** Rendered inside a group box: no spine marker, tighter left padding. */
  nested?: boolean;
  /** Canvas cards keep the compact header only — the uses/produces footer is carried by edges. */
  hideRefs?: boolean;
  selected: boolean;
  /** Id of the currently selected step (cross-highlights "uses" chips pointing at it). */
  selectedId: string | null;
  /** Step ids the selected step's prompt reads (cross-highlights this card's "produces" chip). */
  selectedRefs: ReadonlySet<string>;
  /** Every name that reaches a step's output → that step's id (see buildRefIndex). */
  refIndex: ReadonlyMap<string, string>;
  onSelect: () => void;
}) {
  // An interpolation is either a reference to data (`${args}`, `${collect}`,
  // `${picked.number}`) or JavaScript that BUILDS prompt text (a ternary
  // choosing between two phrasings, a call, a join). Only the first kind is a
  // dependency: listing the second under "uses" claims a data flow that does
  // not exist, and spills the whole expression across the card.
  const uses: { expr: string; target: string | null }[] = [];
  const computed: string[] = [];
  for (const expr of promptRefs(step.prompt)) {
    if (expr === 'args') uses.push({ expr, target: null });
    else if (isSimpleRef(expr)) uses.push({ expr, target: resolveRef(refIndex, expr) });
    else computed.push(expr);
  }
  const hasRefs = uses.length > 0 || computed.length > 0;
  const outputKind = step.schemaModel
    ? `${step.schemaModel.type}${step.schemaModel.type === 'object' ? ` · ${schemaFieldCount(step.schemaModel)} fields` : ''}`
    : step.schemaSource
      ? 'JSON object'
      : 'text';
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative w-full text-left pr-3 py-4 transition-colors ${nested ? 'pl-4' : 'pl-10'}`}
      style={{
        background: selected
          ? 'color-mix(in oklch, var(--cl-accent-soft) 55%, transparent)'
          : undefined,
      }}
    >
      {!nested && <SpineMarker kind="agent" />}
      <div className="flex items-baseline gap-3">
        <span
          className="font-mono text-[9.5px] uppercase tracking-[0.2em]"
          style={{ color: 'var(--cl-accent-ink)' }}
        >
          {kicker ?? 'Agent'}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10.5px] text-[var(--cl-ink-4)]">
          {step.agentType ? `${step.agentType} · ` : ''}
          <span style={{ color: modelDot(step.model) }}>●</span>{' '}
          {step.model && step.model !== 'inherit' ? step.model : 'inherit'}
          {step.effort ? ` · ${step.effort}` : ''}
        </span>
      </div>
      <div className="mt-1 text-[16px] font-semibold tracking-[-0.015em] text-[var(--cl-ink)]">
        <StepTitle step={step} />
      </div>
      <p
        className="mt-1.5 mb-0 text-[13px] leading-relaxed text-[var(--cl-ink-2)]"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {step.prompt.trim()
          ? `“${promptExcerpt(step.prompt)}”`
          : 'No prompt yet — click to write one.'}
      </p>
      {!hideRefs && (hasRefs || showOut) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[10px]">
          {uses.length > 0 && (
            <>
              <span className="uppercase tracking-[0.14em] text-[var(--cl-ink-4)]">uses</span>
              {uses.map(({ expr, target }) => (
                <RefChip
                  key={expr}
                  token={expr}
                  on={target !== null && target === selectedId}
                  muted={expr !== 'args' && target === null}
                  title={
                    expr === 'args'
                      ? 'The /command argument string'
                      : target
                        ? `Output of step "${target}"`
                        : 'Resolved by the script at runtime'
                  }
                />
              ))}
            </>
          )}
          {computed.length > 0 && (
            <>
              <span className="uppercase tracking-[0.14em] text-[var(--cl-ink-4)]">computed</span>
              {computed.map(expr => (
                <RefChip
                  key={expr}
                  token={compactExpr(expr)}
                  muted
                  title={`The script builds this part of the prompt at runtime:\n\${${expr}}`}
                />
              ))}
            </>
          )}
          {hasRefs && showOut && <span className="text-[var(--cl-ink-4)] px-1">→</span>}
          {showOut && (
            <>
              <span
                className="uppercase tracking-[0.14em]"
                style={{ color: 'var(--cl-accent-ink)' }}
              >
                produces
              </span>
              <RefChip
                token={step.id}
                on={selected || selectedRefs.has(step.id)}
                title={`Later steps interpolate this output as \${${step.id}}`}
              />
              <span className="text-[var(--cl-ink-4)]">{outputKind}</span>
            </>
          )}
        </div>
      )}
    </button>
  );
}

/** Quiet spine note for verbatim code — expandable into the raw editor. */
export function CodeNote({
  source,
  tagOverride,
  nested = false,
  onChange,
}: {
  source: string;
  tagOverride?: string;
  /** Rendered inside a group box: no spine marker, tighter left padding. */
  nested?: boolean;
  onChange: (source: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { tag, label } = describeCode(source);
  return (
    <div className={`relative ${nested ? 'pl-4' : 'pl-10'}`}>
      {!nested && <SpineMarker kind="note" />}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full text-left flex items-baseline gap-2.5 py-2.5 pr-3"
        title={open ? 'Hide code' : 'Show code'}
      >
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--cl-ink-4)] border border-[var(--cl-line)] px-1.5 py-0.5">
          {tagOverride ?? tag}
        </span>
        <span className="truncate font-mono text-[11px] text-[var(--cl-ink-3)]">{label}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--cl-ink-4)]">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <textarea
          className={inputCls + ' resize-y font-mono text-[12px] leading-[1.6] mb-2'}
          style={{ minHeight: Math.min(320, 48 + source.split('\n').length * 19) }}
          value={source}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
          aria-label="Code block"
        />
      )}
    </div>
  );
}

export function LogNote({ message, onChange }: { message: string; onChange: (m: string) => void }) {
  return (
    <div className="relative pl-10 flex items-baseline gap-2.5 py-2.5 pr-3">
      <SpineMarker kind="note" />
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--cl-ink-4)] border border-[var(--cl-line)] px-1.5 py-0.5">
        note
      </span>
      <input
        className="w-full bg-transparent border-none outline-none font-mono text-[11px] italic text-[var(--cl-ink-3)] focus:text-[var(--cl-ink)]"
        value={message}
        placeholder="progress message shown while the workflow runs"
        onChange={e => onChange(e.target.value)}
        aria-label="Progress note"
      />
    </div>
  );
}
