// One positioned block, rendered by kind — the "clean lanes" language (design
// 1a): essential cards (monogram · title · model dot, then a model line and a
// `→ output` line), warm warn-soft guards, and glass pills for OUTPUT. Blocks
// are display + selection only — every edit happens in the right-hand inspector
// (CanvasSidebar), so a block never threads the mutation handlers. The details
// (prompt, schema, stages) open on click; the card stays minimal.

import type { BlueprintStep } from '../../../../types';
import { schemaFieldCount } from '../../../../../electron/shared/studio-schema';
import { StepTitle } from '../flowAtoms';
import { describeCode, guardReturnValue, modelDot } from '../studioLang';
import type { PositionedBlock } from './graph';

// ── Small presentational atoms ────────────────────────────────────────────────

function monogramChar(step: BlueprintStep): string {
  const s = (step.id || '').replace(/[^A-Za-z0-9]/g, '');
  return (s[0] || '•').toUpperCase();
}

function Monogram({ ch, accent = false }: { ch: string; accent?: boolean }) {
  return (
    <div
      className="grid place-items-center shrink-0 font-mono font-semibold text-[13px]"
      style={{
        width: 27,
        height: 27,
        borderRadius: 7,
        ...(accent
          ? { background: 'var(--cl-accent)', color: 'var(--cl-on-accent)' }
          : { border: '1px solid var(--cl-line)', color: 'var(--cl-ink-2)' }),
      }}
    >
      {ch}
    </div>
  );
}

function ModelDot({ model }: { model?: string }) {
  return (
    <span
      className="shrink-0"
      style={{ width: 8, height: 8, borderRadius: '50%', background: modelDot(model) }}
    />
  );
}

/** Card title: the dynamic label, or the step id with its `:` in the accent. */
function CardTitle({ step }: { step: BlueprintStep }) {
  if (step.dynamicLabel) return <StepTitle step={step} />;
  const i = step.id.indexOf(':');
  if (i < 0) return <>{step.id}</>;
  return (
    <>
      {step.id.slice(0, i)}
      <span style={{ color: 'var(--cl-accent)' }}>:</span>
      {step.id.slice(i + 1)}
    </>
  );
}

function modelLine(step: BlueprintStep): string {
  const m = step.model && step.model !== 'inherit' ? step.model : 'inherit';
  return step.effort ? `${m} · effort ${step.effort}` : m;
}

function OutLine({ token }: { token: string }) {
  return (
    <div className="truncate font-mono text-[13px] text-[var(--cl-ink-3)]">
      <span className="text-[var(--cl-ink-4)]">→</span> {token}
    </div>
  );
}

function Badge({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className="inline-flex items-center self-start font-mono text-[9.5px] uppercase tracking-[0.16em] px-2 py-0.5 rounded-md"
      style={
        muted
          ? { color: 'var(--cl-ink-4)', border: '1px solid var(--cl-line)' }
          : {
              color: 'var(--cl-accent-ink)',
              background: 'var(--cl-accent-soft)',
              border: '1px solid color-mix(in oklch, var(--cl-accent) 30%, transparent)',
            }
      }
    >
      {children}
    </span>
  );
}

// ── Annotation row (verbatim JS: setup / guard / log / code) ───────────────────
// Not a card: agent cards are the only large objects on the canvas, exactly as
// on the Flow spine. One line, ellipsis, never truncated mid-glyph — a fixed
// card height around free-form source could only clip. The whole statement is
// one hover (title) or one click (inspector) away.

function AnnotationRow({
  block,
  active,
  onHover,
  onClick,
  tag,
  primary,
  secondary,
  title,
  warn = false,
  italic = false,
}: {
  block: PositionedBlock;
  active: boolean;
  onHover: (id: string | null) => void;
  onClick: () => void;
  tag: string;
  primary: string;
  secondary?: string;
  title?: string;
  warn?: boolean;
  italic?: boolean;
}) {
  const accent = warn
    ? 'color-mix(in oklch, var(--cl-warn) 62%, var(--cl-ink))'
    : 'var(--cl-ink-4)';
  return (
    <div
      data-block={block.id}
      className="absolute flex items-center gap-2.5 overflow-hidden transition-colors"
      style={{
        left: block.x,
        top: block.y,
        width: block.w,
        height: block.h,
        padding: '0 13px 0 12px',
        borderRadius: 9,
        border: `1px solid ${active ? 'var(--cl-accent)' : 'var(--cl-line-soft)'}`,
        borderLeft: `2px solid ${
          active
            ? 'var(--cl-accent)'
            : warn
              ? 'color-mix(in oklch, var(--cl-warn) 52%, var(--cl-line))'
              : 'var(--cl-line)'
        }`,
        background: active ? 'var(--cl-paper-2)' : 'var(--cl-paper)',
        cursor: 'pointer',
      }}
      title={title}
      onMouseEnter={() => onHover(block.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
    >
      <span
        className="shrink-0 font-mono text-[9px] uppercase tracking-[0.18em]"
        style={{ color: accent }}
      >
        {tag}
      </span>
      <span
        className={`flex-1 min-w-0 truncate font-mono text-[11.5px] text-[var(--cl-ink-2)] ${
          italic ? 'italic' : ''
        }`}
      >
        {primary}
        {secondary && <span className="text-[var(--cl-ink-4)]"> · {secondary}</span>}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-[var(--cl-ink-4)]">›</span>
    </div>
  );
}

// ── Card shell (position + surface + hover/active ring) ─────────────────────────

const CARD_SHADOW =
  'inset 0 1px 0 oklch(1 0 0 / 0.55), 0 1px 2px oklch(0 0 0 / 0.04), 0 18px 40px -30px oklch(0.2 0.03 60 / 0.5)';
const ACTIVE_SHADOW =
  '0 0 0 3px color-mix(in oklch, var(--cl-accent-soft) 60%, transparent), 0 18px 40px -30px oklch(0.2 0.03 60 / 0.5)';

function BlockShell({
  block,
  active,
  onHover,
  children,
  onClick,
  tone = 'card',
}: {
  block: PositionedBlock;
  active: boolean;
  onHover: (id: string | null) => void;
  children: React.ReactNode;
  onClick?: () => void;
  tone?: 'card' | 'muted';
}) {
  const border = active ? 'var(--cl-accent)' : 'var(--cl-line)';
  const background = tone === 'muted' ? 'var(--cl-paper-2)' : 'var(--cl-paper)';
  return (
    <div
      data-block={block.id}
      className="absolute overflow-hidden transition-shadow"
      style={{
        left: block.x,
        top: block.y,
        width: block.w,
        height: block.h,
        borderRadius: 16,
        border: `1px solid ${border}`,
        background,
        boxShadow: active ? ACTIVE_SHADOW : CARD_SHADOW,
        cursor: onClick ? 'pointer' : 'default',
      }}
      onMouseEnter={() => onHover(block.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

// ── The block ──────────────────────────────────────────────────────────────────

export function CanvasBlock({
  block,
  active,
  selectedStep,
  onSelectStep,
  onSelectBlock,
  onHover,
}: {
  block: PositionedBlock;
  active: boolean;
  selectedStep: string | null;
  onSelectStep: (id: string) => void;
  onSelectBlock: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  // ── Agent: monogram · title · dot / model / → output ──
  if (block.kind === 'agent' && block.step) {
    const step = block.step;
    return (
      <BlockShell
        block={block}
        active={active}
        onHover={onHover}
        onClick={() => onSelectStep(step.id)}
      >
        <div className="flex flex-col h-full px-[18px] py-4">
          <div className="flex items-center gap-[11px]">
            <Monogram ch={monogramChar(step)} />
            <div className="flex-1 min-w-0 truncate text-[17px] font-semibold tracking-[-0.01em] text-[var(--cl-ink)]">
              <CardTitle step={step} />
            </div>
            <ModelDot model={step.model} />
          </div>
          <div className="mt-3.5 font-mono text-[13px] text-[var(--cl-ink-3)]">
            {modelLine(step)}
          </div>
          <div className="mt-auto">
            {/* No schema pill here: a declared `schema:` always gets its own
                card, wired by a `schema` edge, so a pill would only repeat it. */}
            <OutLine token={block.produces[0] ?? step.id} />
          </div>
        </div>
      </BlockShell>
    );
  }

  // ── For-each: collapsed loop card (stages open in the inspector) ──
  if (block.kind === 'foreach' && block.pipeline) {
    const { itemsSource, resultVar, stages } = block.pipeline;
    const primary = stages.find(s => s.kind === 'agent' && s.step)?.step ?? null;
    return (
      <BlockShell
        block={block}
        active={active}
        onHover={onHover}
        onClick={() => onSelectBlock(block.id)}
      >
        <div className="flex flex-col h-full px-[18px] py-4">
          <div className="flex items-center gap-[11px]">
            <Monogram ch={primary ? monogramChar(primary) : '∀'} accent />
            <div className="flex-1 min-w-0 truncate text-[17px] font-semibold tracking-[-0.01em] text-[var(--cl-ink)]">
              {primary ? <CardTitle step={primary} /> : 'for each item'}
            </div>
            {primary && <ModelDot model={primary.model} />}
          </div>
          <div
            className="mt-3 inline-flex items-center self-start max-w-full truncate font-mono text-[9.5px] uppercase tracking-[0.14em] rounded-md px-2 py-[3px]"
            style={{
              color: 'var(--cl-accent-ink)',
              background: 'var(--cl-accent-soft)',
              border: '1px solid color-mix(in oklch, var(--cl-accent) 30%, transparent)',
            }}
            title={`for each item in ${itemsSource}`}
          >
            for each · {itemsSource}
          </div>
          {primary && (
            <div className="mt-2 font-mono text-[12.5px] text-[var(--cl-ink-3)]">
              {modelLine(primary)}
            </div>
          )}
          <div className="mt-auto">
            <OutLine token={resultVar ?? 'items'} />
          </div>
        </div>
      </BlockShell>
    );
  }

  // ── Parallel: a compact container with clean member rows ──
  if (block.kind === 'parallel' && block.members) {
    return (
      <BlockShell block={block} active={active} onHover={onHover} tone="muted">
        <div className="flex items-center gap-2 px-[18px] pt-3.5 pb-2.5">
          <Badge>in parallel</Badge>
          <span className="font-mono text-[11px] text-[var(--cl-ink-4)]">
            {block.members.length} agents at once
          </span>
        </div>
        <div
          className="bg-[var(--cl-paper)]"
          style={{ borderTop: '1px solid var(--cl-line-soft)' }}
        >
          {block.members.map((m, i) => (
            <button
              key={m.step.id}
              type="button"
              onClick={() => onSelectStep(m.step.id)}
              className="w-full text-left flex items-center gap-[11px] px-[18px] py-2.5 transition-colors"
              style={{
                borderTop: i > 0 ? '1px solid var(--cl-line-soft)' : undefined,
                background:
                  selectedStep === m.step.id
                    ? 'color-mix(in oklch, var(--cl-accent-soft) 55%, transparent)'
                    : undefined,
              }}
            >
              <Monogram ch={monogramChar(m.step)} />
              <span className="flex-1 min-w-0 truncate text-[15px] font-semibold text-[var(--cl-ink)]">
                <CardTitle step={m.step} />
              </span>
              <ModelDot model={m.step.model} />
            </button>
          ))}
        </div>
      </BlockShell>
    );
  }

  // ── Guard: annotation row — the condition it tests, and what it returns ──
  if (block.kind === 'guard') {
    const ret = guardReturnValue(block.source ?? '');
    return (
      <AnnotationRow
        block={block}
        active={active}
        onHover={onHover}
        onClick={() => onSelectBlock(block.id)}
        tag="guard"
        warn
        primary={describeCode(block.source ?? '').label}
        secondary={ret ? `returns ${ret}` : 'early return'}
        title={block.source}
      />
    );
  }

  // ── Output: a floating glass pill anchored at the block position ──
  if (block.kind === 'output') {
    // The pill NAMES what the return composes; those producers draw no edge into
    // it (graph.ts), so the information lives here instead of in four lines
    // crossing the whole canvas.
    const outText =
      (block.returnTokens ?? []).join(', ') ||
      (block.label ?? '').replace(/^returns\s*/, '') ||
      (block.nodeRef ? 'return statement' : 'workflow result');
    return (
      <div
        data-block={block.id}
        className="absolute inline-flex items-center gap-2.5"
        style={{
          left: block.x,
          top: block.y,
          background: 'var(--cl-glass-bg-strong)',
          backdropFilter: 'blur(14px) saturate(1.6)',
          WebkitBackdropFilter: 'blur(14px) saturate(1.6)',
          border: `1px solid ${active ? 'var(--cl-accent)' : 'var(--cl-glass-border)'}`,
          borderRadius: 999,
          padding: '9px 16px',
          boxShadow:
            'inset 0 1px 0 var(--cl-glass-highlight), 0 6px 16px -11px oklch(0.2 0.03 60 / 0.5)',
          cursor: 'pointer',
        }}
        onMouseEnter={() => onHover(block.id)}
        onMouseLeave={() => onHover(null)}
        onClick={() => onSelectBlock(block.id)}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--cl-ink-4)]">
          Output
        </span>
        <span style={{ color: 'var(--cl-line)', fontSize: 11 }}>·</span>
        <span
          className="max-w-[220px] truncate font-mono text-[12.5px]"
          style={{ color: 'var(--cl-accent-ink)' }}
          title={outText}
        >
          {outText}
        </span>
      </div>
    );
  }

  // ── Schema: a declared structured output, wired to the agents that ask for it.
  // ONE card whatever the script does — a literal on the call, a shared const,
  // or a name we can't resolve. The provenance only changes where the definition
  // is read from (graph.ts), never how it reads on the Canvas.
  if (block.kind === 'schema') {
    const model = block.schemaModel;
    const fields = model?.children ?? [];
    const summary = model
      ? `${model.type}${model.type === 'object' ? ` · ${schemaFieldCount(model)} fields` : ''}`
      : 'structured output';
    return (
      <BlockShell
        block={block}
        active={active}
        onHover={onHover}
        tone="muted"
        onClick={() => onSelectBlock(block.id)}
      >
        <div className="flex flex-col h-full px-[18px] py-4">
          <div className="flex items-center gap-[11px]">
            <span
              className="grid place-items-center shrink-0 font-mono font-semibold text-[13px]"
              style={{
                width: 27,
                height: 27,
                borderRadius: 7,
                color: 'var(--cl-accent-ink)',
                background: 'var(--cl-accent-soft)',
                border: '1px solid color-mix(in oklch, var(--cl-accent) 30%, transparent)',
              }}
            >
              {'{}'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--cl-accent-ink)]">
                schema
              </div>
              <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--cl-ink)]">
                {block.label || 'schema'}
              </div>
            </div>
          </div>
          <div className="mt-3 font-mono text-[12.5px] text-[var(--cl-ink-3)]">{summary}</div>
          {fields.length > 0 && (
            <div className="mt-auto flex items-center gap-1 flex-nowrap overflow-hidden">
              {fields.slice(0, 4).map(f => (
                <span
                  key={f.name}
                  className="shrink-0 font-mono text-[10px] rounded px-1.5 py-[2px]"
                  style={{
                    color: 'var(--cl-ink-3)',
                    background: 'var(--cl-paper)',
                    border: '1px solid var(--cl-line)',
                  }}
                >
                  {f.name}
                </span>
              ))}
              {fields.length > 4 && (
                <span className="shrink-0 font-mono text-[10px] text-[var(--cl-ink-4)] px-1">
                  +{fields.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      </BlockShell>
    );
  }

  // ── Setup: the binding it declares, with the value as the quiet half ──
  if (block.kind === 'setup') {
    const excerpt = describeCode(block.source ?? '').label;
    const defines = block.produces.length > 0 ? `defines ${block.produces.join(', ')}` : excerpt;
    return (
      <AnnotationRow
        block={block}
        active={active}
        onHover={onHover}
        onClick={() => onSelectBlock(block.id)}
        tag="setup"
        primary={defines}
        secondary={block.produces.length > 0 ? excerpt : undefined}
        title={block.source}
      />
    );
  }

  // ── Log / progress note ──
  if (block.kind === 'log') {
    return (
      <AnnotationRow
        block={block}
        active={active}
        onHover={onHover}
        onClick={() => onSelectBlock(block.id)}
        tag="note"
        italic
        primary={block.message || 'progress note'}
        title={block.message}
      />
    );
  }

  // ── Verbatim code ──
  return (
    <AnnotationRow
      block={block}
      active={active}
      onHover={onHover}
      onClick={() => onSelectBlock(block.id)}
      tag="code"
      primary={describeCode(block.source ?? '').label}
      title={block.source}
    />
  );
}
