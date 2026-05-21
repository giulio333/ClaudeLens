import { useState } from 'react'
import { useCreateSkill, SkillInput } from '../../../hooks/useIPC'

const MODEL_PRESETS = ['default', 'best', 'sonnet', 'opus', 'haiku', 'sonnet[1m]', 'opus[1m]', 'opusplan'] as const

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
  const [form, setForm] = useState<Partial<SkillInput> & { name: string; content: string; allowedToolsRaw: string }>({
    name: '', content: '', allowedToolsRaw: '',
  })
  const [error, setError] = useState<string | null>(null)
  const createSkill = useCreateSkill()

  function set(key: string, value: unknown) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!form.content.trim()) { setError('Content is required'); return }
    const input: SkillInput = {
      name: form.name.trim(),
      content: form.content.trim(),
      ...(form.description ? { description: form.description } : {}),
      ...(form.argumentHint ? { argumentHint: form.argumentHint } : {}),
      ...(form.model ? { model: form.model } : {}),
      ...(form.context ? { context: form.context } : {}),
      ...(form.agent ? { agent: form.agent } : {}),
      ...(form.allowedToolsRaw ? { allowedTools: form.allowedToolsRaw.split(',').map(s => s.trim()).filter(Boolean) } : {}),
    }
    try {
      await createSkill.mutateAsync({ input, projectPath: project?.realPath })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

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
            <span className="sep">·</span>
            <a
              href="#"
              onClick={e => { e.preventDefault(); window.open('https://code.claude.com/docs/en/skills#frontmatter-reference', '_blank', 'noopener') }}
              className="font-mono uppercase tracking-[0.16em] hover:text-[var(--cl-accent)] transition-colors"
              style={{ fontSize: 10 }}
            >
              View Docs ↗
            </a>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="cl-section" style={{ paddingTop: 24, paddingBottom: 80, maxWidth: 720 }}>
          <div className="space-y-5">
            <div>
              <label className={labelCls}>
                <span>Name</span> <span className="text-[var(--cl-accent)] ml-1">*</span>
                <FieldHint text="Display name for the skill. If omitted, uses the directory name. Lowercase letters, numbers, and hyphens only (max 64 characters)." />
              </label>
              <input className={inputCls} placeholder="commit-helper" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>
                <span>Description</span>
                <FieldHint text="What the skill does and when to use it. Claude uses this to decide when to apply the skill. Front-load the key use case — descriptions over 250 characters are truncated in the listing." />
              </label>
              <input className={inputCls} placeholder="Generates structured commit messages" value={form.description ?? ''} onChange={e => set('description', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>
                <span>Content · SKILL.md</span> <span className="text-[var(--cl-accent)] ml-1">*</span>
                <FieldHint text="The SKILL.md file body: instructions for Claude on what to do when the skill is invoked." />
              </label>
              <textarea className={inputCls + ' min-h-[200px] resize-y font-mono text-[12px] leading-relaxed'} placeholder="Write the skill instructions in markdown…" value={form.content} onChange={e => set('content', e.target.value)} />
            </div>

            <div className="pt-3 mt-2 border-t border-[var(--cl-line-soft)]">
              <div className="font-mono text-[10px] uppercase tracking-[0.20em] text-[var(--cl-ink-4)] mb-4">Optional · Frontmatter</div>
              <div className="space-y-5">
                <div>
                  <label className={labelCls}>
                    <span>Argument Hint</span>
                    <FieldHint text="Hint shown during autocomplete to indicate expected arguments. E.g.: [issue-number] or [filename] [format]." />
                  </label>
                  <input className={inputCls} placeholder="<message>" value={form.argumentHint ?? ''} onChange={e => set('argumentHint', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>
                    <span>Allowed Tools</span>
                    <FieldHint text="Tools Claude can use without asking permission when this skill is active. Comma-separated." />
                  </label>
                  <input className={inputCls} placeholder="Bash, Read, Write" value={form.allowedToolsRaw} onChange={e => set('allowedToolsRaw', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>
                    <span>Model</span>
                    <FieldHint text="Model alias (sonnet, opus, haiku, opusplan…) or a full model ID. Leave unset to inherit from the session." />
                  </label>
                  <ModelPicker value={form.model ?? ''} onChange={v => set('model', v)} accentVar="--cl-accent" />
                </div>
                <div>
                  <label className={labelCls}>
                    <span>Agent</span>
                    <FieldHint text="Which subagent type to use when context: fork is set." />
                  </label>
                  <input className={inputCls} placeholder="my-agent" value={form.agent ?? ''} onChange={e => set('agent', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>
                    <span>Context</span>
                    <FieldHint text="Set to fork to run in a forked subagent context." />
                  </label>
                  <input className={inputCls} placeholder="project-files" value={form.context ?? ''} onChange={e => set('context', e.target.value)} />
                </div>
              </div>
            </div>

            {error && <p className="font-mono text-[11px] text-[var(--cl-danger)] border border-[var(--cl-danger)] bg-[var(--cl-danger-soft)] px-3 py-2">{error}</p>}

            <div className="pt-4 mt-4 border-t border-[var(--cl-line-soft)] flex justify-end gap-2">
              <button type="button" onClick={onBack} className="cl-btn">Cancel</button>
              <button
                type="submit"
                disabled={createSkill.isLoading}
                className="cl-btn cl-btn--primary"
                style={{ opacity: createSkill.isLoading ? 0.5 : 1 }}
              >
                {createSkill.isLoading ? 'Saving…' : 'Create Skill ↗'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
