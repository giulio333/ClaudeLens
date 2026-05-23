import { useState, useRef, useEffect, useMemo } from 'react'

// Shared building blocks for the "create" pages (skills, agents).

export const MODEL_PRESETS = ['default', 'best', 'sonnet', 'opus', 'haiku', 'sonnet[1m]', 'opus[1m]', 'opusplan'] as const

// Curated list of common Claude Code tools for the tools autocomplete.
export const KNOWN_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'Task', 'TodoWrite', 'NotebookEdit',
] as const

export const NAME_MAX = 64
export const DESC_MAX = 250
export const NAME_RE = /^[a-z0-9-]+$/

type Accent = 'accent' | 'violet'

export function openDocs(url: string) {
  window.open(url, '_blank', 'noopener')
}

export function ModelPicker({ value, onChange, accentVar, placeholder }: {
  value: string
  onChange: (v: string) => void
  accentVar: string
  placeholder: string
}) {
  const isPreset = MODEL_PRESETS.includes(value as typeof MODEL_PRESETS[number])
  const [customMode, setCustomMode] = useState(!!value && !isPreset)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {MODEL_PRESETS.map(p => {
          const active = !customMode && value === p
          return (
            <button
              key={p}
              type="button"
              onClick={() => { setCustomMode(false); onChange(p) }}
              className={`px-2.5 py-1 font-mono text-[11px] border transition-colors ${active ? 'bg-[var(--cl-ink)] text-[var(--cl-paper)] border-[var(--cl-ink)]' : 'bg-[var(--cl-paper)] text-[var(--cl-ink-2)] border-[var(--cl-line)] hover:border-[var(--cl-ink-4)]'}`}
            >
              {p}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => { setCustomMode(true); if (isPreset) onChange('') }}
          className={`px-2.5 py-1 font-mono text-[11px] border transition-colors ${customMode ? '' : 'bg-[var(--cl-paper)] text-[var(--cl-ink-3)] border-dashed border-[var(--cl-line)] hover:border-[var(--cl-ink-4)] hover:text-[var(--cl-ink-2)]'}`}
          style={customMode ? { borderColor: `var(${accentVar})`, color: `var(${accentVar})` } : undefined}
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
  )
}

export function ToolsInput({ value, onChange, placeholder, accent }: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder: string
  accent: Accent
}) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Literal class strings (no dynamic interpolation) so Tailwind's JIT keeps them.
  const chipCls = accent === 'violet'
    ? 'bg-[var(--cl-violet-soft)] text-[var(--cl-violet-ink)]'
    : 'bg-[var(--cl-accent-soft)] text-[var(--cl-accent-ink)]'
  const optionCls = accent === 'violet'
    ? 'hover:bg-[var(--cl-violet-soft)] hover:text-[var(--cl-violet-ink)]'
    : 'hover:bg-[var(--cl-accent-soft)] hover:text-[var(--cl-accent-ink)]'

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase()
    return KNOWN_TOOLS.filter(t => !value.includes(t) && (!q || t.toLowerCase().includes(q)))
  }, [draft, value])

  function add(tool: string) {
    const t = tool.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setDraft('')
    inputRef.current?.focus()
  }
  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }

  return (
    <div className="relative">
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex flex-wrap items-center gap-1.5 w-full rounded-none border border-[var(--cl-line)] bg-[var(--cl-paper)] px-2 py-1.5 min-h-[40px] cursor-text focus-within:border-[var(--cl-ink)] transition-colors"
      >
        {value.map((t, i) => (
          <span key={t} className={`inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[11px] border border-transparent ${chipCls}`}>
            {t}
            <button type="button" onClick={() => removeAt(i)} className="opacity-60 hover:opacity-100 leading-none">×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="flex-1 min-w-[100px] bg-transparent px-1 py-0.5 text-[13px] font-mono text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none"
          placeholder={value.length ? '' : placeholder}
          value={draft}
          onChange={e => { setDraft(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (draft.trim()) add(draft) }
            else if (e.key === 'Backspace' && !draft && value.length) removeAt(value.length - 1)
          }}
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-[var(--cl-paper)] border border-[var(--cl-ink)] shadow-xl max-h-48 overflow-y-auto">
          {suggestions.map(t => (
            <button
              key={t}
              type="button"
              onMouseDown={e => { e.preventDefault(); add(t) }}
              className={`block w-full text-left px-3 py-1.5 font-mono text-[12px] text-[var(--cl-ink-2)] transition-colors ${optionCls}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function FieldHint({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center ml-1.5 cursor-default">
      <span className="text-[9px] font-mono text-[var(--cl-ink-4)] border border-[var(--cl-line)] w-3.5 h-3.5 flex items-center justify-center leading-none select-none">i</span>
      <span className="pointer-events-none absolute left-5 top-0 z-50 w-56 bg-[var(--cl-paper)] border border-[var(--cl-ink)] px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--cl-ink-2)] shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-normal normal-case tracking-normal">
        {text}
      </span>
    </span>
  )
}

export function CharCounter({ n, max, accentVar }: { n: number; max: number; accentVar: string }) {
  const near = n > max * 0.85
  const over = n > max
  return (
    <span
      className="ml-auto font-mono text-[9px] tabular-nums"
      style={{ color: over ? 'var(--cl-danger)' : near ? `var(${accentVar})` : 'var(--cl-ink-4)' }}
    >
      {n}/{max}
    </span>
  )
}

// Cmd/Ctrl+Enter to save · Esc to cancel
export function useCreateFormKeys(opts: { canSubmit: boolean; isLoading: boolean; onSubmit: () => void; onCancel: () => void }) {
  const { canSubmit, isLoading, onSubmit, onCancel } = opts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (canSubmit && !isLoading) onSubmit() }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}

export function validateName(raw: string): string | null {
  const nameTrim = raw.trim()
  if (nameTrim.length === 0) return null
  if (!NAME_RE.test(nameTrim)) return 'Lowercase letters, numbers and hyphens only'
  if (nameTrim.length > NAME_MAX) return `Max ${NAME_MAX} characters`
  return null
}
