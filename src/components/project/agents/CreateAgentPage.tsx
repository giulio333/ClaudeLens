import { useState } from 'react'
import { useCreateAgent, AgentInput } from '../../../hooks/useIPC'
import Markdown from '../../Markdown'
import { TopBar } from '../shared/TopBar'
import {
  NAME_MAX, DESC_MAX, openDocs, validateName, useCreateFormKeys,
  ModelPicker, ToolsInput, FieldHint, CharCounter,
} from '../shared/CreateFormKit'
import { projectDisplayName } from '../shared/projectName'

const DOCS_URL = 'https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields'

export function CreateAgentPage({ project, onBack, onSaved }: {
  project?: { hash: string; realPath: string }
  onBack: () => void
  onSaved: () => void
}) {
  const projectName = project ? projectDisplayName(project.realPath) : undefined
  const [form, setForm] = useState<{
    name: string; content: string; description: string
    model: string; permissionMode: string; isolation: string; memory: string
    effort: string; color: string; maxTurns: string
    allowedTools: string[]; disallowedTools: string[]
    skillsRaw: string; mcpServersRaw: string
  }>({
    name: '', content: '', description: '',
    model: '', permissionMode: '', isolation: '', memory: '',
    effort: '', color: '', maxTurns: '',
    allowedTools: [], disallowedTools: [],
    skillsRaw: '', mcpServersRaw: '',
  })
  const [contentTab, setContentTab] = useState<'edit' | 'preview'>('edit')
  const [error, setError] = useState<string | null>(null)
  const createAgent = useCreateAgent()

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  // --- live validation ---
  const nameTrim = form.name.trim()
  const nameError = validateName(form.name)
  const canSubmit = nameTrim.length > 0 && !nameError && form.description.trim().length > 0 && form.content.trim().length > 0

  async function submit() {
    if (!canSubmit) {
      setError(nameError ?? (!nameTrim ? 'Name is required' : !form.description.trim() ? 'Description is required' : 'Content is required'))
      return
    }
    const splitList = (raw: string) => raw.split(',').map(s => s.trim()).filter(Boolean)
    const input: AgentInput = {
      name: nameTrim,
      content: form.content.trim(),
      description: form.description.trim(),
      ...(form.model ? { model: form.model } : {}),
      ...(form.allowedTools.length ? { allowedTools: form.allowedTools } : {}),
      ...(form.disallowedTools.length ? { disallowedTools: form.disallowedTools } : {}),
      ...(form.permissionMode ? { permissionMode: form.permissionMode } : {}),
      ...(form.maxTurns ? { maxTurns: Number(form.maxTurns) } : {}),
      ...(form.isolation ? { isolation: form.isolation } : {}),
      ...(form.memory ? { memory: form.memory } : {}),
      ...(form.skillsRaw ? { skills: splitList(form.skillsRaw) } : {}),
      ...(form.mcpServersRaw ? { mcpServers: splitList(form.mcpServersRaw) } : {}),
      ...(form.effort ? { effort: form.effort } : {}),
      ...(form.color ? { color: form.color } : {}),
    }
    try {
      await createAgent.mutateAsync({ input, projectPath: project?.realPath })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await submit()
  }

  useCreateFormKeys({ canSubmit, isLoading: createAgent.isPending, onSubmit: submit, onCancel: onBack })

  const labelCls = "flex items-center font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--cl-ink-3)] mb-1.5"
  const inputCls = "w-full rounded-none border border-[var(--cl-line)] bg-[var(--cl-paper)] px-3 py-2 text-[13px] text-[var(--cl-ink)] placeholder:text-[var(--cl-ink-4)] outline-none focus:border-[var(--cl-ink)] transition-colors"

  const crumb = project ? `Project · Agents · ${projectName} · New` : 'Global · Agents · New'

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} crumbs={[{ label: crumb }]} />

      <div className="flex-1 overflow-y-auto">
        <section className="cl-hero">
          <div className="cl-eyebrow">
            <span className="pip" style={{ background: 'var(--cl-violet)' }} />
            <span>{project ? `New · Project Agent · ${projectName}` : 'New · Global Agent'}</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Agent</span>
            <span className="glyph" style={{ color: 'var(--cl-violet)' }}>.</span>
          </h1>
          <div className="cl-h-meta">
            <span>create a new subagent</span>
            <span className="sep">·</span>
            <span className="font-mono" style={{ fontSize: 12 }}>
              {project ? `${project.realPath}/.claude/agents/` : '~/.claude/agents/'}
            </span>
            <button
              type="button"
              onClick={() => openDocs(DOCS_URL)}
              className="cl-docs-link ml-auto inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.16em] border px-3 py-1.5 transition-colors"
              style={{ fontSize: 10, '--docs-accent': 'var(--cl-violet)' } as React.CSSProperties}
            >
              Frontmatter Docs ↗
            </button>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="cl-section" style={{ paddingTop: 24, paddingBottom: 80, maxWidth: 1180 }}>
          <div className="grid items-start gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="space-y-5">
              <div>
                <label className={labelCls}>
                  <span>Name</span> <span className="text-[var(--cl-violet)] ml-1">*</span>
                  <FieldHint text="Unique identifier using lowercase letters and hyphens. Hooks receive this value as agent_type. The filename does not have to match. E.g.: code-reviewer" />
                  <CharCounter n={form.name.length} max={NAME_MAX} accentVar="--cl-violet" />
                </label>
                <input
                  className={inputCls + (nameError ? ' !border-[var(--cl-danger)]' : '')}
                  placeholder="code-reviewer"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                />
                {nameError && <p className="mt-1 font-mono text-[10px] text-[var(--cl-danger)]">{nameError}</p>}
              </div>
              <div>
                <label className={labelCls}>
                  <span>Description</span> <span className="text-[var(--cl-violet)] ml-1">*</span>
                  <FieldHint text="When Claude should delegate to this subagent. Be specific about the use case." />
                  <CharCounter n={form.description.length} max={DESC_MAX} accentVar="--cl-violet" />
                </label>
                <input className={inputCls} placeholder="Reviews code for quality and security" value={form.description} onChange={e => set('description', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>
                  <span>Content · System Prompt</span> <span className="text-[var(--cl-violet)] ml-1">*</span>
                  <FieldHint text="The agent's system prompt: instructions on how it should behave and what it should do." />
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
                    className={inputCls + ' min-h-[460px] resize-y font-mono text-[12px] leading-relaxed'}
                    placeholder="Write the agent instructions in markdown…"
                    value={form.content}
                    onChange={e => set('content', e.target.value)}
                  />
                ) : (
                  <div className="w-full min-h-[460px] border border-[var(--cl-line)] bg-[var(--cl-paper)] px-4 py-3 overflow-y-auto">
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
                    <span>Model</span>
                    <FieldHint text="Model alias (sonnet, opus, haiku, opusplan…) or a full model ID. Defaults to inherit from the parent session." />
                  </label>
                  <ModelPicker value={form.model} onChange={v => set('model', v)} accentVar="--cl-violet" placeholder="claude-haiku-4-5-20251001" />
                </div>
                <div>
                  <label className={labelCls}>
                    <span>Allowed Tools</span>
                    <FieldHint text="Tools the subagent can use. Inherits all tools if omitted. To preload Skills, use the Skills field rather than listing Skill here." />
                  </label>
                  <ToolsInput value={form.allowedTools} onChange={v => set('allowedTools', v)} placeholder="Read, Grep, Bash" accent="violet" />
                </div>
                <div>
                  <label className={labelCls}>
                    <span>Disallowed Tools</span>
                    <FieldHint text="Tools to deny. Removed from the inherited or specified list." />
                  </label>
                  <ToolsInput value={form.disallowedTools} onChange={v => set('disallowedTools', v)} placeholder="Write, Edit" accent="violet" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>
                      <span>Permission Mode</span>
                      <FieldHint text="Permission mode: default, acceptEdits, auto, dontAsk, bypassPermissions, or plan. Ignored for plugin subagents." />
                    </label>
                    <input className={inputCls} placeholder="default" value={form.permissionMode} onChange={e => set('permissionMode', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>
                      <span>Max Turns</span>
                      <FieldHint text="Maximum number of agentic turns before the subagent stops." />
                    </label>
                    <input className={inputCls} type="number" placeholder="10" value={form.maxTurns} onChange={e => set('maxTurns', e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>
                      <span>Isolation</span>
                      <FieldHint text="Set to worktree to run the subagent in a temporary git worktree with an isolated copy of the repository. Auto-cleaned if no changes are made." />
                    </label>
                    <input className={inputCls} placeholder="worktree" value={form.isolation} onChange={e => set('isolation', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>
                      <span>Memory</span>
                      <FieldHint text="Persistent memory scope: user, project, or local. Enables cross-session learning." />
                    </label>
                    <input className={inputCls} placeholder="user | project | local" value={form.memory} onChange={e => set('memory', e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>
                      <span>Effort</span>
                      <FieldHint text="Effort level when this subagent is active. Overrides the session effort level. Options: low, medium, high, xhigh, max (availability depends on the model). Defaults to inherit." />
                    </label>
                    <input className={inputCls} placeholder="high" value={form.effort} onChange={e => set('effort', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>
                      <span>Color</span>
                      <FieldHint text="Display color for the subagent in the task list and transcript: red, blue, green, yellow, purple, orange, pink, or cyan." />
                    </label>
                    <input className={inputCls} placeholder="purple" value={form.color} onChange={e => set('color', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>
                    <span>Skills</span>
                    <FieldHint text="Skills to preload into the subagent's context at startup, comma-separated. The full skill content is injected, not just the description. Subagents can still invoke unlisted skills via the Skill tool." />
                  </label>
                  <input className={inputCls} placeholder="commit-helper, test-runner" value={form.skillsRaw} onChange={e => set('skillsRaw', e.target.value)} />
                </div>
                <div>
                  <label className={labelCls}>
                    <span>MCP Servers</span>
                    <FieldHint text="MCP servers available to this subagent, comma-separated. Each entry references an already-configured server (e.g. slack). Ignored for plugin subagents." />
                  </label>
                  <input className={inputCls} placeholder="filesystem, github" value={form.mcpServersRaw} onChange={e => set('mcpServersRaw', e.target.value)} />
                </div>
              </div>
            </aside>
          </div>{/* end grid */}

          {error && <p className="font-mono text-[11px] text-[var(--cl-danger)] border border-[var(--cl-danger)] bg-[var(--cl-danger-soft)] px-3 py-2">{error}</p>}

          <div className="pt-4 mt-4 border-t border-[var(--cl-line-soft)] flex items-center justify-end gap-3">
            <span className="mr-auto font-mono text-[10px] text-[var(--cl-ink-4)]">⌘↵ to save · esc to cancel</span>
            <button type="button" onClick={onBack} className="cl-btn">Cancel</button>
            <button
              type="submit"
              disabled={!canSubmit || createAgent.isPending}
              className="cl-btn cl-btn--primary"
              style={{ opacity: (!canSubmit || createAgent.isPending) ? 0.4 : 1, cursor: (!canSubmit || createAgent.isPending) ? 'not-allowed' : 'pointer' }}
            >
              {createAgent.isPending ? 'Saving…' : 'Create Agent ↗'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
