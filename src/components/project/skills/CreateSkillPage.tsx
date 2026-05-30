import { useState } from 'react'
import { useCreateSkill, SkillInput } from '../../../hooks/useIPC'
import Markdown from '../../Markdown'
import { TopBar } from '../shared/TopBar'
import {
  NAME_MAX, DESC_MAX, openDocs, validateName, useCreateFormKeys,
  ModelPicker, ToolsInput, FieldHint, CharCounter,
} from '../shared/CreateFormKit'

const DOCS_URL = 'https://code.claude.com/docs/en/skills#frontmatter-reference'

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
  const nameError = validateName(form.name)
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

  useCreateFormKeys({ canSubmit, isLoading: createSkill.isPending, onSubmit: submit, onCancel: onBack })

  const labelCls = "flex items-center font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--cl-ink-3)] mb-1.5"
  const inputCls = "w-full rounded-none border border-[var(--cl-line)] bg-[var(--cl-paper)] px-3 py-2 text-[13px] text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none focus:border-[var(--cl-ink)] transition-colors"

  const crumb = project ? `Project · Skills · ${projectName} · New` : 'Global · Skills · New'

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: crumb }]} />

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
              onClick={() => openDocs(DOCS_URL)}
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
                <CharCounter n={form.name.length} max={NAME_MAX} accentVar="--cl-accent" />
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
                <CharCounter n={form.description.length} max={DESC_MAX} accentVar="--cl-accent" />
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
                  <ToolsInput value={form.allowedTools} onChange={v => set('allowedTools', v)} placeholder="Bash, Read, Write…" accent="accent" />
                </div>
                <div>
                  <label className={labelCls}>
                    <span>Model</span>
                    <FieldHint text="Model alias (sonnet, opus, haiku, opusplan…) or a full model ID. Leave unset to inherit from the session." />
                  </label>
                  <ModelPicker value={form.model} onChange={v => set('model', v)} accentVar="--cl-accent" placeholder="claude-sonnet-4-6" />
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
                disabled={!canSubmit || createSkill.isPending}
                className="cl-btn cl-btn--primary"
                style={{ opacity: (!canSubmit || createSkill.isPending) ? 0.4 : 1, cursor: (!canSubmit || createSkill.isPending) ? 'not-allowed' : 'pointer' }}
              >
                {createSkill.isPending ? 'Saving…' : 'Create Skill ↗'}
              </button>
            </div>
        </form>
      </div>
    </div>
  )
}
