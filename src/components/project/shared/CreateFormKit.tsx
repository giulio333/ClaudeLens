import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  KNOWN_TOOLS,
  MODEL_PRESETS,
  TOOL_DESCRIPTIONS,
  TOOL_DETAILS,
  type Accent,
} from './formKit';

// Shared component building blocks for the "create" pages (skills, agents).
// The constants, helpers and keybinding hook they build on live in ./formKit.

export function ModelPicker({
  value,
  onChange,
  accentVar,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  accentVar: string;
  placeholder: string;
}) {
  const isPreset = MODEL_PRESETS.includes(value as (typeof MODEL_PRESETS)[number]);
  const [customMode, setCustomMode] = useState(!!value && !isPreset);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {MODEL_PRESETS.map(p => {
          const active = !customMode && value === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => {
                setCustomMode(false);
                onChange(p);
              }}
              className={`px-2.5 py-1 font-mono text-[11px] border transition-colors ${active ? 'bg-[var(--cl-ink)] text-[var(--cl-paper)] border-[var(--cl-ink)]' : 'bg-[var(--cl-paper)] text-[var(--cl-ink-2)] border-[var(--cl-line)] hover:border-[var(--cl-ink-4)]'}`}
            >
              {p}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setCustomMode(true);
            if (isPreset) onChange('');
          }}
          className={`px-2.5 py-1 font-mono text-[11px] border transition-colors ${customMode ? '' : 'bg-[var(--cl-paper)] text-[var(--cl-ink-3)] border-dashed border-[var(--cl-line)] hover:border-[var(--cl-ink-4)] hover:text-[var(--cl-ink-2)]'}`}
          style={
            customMode
              ? { borderColor: `var(${accentVar})`, color: `var(${accentVar})` }
              : undefined
          }
        >
          Custom…
        </button>
      </div>
      {customMode && (
        <input
          autoFocus
          className="w-full rounded-none border border-[var(--cl-line)] bg-[var(--cl-paper)] px-3 py-2 text-[13px] font-mono text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none focus:border-[var(--cl-ink)] transition-colors"
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

export function ToolsInput({
  value,
  onChange,
  placeholder,
  accent,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  accent: Accent;
}) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const [hover, setHover] = useState<{ tool: string; rowTop: number } | null>(null);

  // The dropdown is portaled to <body> so it escapes ancestors that clip
  // (e.g. the edit card uses backdrop-filter, which clips descendants in
  // Chromium even with overflow: visible). Position is tracked from the box.
  const measure = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom, width: r.width });
  }, []);

  // Opening the dropdown measures the box up-front (in the event handler, so no
  // synchronous setState lands in an effect); the effect below only keeps it
  // anchored on scroll/resize while open. The portal renders solely when
  // `open && rect`, so a stale rect after close is never visible.
  const openMenu = () => {
    measure();
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  // Literal class strings (no dynamic interpolation) so Tailwind's JIT keeps them.
  const chipCls =
    accent === 'violet'
      ? 'bg-[var(--cl-violet-soft)] text-[var(--cl-violet-ink)]'
      : 'bg-[var(--cl-accent-soft)] text-[var(--cl-accent-ink)]';
  const optionCls =
    accent === 'violet'
      ? 'hover:bg-[var(--cl-violet-soft)] hover:text-[var(--cl-violet-ink)]'
      : 'hover:bg-[var(--cl-accent-soft)] hover:text-[var(--cl-accent-ink)]';

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return KNOWN_TOOLS.filter(t => !value.includes(t) && (!q || t.toLowerCase().includes(q)));
  }, [draft, value]);

  function add(tool: string) {
    const t = tool.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft('');
    inputRef.current?.focus();
  }
  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <div className="relative">
      <div
        ref={boxRef}
        onClick={() => inputRef.current?.focus()}
        className="flex flex-wrap items-center gap-1.5 w-full rounded-none border border-[var(--cl-line)] bg-[var(--cl-paper)] px-2 py-1.5 min-h-[40px] cursor-text focus-within:border-[var(--cl-ink)] transition-colors"
      >
        {value.map((t, i) => (
          <span
            key={t}
            className={`inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[11px] border border-transparent ${chipCls}`}
          >
            {t}
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="opacity-60 hover:opacity-100 leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="flex-1 min-w-[100px] bg-transparent px-1 py-0.5 text-[13px] font-mono text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none"
          placeholder={value.length ? '' : placeholder}
          value={draft}
          onChange={e => {
            setDraft(e.target.value);
            openMenu();
          }}
          onFocus={openMenu}
          onBlur={() =>
            setTimeout(() => {
              setOpen(false);
              setHover(null);
            }, 120)
          }
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              if (draft.trim()) add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) removeAt(value.length - 1);
          }}
        />
      </div>
      {open &&
        suggestions.length > 0 &&
        rect &&
        createPortal(
          <div
            className="fixed z-[100] bg-[var(--cl-paper)] border border-[var(--cl-ink)] shadow-xl max-h-48 overflow-y-auto"
            style={{ left: rect.left, top: rect.top + 4, width: rect.width }}
          >
            {suggestions.map(t => (
              <button
                key={t}
                type="button"
                onMouseDown={e => {
                  e.preventDefault();
                  add(t);
                }}
                onMouseEnter={e =>
                  setHover({ tool: t, rowTop: e.currentTarget.getBoundingClientRect().top })
                }
                onMouseLeave={() => setHover(h => (h?.tool === t ? null : h))}
                className={`block w-full text-left px-3 py-1.5 transition-colors ${optionCls}`}
              >
                <span className="block font-mono text-[12px] text-[var(--cl-ink-2)]">{t}</span>
                {TOOL_DESCRIPTIONS[t] && (
                  <span className="block text-[10.5px] leading-tight text-[var(--cl-ink-4)] mt-0.5">
                    {TOOL_DESCRIPTIONS[t]}
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body
        )}
      {open &&
        hover &&
        TOOL_DETAILS[hover.tool] &&
        rect &&
        createPortal(
          (() => {
            const W = 260;
            const rightX = rect.left + rect.width + 8;
            // Flip to the left of the dropdown if it would overflow the viewport.
            const left = rightX + W > window.innerWidth ? Math.max(8, rect.left - W - 8) : rightX;
            const detail = TOOL_DETAILS[hover.tool];
            return (
              <div
                className="fixed z-[101] bg-[var(--cl-paper)] border border-[var(--cl-ink)] shadow-xl px-3 py-2.5 pointer-events-none"
                style={{ left, top: hover.rowTop, width: W }}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-mono text-[12px] text-[var(--cl-ink)]">{hover.tool}</span>
                  <span
                    className="font-mono text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 border"
                    style={
                      detail.permission
                        ? {
                            color: 'var(--cl-accent-ink)',
                            background: 'var(--cl-accent-soft)',
                            borderColor: 'transparent',
                          }
                        : { color: 'var(--cl-ink-4)', borderColor: 'var(--cl-line)' }
                    }
                  >
                    {detail.permission ? 'asks permission' : 'no prompt'}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--cl-ink-3)]">{detail.full}</p>
              </div>
            );
          })(),
          document.body
        )}
    </div>
  );
}

export function FieldHint({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center ml-1.5 cursor-default">
      <span className="text-[9px] font-mono text-[var(--cl-ink-4)] border border-[var(--cl-line)] w-3.5 h-3.5 flex items-center justify-center leading-none select-none">
        i
      </span>
      <span className="pointer-events-none absolute left-5 top-0 z-50 w-56 bg-[var(--cl-paper)] border border-[var(--cl-ink)] px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--cl-ink-2)] shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-normal normal-case tracking-normal">
        {text}
      </span>
    </span>
  );
}

export function CharCounter({ n, max, accentVar }: { n: number; max: number; accentVar: string }) {
  const near = n > max * 0.85;
  const over = n > max;
  return (
    <span
      className="ml-auto font-mono text-[9px] tabular-nums"
      style={{ color: over ? 'var(--cl-danger)' : near ? `var(${accentVar})` : 'var(--cl-ink-4)' }}
    >
      {n}/{max}
    </span>
  );
}
