import { useState, useRef, useEffect, useMemo } from 'react'
import { useCreateSkill, SkillInput } from '../../../hooks/useIPC'
import Markdown from '../../Markdown'

const MODEL_PRESETS = ['default', 'best', 'sonnet', 'opus', 'haiku', 'sonnet[1m]', 'opus[1m]', 'opusplan'] as const

// Curated list of common Claude Code tools for the allowed-tools autocomplete.
const KNOWN_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'Task', 'TodoWrite', 'NotebookEdit',
] as const

const NAME_MAX = 64
const DESC_MAX = 250
const NAME_RE = /^[a-z0-9-]+$/

const DOCS_URL = 'https://code.claude.com/docs/en/skills#frontmatter-reference'
function openDocs() {
  window.open(DOCS_URL, '_blank', 'noopener')
}

function ModelPicker({ value, onChange, accentVar }: { value: string; onChange: (v: string) => void; accentVar: string }) {
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
          placeholder="claude-sonnet-4-6"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )}
    </div>
  )
}

function ToolsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
          <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[11px] bg-[var(--cl-accent-soft)] text-[var(--cl-accent-ink)] border border-transparent">
            {t}
            <button type="button" onClick={() => removeAt(i)} className="opacity-60 hover:opacity-100 leading-none">×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="flex-1 min-w-[100px] bg-transparent px-1 py-0.5 text-[13px] font-mono text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none"
          placeholder={value.length ? '' : 'Bash, Read, Write…'}
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
              className="block w-full text-left px-3 py-1.5 font-mono text-[12px] text-[var(--cl-ink-2)] hover:bg-[var(--cl-accent-soft)] hover:text-[var(--cl-accent-ink)] transition-colors"
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FieldHint({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center ml-1.5 cursor-default">
      <span className="text-[9px] font-mono text-[var(--cl-ink-4)] border border-[var(--cl-line)] w-3.5 h-3.5 flex items-center justify-center leading-none select-none">i</span>
      <span className="pointer-events-none absolute left-5 top-0 z-50 w-56 bg-[var(--cl-paper)] border border-[var(--cl-ink)] px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-[var(--cl-ink-2)] shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-normal normal-case tracking-normal">
        {text}
      </span>
    </span>
  )
}

function CharCounter({ n, max }: { n: number; max: number }) {
  const near = n > max * 0.85
  const over = n > max
  return (
    <span
      className="ml-auto font-mono text-[9px] tabular-nums"
      style={{ color: over ? 'var(--cl-danger)' : near ? 'var(--cl-accent)' : 'var(--cl-ink-4)' }}
    >
      {n}/{max}
    </span>
  )
}

function TopBar({ onBack, crumb }: { onBack: () => void; crumb: string }) {
  return (
    <div
      className="shrink-0 flex items-center gap-3 border-b border-[var(--cl-line)]"
      style={{
        WebkitAppRegion: 'drag',
        background: 'var(--cl-paper)',
        height: 52,
        padding: '0 28px 0 88px',
      } as React.CSSProperties}
    >
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 font-mono uppercase transition-colors hover:text-[var(--cl-accent)]"
        style={{ WebkitAppRegion: 'no-drag', fontSize: 11, letterSpacing: '0.18em', color: 'var(--cl-ink-3)', lineHeight: 1 } as React.CSSProperties}
      >
        <span>←</span>
        Back
      </button>
      <span style={{ color: 'var(--cl-ink-4)', fontSize: 11, lineHeight: 1 }}>/</span>
      <span
        className="font-mono uppercase truncate"
        style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--cl-ink-3)', lineHeight: 1 } as React.CSSProperties}
      >
        {crumb}
      </span>
    </div>
  )
}

export function CreateSkillPage({ project, onBack, onSaved }: {
  project?: { hash: string; realPath: string }
  onBack: () => void
  onSaved: () => void
}) {
  const projectName = project?.realPath.split('/').pop()
  const [form, setForm] = useState<{
    name: string; content: string; description: string; argumentHint: string
    model: string; agent: string; allowedTools: string[]; fork: boolean
  }>({
    name: '', content: '', description: '', argumentHint: '',
    model: '', agent: '', allowedTools: [], fork: false,
  })
  const [contentTab, setContentTab] = useState<'edit' | 'preview'>('edit')
  const [error, setError] = useState<string | null>(null)
  const createSkill = useCreateSkill()

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  // --- live validation ---
  const nameTrim = form.name.trim()
  const nameError = nameTrim.length === 0
    ? null
    : !NAME_RE.test(nameTrim)
      ? 'Lowercase letters, numbers and hyphens only'
      : nameTrim.length > NAME_MAX
        ? `Max ${NAME_MAX} characters`
        : null
  const canSubmit = nameTrim.length > 0 && !nameError && form.content.trim().length > 0

  async function submit() {
    if (!canSubmit) {
      setError(nameError ?? (!nameTrim ? 'Name is required' : 'Content is required'))
      return
    }
    const input: SkillInput = {
      name: nameTrim,
      content: form.content.trim(),
      ...(form.description ? { description: form.description } : {}),
      ...(form.argumentHint ? { argumentHint: form.argumentHint } : {}),
      ...(form.model ? { model: form.model } : {}),
      ...(form.fork ? { context: 'fork' } : {}),
      ...(form.fork && form.agent ? { agent: form.agent } : {}),
      ...(form.allowedTools.length ? { allowedTools: form.allowedTools } : {}),
    }
    try {
      await createSkill.mutateAsync({ input, projectPath: project?.realPath })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await submit()
  }

  // Cmd/Ctrl+Enter to save · Esc to cancel
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (canSubmit && !createSkill.isLoading) submit() }
      else if (e.key === 'Escape') { e.preventDefault(); onBack() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const labelCls = "flex items-center font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--cl-ink-3)] mb-1.5"
  const inputCls = "w-full rounded-none border border-[var(--cl-line)] bg-[var(--cl-paper)] px-3 py-2 text-[13px] text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none focus:border-[var(--cl-ink)] transition-colors"

  const crumb = project ? `Project · Skills · ${projectName} · New` : 'Global · Skills · New'

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumb={crumb} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>{project ? `New · Project Skill · ${projectName}` : 'New · Global Skill'}</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Skill</span>
            <span className="glyph">.</span>
          </h1>
          <div className="cl-h-meta">
            <span>create a new reusable behavior</span>
            <span className="sep">·</span>
            <span className="font-mono" style={{ fontSize: 12 }}>
              {project ? `${project.realPath}/.claude/skills/` : '~/.claude/skills/'}
            </span>
            <button
              type="button"
              onClick={openDocs}
              className="cl-docs-link ml-auto inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.16em] border px-3 py-1.5 transition-colors"
              style={{ fontSize: 10 }}
            >
              Frontmatter Docs ↗
            </button>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="cl-section" style={{ paddingTop: 24, paddingBottom: 80, maxWidth: 1120 }}>
          <div className="grid items-start gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_310px]">
            <div className="space-y-5">
            <div>
              <label className={labelCls}>
                <span>Name</span> <span className="text-[var(--cl-accent)] ml-1">*</span>
                <FieldHint text="Display name for the skill. If omitted, uses the directory name. Lowercase letters, numbers, and hyphens only (max 64 characters)." />
                <CharCounter n={form.name.length} max={NAME_MAX} />
              </label>
              <input
                className={inputCls + (nameError ? ' !border-[var(--cl-danger)]' : '')}
                placeholder="commit-helper"
                value={form.name}
                onChange={e => set('name', e.target.value)}
              />
              {nameError && <p className="mt-1 font-mono text-[10px] text-[var(--cl-danger)]">{nameError}</p>}
            </div>
            <div>
              <label className={labelCls}>
                <span>Description</span>
                <FieldHint text="What the skill does and when to use it. Claude uses this to decide when to apply the skill. Front-load the key use case — descriptions over 250 characters are truncated in the listing." />
                <CharCounter n={form.description.length} max={DESC_MAX} />
              </label>
              <input className={inputCls} placeholder="Generates structured commit messages" value={form.description} onChange={e => set('description', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>
                <span>Content · SKILL.md</span> <span className="text-[var(--cl-accent)] ml-1">*</span>
                <FieldHint text="The SKILL.md file body: instructions for Claude on what to do when the skill is invoked." />
                <span className="ml-auto flex gap-0">
                  {(['edit', 'preview'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setContentTab(t)}
                      className="font-mono text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 border transition-colors"
                      style={contentTab === t
                        ? { color: 'var(--cl-paper)', background: 'var(--cl-ink)', borderColor: 'var(--cl-ink)' }
                        : { color: 'var(--cl-ink-4)', background: 'transparent', borderColor: 'var(--cl-line)' }}
                    >
                      {t}
                    </button>
                  ))}
                </span>
              </label>
              {contentTab === 'edit' ? (
                <textarea
                  className={inputCls + ' min-h-[340px] resize-y font-mono text-[12px] leading-relaxed'}
                  placeholder="Write the skill instructions in markdown…"
                  value={form.content}
                  onChange={e => set('content', e.target.value)}
                />
              ) : (
                <div className="w-full min-h-[340px] border border-[var(--cl-line)] bg-[var(--cl-paper)] px-4 py-3 overflow-y-auto">
                  {form.content.trim()
                    ? <Markdown>{form.content}</Markdown>
                    : <p className="font-mono text-[12px] text-[var(--cl-ink-4)]">Nothing to preview yet.</p>}
                </div>
              )}
            </div>

            </div>{/* end main column */}

            <aside className="border-t border-[var(--cl-line-soft)] pt-5 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-10">
              <div className="font-mono text-[10px] uppercase tracking-[0.20em] text-[var(--cl-ink-4)] mb-4">Optional · Frontmatter</div>
              <div className="space-y-5">
                <div>
                  <label className={labelCls}>
                    <span>Argument Hint</span>
                    <FieldHint text="Hint shown during autocomplete to indicate expected arguments. E.g.: [issue-number] or [filename] [format]." />
                  </label>
                  <input className={inputCls} placeholder="<message>" value={form.argumentHint} onChange={e => set('argumentHint', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>
                    <span>Allowed Tools</span>
                    <FieldHint text="Tools Claude can use without asking permission when this skill is active. Type to search known tools, Enter to add a custom one." />
                  </label>
                  <ToolsInput value={form.allowedTools} onChange={v => set('allowedTools', v)} />
                </div>
                <div>
                  <label className={labelCls}>
                    <span>Model</span>
                    <FieldHint text="Model alias (sonnet, opus, haiku, opusplan…) or a full model ID. Leave unset to inherit from the session." />
                  </label>
                  <ModelPicker value={form.model} onChange={v => set('model', v)} accentVar="--cl-accent" />
                </div>
                <div>
                  <label className={labelCls}>
                    <span>Forked Context</span>
                    <FieldHint text="When enabled, the skill runs in a forked subagent context (frontmatter: context: fork)." />
                  </label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.fork}
                    onClick={() => set('fork', !form.fork)}
                    className="inline-flex items-center gap-2.5 group"
                  >
                    <span
                      className="relative w-9 h-5 border transition-colors"
                      style={{
                        background: form.fork ? 'var(--cl-accent)' : 'var(--cl-paper)',
                        borderColor: form.fork ? 'var(--cl-accent)' : 'var(--cl-line)',
                      }}
                    >
                      <span
                        className="absolute top-0.5 w-3.5 h-3.5 transition-all"
                        style={{
                          left: form.fork ? 18 : 2,
                          background: form.fork ? 'var(--cl-paper)' : 'var(--cl-ink-4)',
                        }}
                      />
                    </span>
                    <span className="font-mono text-[12px] text-[var(--cl-ink-2)]">{form.fork ? 'Run in forked subagent' : 'Run inline'}</span>
                  </button>
                </div>
                {form.fork && (
                  <div>
                    <label className={labelCls}>
                      <span>Agent</span>
                      <FieldHint text="Which subagent type to use for the forked context. Leave unset for the default." />
                    </label>
                    <input className={inputCls} placeholder="my-agent" value={form.agent} onChange={e => set('agent', e.target.value)} />
                  </div>
                )}
              </div>
            </aside>
          </div>{/* end grid */}

          {error && <p className="font-mono text-[11px] text-[var(--cl-danger)] border border-[var(--cl-danger)] bg-[var(--cl-danger-soft)] px-3 py-2">{error}</p>}

          <div className="pt-4 mt-4 border-t border-[var(--cl-line-soft)] flex items-center justify-end gap-3">
              <span className="mr-auto font-mono text-[10px] text-[var(--cl-ink-4)]">⌘↵ to save · esc to cancel</span>
              <button type="button" onClick={onBack} className="cl-btn">Cancel</button>
              <button
                type="submit"
                disabled={!canSubmit || createSkill.isLoading}
                className="cl-btn cl-btn--primary"
                style={{ opacity: (!canSubmit || createSkill.isLoading) ? 0.4 : 1, cursor: (!canSubmit || createSkill.isLoading) ? 'not-allowed' : 'pointer' }}
              >
                {createSkill.isLoading ? 'Saving…' : 'Create Skill ↗'}
              </button>
            </div>
        </form>
      </div>
    </div>
  )
}
