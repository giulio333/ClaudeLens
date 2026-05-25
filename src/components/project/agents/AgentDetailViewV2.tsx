import { useEffect, useMemo, useRef, useState, CSSProperties } from 'react'
import { Agent } from '../../../hooks/useIPC'
import { TopBar } from '../shared/TopBar'
import Markdown from '../../Markdown'

type Project = { hash: string; realPath: string }

/* ── agent.color → hue/chroma mapping (used by the orb / pip / accents) ── */
const COLOR_MAP: Record<string, { h: number; c: number }> = {
  red:    { h: 25,  c: 0.18 },
  orange: { h: 40,  c: 0.16 },
  yellow: { h: 90,  c: 0.16 },
  green:  { h: 150, c: 0.16 },
  cyan:   { h: 200, c: 0.14 },
  blue:   { h: 250, c: 0.18 },
  purple: { h: 305, c: 0.18 },
  pink:   { h: 340, c: 0.16 },
}

function agentStyle(color?: string): CSSProperties {
  const m = COLOR_MAP[(color ?? 'green').toLowerCase()] ?? COLOR_MAP.green
  return { '--agent-h': String(m.h), '--agent-c': String(m.c) } as CSSProperties
}

function initialOf(name: string) {
  return name.trim()[0]?.toUpperCase() ?? '?'
}

/* ── catalogue of "Available options" shown in the V2 grid ── */
type OptionDef = {
  key: keyof Agent
  label: string
  blurb: string
  isArray?: boolean
  isBool?: boolean
  isNumber?: boolean
  enum?: string[]
}

const OPTION_DEFS: OptionDef[] = [
  { key: 'color',                 label: 'color',           blurb: 'Accent color for the agent identity: red · orange · yellow · green · cyan · blue · purple · pink.', enum: ['green', 'red', 'orange', 'yellow', 'cyan', 'blue', 'purple', 'pink'] },
  { key: 'model',                 label: 'model',           blurb: 'Model alias or full model ID. Omit to inherit from the current session.' },
  { key: 'allowedTools',          label: 'tools',           blurb: 'Tools the subagent can use. Inherits all if omitted.', isArray: true },
  { key: 'disallowedTools',       label: 'disallowedTools', blurb: 'Tools to deny, removed from the inherited list.', isArray: true },
  { key: 'permissionMode',        label: 'permissionMode',  blurb: 'default · acceptEdits · auto · dontAsk · bypassPermissions · plan', enum: ['default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'plan'] },
  { key: 'maxTurns',              label: 'maxTurns',        blurb: 'Maximum agentic turns before the subagent stops.', isNumber: true },
  { key: 'isolation',             label: 'isolation',       blurb: 'Set to worktree to run in an isolated git worktree.', enum: ['worktree'] },
  { key: 'memory',                label: 'memory',          blurb: 'Persistent memory scope: user · project · local.', enum: ['user', 'project', 'local'] },
  { key: 'skills',                label: 'skills',          blurb: 'Skills preloaded at startup, full content injected.', isArray: true },
  { key: 'mcpServers',            label: 'mcpServers',      blurb: 'MCP servers available to this subagent.', isArray: true },
  { key: 'effort',                label: 'effort',          blurb: 'Effort level: low · medium · high · xhigh · max.', enum: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { key: 'background',            label: 'background',      blurb: 'Always run this subagent as a background task.', isBool: true },
  { key: 'disableModelInvocation',label: 'disable_model_invocation', blurb: 'Hide this subagent from automatic invocation.', isBool: true },
]

function optionValueOf(agent: Agent, def: OptionDef): string | null {
  const v = agent[def.key]
  if (v == null || v === '') return null
  if (def.isBool) return v ? 'enabled' : null
  if (def.isArray) {
    const arr = v as unknown as string[]
    return arr.length ? arr.join(', ') : null
  }
  return String(v)
}

/* ── YAML serialization (mirrors electron/modules/agents-writer.ts) ── */
function serializeAgent(a: Agent, body: string, overrides: Partial<Agent> = {}): string {
  const merged: Agent = { ...a, ...overrides }
  const lines: string[] = ['---']
  lines.push(`name: ${merged.name}`)
  if (merged.description) lines.push(`description: ${merged.description}`)
  if (merged.model) lines.push(`model: ${merged.model}`)
  if (merged.allowedTools?.length) lines.push(`tools: [${merged.allowedTools.join(', ')}]`)
  if (merged.disallowedTools?.length) lines.push(`disallowedTools: [${merged.disallowedTools.join(', ')}]`)
  if (merged.permissionMode) lines.push(`permissionMode: ${merged.permissionMode}`)
  if (merged.maxTurns != null) lines.push(`maxTurns: ${merged.maxTurns}`)
  if (merged.background != null) lines.push(`background: ${merged.background}`)
  if (merged.isolation) lines.push(`isolation: ${merged.isolation}`)
  if (merged.memory) lines.push(`memory: ${merged.memory}`)
  if (merged.effort) lines.push(`effort: ${merged.effort}`)
  if (merged.color) lines.push(`color: ${merged.color}`)
  if (merged.skills?.length) lines.push(`skills: [${merged.skills.join(', ')}]`)
  if (merged.mcpServers?.length) lines.push(`mcpServers: [${merged.mcpServers.join(', ')}]`)
  if (merged.disableModelInvocation != null) lines.push(`disable_model_invocation: ${merged.disableModelInvocation}`)
  lines.push('---', '', body)
  return lines.join('\n')
}

/* ── EditState option helpers ── */
type OptionValue = string | string[] | number | boolean | null

function readOption(agent: Agent, def: OptionDef): OptionValue {
  const v = agent[def.key]
  if (v == null) return null
  if (def.isArray) return Array.isArray(v) ? [...(v as string[])] : null
  if (def.isBool) return Boolean(v)
  if (def.isNumber) return typeof v === 'number' ? v : null
  return typeof v === 'string' ? v : null
}

function defaultFor(def: OptionDef): OptionValue {
  if (def.isArray) return []
  if (def.isBool) return true
  if (def.isNumber) return 0
  if (def.enum?.length) return def.enum[0]
  return ''
}

function isOptionSet(v: OptionValue): boolean {
  return v !== null
}

/* ══════════════════════════ ICONS ══════════════════════════ */
const ExportIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 1.5v8" /><path d="M4.5 6 8 9.5 11.5 6" /><path d="M2 11v2.5h12V11" />
  </svg>
)
const PlayIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M4 3l9 5-9 5z" />
  </svg>
)

/* ════════════════════════════════════════════════════════════════════
   VIEW V2 — Manifesto strip
   ════════════════════════════════════════════════════════════════════ */
function AgentViewManifesto({ agent }: { agent: Agent }) {
  const body = agent.content || ''
  const charCount = body.length
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0
  const propertyRows = OPTION_DEFS.map(def => ({ def, value: optionValueOf(agent, def) }))
  const setProperties = propertyRows.filter(row => row.value)
  const unsetProperties = propertyRows.filter(row => !row.value)

  return (
    <div className="cl-agent-v2" style={agentStyle(agent.color)}>
      <div className="cl-agent-v2-strip">
        <span className="scope-pill"><span className="d" /> {agent.scope === 'global' ? 'Global' : 'Project'}</span>
        <span className="path" title={agent.path}>{agent.path}</span>
        <span className="id-tag">
          <span className="orb-tiny">{initialOf(agent.name)}</span>
          {agent.name} · agent
        </span>
      </div>

      <section className="cl-agent-v2-hero">
        <div>
          <div className="ey">
            <span className="pip" />
            <span>Agent · markdown manifest</span>
          </div>
          <h1>
            {agent.name}<span className="ext">.md</span>
          </h1>
          {agent.description && <div className="desc">{agent.description}</div>}
        </div>
        <div className="cl-agent-v2-lens" aria-hidden="true">
          <span className="orb-big" />
          <span className="orb-sm" />
          <span className="orb-mid" />
        </div>
      </section>

      <section className="cl-agent-v2-tape">
        <div className="cell">
          <div className="l">Scope</div>
          <div className="v">{agent.scope === 'global' ? 'Global' : 'Project'}</div>
        </div>
        <div className="cell">
          <div className="l">Model</div>
          <div className="v mono">{agent.model || 'inherit'}</div>
        </div>
        <div className="cell">
          <div className="l">Color</div>
          <div className="v agent-color">{agent.color || 'default'}</div>
        </div>
        <div className="cell">
          <div className="l">Status</div>
          {agent.missingRequired.length > 0 || agent.filenameHasSpaces ? (
            <div className="v status is-warn"><span className="d" /> Invalid</div>
          ) : (
            <div className="v status"><span className="d" /> Enabled</div>
          )}
        </div>
      </section>

      <section className="cl-agent-v2-body">
        <div className="lab">System prompt · markdown body · {charCount} chars · {wordCount} words</div>
        <div className="prose">
          {body ? <Markdown>{body}</Markdown> : (
            <p style={{ color: 'var(--cl-ink-3)', fontStyle: 'italic' }}>No prompt body.</p>
          )}
        </div>

        <div className="cl-agent-v2-opts">
          <h3><span>Properties</span><b>{setProperties.length} / {OPTION_DEFS.length} set</b></h3>

          <div className="cl-agent-v2-prop-group is-set">
            <div className="group-head"><span>Set properties</span><b>{setProperties.length}</b></div>
            {setProperties.length > 0 ? (
              <div className="grid">
                {setProperties.map(({ def, value }) => (
                  <div key={def.label} className="tile set">
                    <span className="nm"><span className="dot" />{def.label}<span className="state">set</span></span>
                    <div className="vl">{value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">No optional properties set.</div>
            )}
          </div>

          {unsetProperties.length > 0 && (
            <div className="cl-agent-v2-prop-group is-unset">
              <div className="group-head"><span>Unset properties</span><b>{unsetProperties.length}</b></div>
              <div className="grid compact">
                {unsetProperties.map(({ def }) => (
                  <div key={def.label} className="tile unset">
                    <span className="nm"><span className="dot" />{def.label}<span className="state">default</span></span>
                    <div className="vl">{def.blurb}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   EDIT V2 — Forms workbench
   ════════════════════════════════════════════════════════════════════ */
type EditState = {
  body: string
  description: string
  options: Record<string, OptionValue>
}

function OptionEditor({
  def,
  value,
  onChange,
}: {
  def: OptionDef
  value: OptionValue
  onChange: (v: OptionValue) => void
}) {
  if (def.isBool) {
    const on = value === true
    return (
      <button
        type="button"
        className={'cl-opt-toggle' + (on ? ' on' : '')}
        onClick={() => onChange(!on)}
      >
        <span className="cl-opt-toggle-knob" />
        <span className="cl-opt-toggle-label">{on ? 'enabled' : 'disabled'}</span>
      </button>
    )
  }
  if (def.isArray) {
    const arr = Array.isArray(value) ? value : []
    return (
      <input
        type="text"
        className="cl-opt-input"
        value={arr.join(', ')}
        placeholder="comma, separated, values"
        onChange={e =>
          onChange(
            e.target.value
              .split(',')
              .map(s => s.trim())
              .filter(Boolean)
          )
        }
      />
    )
  }
  if (def.enum?.length) {
    return (
      <select
        className="cl-opt-input"
        value={typeof value === 'string' ? value : ''}
        onChange={e => onChange(e.target.value)}
      >
        {def.enum.map(o => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    )
  }
  if (def.isNumber) {
    return (
      <input
        type="number"
        className="cl-opt-input"
        value={typeof value === 'number' ? value : ''}
        onChange={e => {
          const n = e.target.value === '' ? 0 : Number(e.target.value)
          onChange(Number.isFinite(n) ? n : 0)
        }}
      />
    )
  }
  return (
    <input
      type="text"
      className="cl-opt-input"
      value={typeof value === 'string' ? value : ''}
      onChange={e => onChange(e.target.value)}
    />
  )
}

function AgentEditWorkbench({
  agent,
  state,
  onChange,
}: {
  agent: Agent
  state: EditState
  onChange: (next: EditState) => void
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [pos, setPos] = useState({ line: 1, col: 1 })
  function updatePos() {
    const ta = taRef.current
    if (!ta) return
    const before = ta.value.slice(0, ta.selectionStart)
    const lines = before.split('\n')
    setPos({ line: lines.length, col: lines[lines.length - 1].length + 1 })
  }

  function setOption(def: OptionDef, value: OptionValue) {
    onChange({ ...state, options: { ...state.options, [def.key]: value } })
  }

  const body = state.body
  const charCount = body.length
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0
  const paragraphs = body.split(/\n{2,}/).filter(Boolean).length
  const setDefs = OPTION_DEFS.filter(d => isOptionSet(state.options[d.key]))
  const unsetDefs = OPTION_DEFS.filter(d => !isOptionSet(state.options[d.key]))
  const setCount = setDefs.length

  return (
    <div className="cl-agent-edit-v2" style={agentStyle(String(state.options.color || agent.color || ''))}>
      <div className="cl-agent-edit-v2-strip">
        <div className="crumbs">
          <span className="pip" />
          <span>{agent.scope === 'global' ? 'Global' : 'Project'}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span className="path" title={agent.path}>{agent.path}</span>
        </div>
      </div>

      <section className="cl-agent-edit-v2-head">
        <span className="cl-agent-edit-v2-orb">{initialOf(agent.name)}</span>
        <div style={{ minWidth: 0 }}>
          <h1>{agent.name}<span className="ext">.md</span></h1>
          <div className="label-row">
            <span className="ey"><span className="pip" />Edit agent · {agent.scope}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>frontmatter + system prompt</span>
          </div>
        </div>
        <div className="hint">
          <div className="l">changes apply on save</div>
          <div className="v">⌘S</div>
        </div>
      </section>

      <div className="cl-agent-edit-v2-work">
        <div className="cl-agent-edit-v2-col">
          <h2><span>Frontmatter</span><b>yaml header</b></h2>

          <div className="cl-agent-edit-v2-desc">
            <div className="l">Description</div>
            <textarea
              className="ed"
              value={state.description}
              onChange={e => onChange({ ...state, description: e.target.value })}
              rows={2}
              placeholder="When this agent should trigger…"
            />
          </div>

          <h2>
            <span>Properties</span>
            <b>{setCount} / {OPTION_DEFS.length} optional set</b>
          </h2>
          <div className="cl-agent-edit-v2-card" style={{ padding: '6px 18px 8px' }}>
            <div className="cl-agent-edit-v2-rows">
              <div className="opt set core">
                <span className="nm"><span className="dot" />name</span>
                <span className="vl muted">{agent.name}</span>
                <span className="cl-opt-ro">read-only</span>
              </div>
              <div className="opt set core">
                <span className="nm"><span className="dot" />scope</span>
                <span className="vl muted">{agent.scope}</span>
                <span className="cl-opt-ro">read-only</span>
              </div>
              {setDefs.map(def => (
                <div key={def.label} className="opt set">
                  <span className="nm"><span className="dot" />{def.label}</span>
                  <span className="vl as-editor">
                    <OptionEditor
                      def={def}
                      value={state.options[def.key]}
                      onChange={v => setOption(def, v)}
                    />
                  </span>
                  <button
                    type="button"
                    className="plus minus"
                    title="Remove property"
                    onClick={() => setOption(def, null)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>

          {unsetDefs.length > 0 && (
            <>
              <h2 style={{ marginTop: 22 }}>
                <span>Available options</span>
                <b>{unsetDefs.length} unset</b>
              </h2>
              <div className="cl-agent-edit-v2-card" style={{ padding: '6px 18px 8px' }}>
                <div className="cl-agent-edit-v2-rows">
                  {unsetDefs.map(def => (
                    <div key={def.label} className="opt">
                      <span className="nm"><span className="dot" />{def.label}</span>
                      <span className="vl" title={def.blurb}>{def.blurb}</span>
                      <button
                        type="button"
                        className="plus"
                        title="Add property"
                        onClick={() => setOption(def, defaultFor(def))}
                      >
                        ＋
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="cl-agent-edit-v2-col">
          <h2><span>System prompt</span><b>markdown body</b></h2>

          <div className="cl-agent-edit-v2-body">
            <div className="bh">
              <span className="dot" />
              <b>Body</b>
              <span>· markdown</span>
              <span className="ct">{charCount} chars · {wordCount} words</span>
            </div>
            <textarea
              ref={taRef}
              className="bb"
              value={state.body}
              onChange={e => { onChange({ ...state, body: e.target.value }); updatePos() }}
              onKeyUp={updatePos}
              onClick={updatePos}
              spellCheck={false}
            />
            <div className="bf">
              <span>{paragraphs} paragraph{paragraphs === 1 ? '' : 's'}</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>line <b>{pos.line}</b> col <b>{pos.col}</b></span>
              <span className="grow" />
              <span>md · utf-8</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── validation notice rendered below the strip when missing fields ── */
function ValidationNotice({ agent }: { agent: Agent }) {
  if (agent.missingRequired.length === 0 && !agent.filenameHasSpaces) return null
  return (
    <div style={{ padding: '14px 56px 0' }}>
      <div
        style={{
          padding: '12px 14px',
          borderLeft: '3px solid var(--cl-warn)',
          background: 'color-mix(in oklch, var(--cl-warn) 8%, transparent)',
          borderRadius: '0 8px 8px 0',
          maxWidth: 820,
        }}
      >
        <div
          className="font-mono uppercase"
          style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--cl-warn)', marginBottom: 6 }}
        >
          Invalid agent definition
        </div>
        {agent.missingRequired.length > 0 && (
          <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--cl-ink-2)' }}>
            Missing required {agent.missingRequired.length > 1 ? 'fields' : 'field'}{' '}
            {agent.missingRequired.map((f, i) => (
              <span key={f}>
                <code className="font-mono" style={{ fontSize: 12, color: 'var(--cl-warn)' }}>{f}</code>
                {i < agent.missingRequired.length - 1 ? ', ' : ''}
              </span>
            ))}
            {' — '}this subagent may not be loaded correctly by Claude Code.
          </p>
        )}
        {agent.filenameHasSpaces && (
          <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--cl-ink-2)' }}>
            The file name contains spaces — rename the file (e.g.{' '}
            <code className="font-mono" style={{ fontSize: 12, color: 'var(--cl-warn)' }}>{agent.name}.md</code>) so it loads correctly.
          </p>
        )}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   RUN AGENT DIALOG — prompt input → dispatch background agent
   ════════════════════════════════════════════════════════════════════ */
function RunAgentDialog({
  agent,
  project,
  onClose,
  onSubmit,
}: {
  agent: Agent
  project: Project
  onClose: () => void
  onSubmit: (args: { prompt: string; sessionName?: string }) => Promise<void>
}) {
  const [prompt, setPrompt] = useState('')
  const [sessionName, setSessionName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    promptRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit() {
    if (!prompt.trim() || busy) return
    try {
      setBusy(true)
      setError(null)
      await onSubmit({ prompt: prompt.trim(), sessionName: sessionName.trim() || undefined })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const projectName = project.realPath.split('/').pop() || project.realPath

  return (
    <div className="cl-run-agent-backdrop" onClick={onClose}>
      <div className="cl-run-agent-panel" onClick={e => e.stopPropagation()} style={agentStyle(agent.color)}>
        <div className="ey"><span className="pip" />Dispatch background agent</div>
        <h2>
          Run <span style={{ color: 'var(--cl-accent)' }}>{agent.name}</span>
          <span className="g"> in {projectName}</span>
        </h2>
        <div className="sub">{project.realPath}</div>

        {error && <div className="error">✕ {error}</div>}

        <div className="field">
          <label className="l">Prompt</label>
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="What should this agent do?"
          />
        </div>
        <div className="field">
          <label className="l">Session name · optional</label>
          <input
            value={sessionName}
            onChange={e => setSessionName(e.target.value)}
            placeholder={`${agent.name} run`}
          />
        </div>

        <div className="actions">
          <button type="button" className="cl-btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="cl-btn-solid"
            onClick={submit}
            disabled={!prompt.trim() || busy}
          >
            <PlayIcon /> {busy ? 'Dispatching…' : 'Dispatch · ⌘↵'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════
   ROOT — orchestrates View/Edit modes + Run-agent flow
   ════════════════════════════════════════════════════════════════════ */
export function AgentDetailViewV2({
  agent,
  project,
  onBack,
  onSave,
  onDispatchRun,
  onDuplicate,
}: {
  agent: Agent
  /** Defined when the agent detail is opened from inside a project (enables Run agent button). */
  project?: Project
  onBack: () => void
  onSave: (raw: string) => Promise<void>
  /** Called when the Run agent dialog confirms. Should dispatch the bg agent AND navigate to live-agents. */
  onDispatchRun?: (args: { prompt: string; sessionName?: string }) => Promise<void>
  /** Optional: invoked when user clicks Duplicate in the topbar. */
  onDuplicate?: () => void
}) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRun, setShowRun] = useState(false)

  const initial = useMemo<EditState>(() => {
    const options: Record<string, OptionValue> = {}
    for (const def of OPTION_DEFS) options[def.key] = readOption(agent, def)
    return {
      body: agent.content,
      description: agent.description ?? '',
      options,
    }
  }, [agent])

  const [editState, setEditState] = useState<EditState>(initial)
  useEffect(() => { setEditState(initial) }, [initial])
  useEffect(() => { setError(null) }, [mode])

  const optionsDirty = OPTION_DEFS.some(def => {
    const a = editState.options[def.key]
    const b = initial.options[def.key]
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length !== b.length || a.some((v, i) => v !== b[i])
    }
    return a !== b
  })

  const dirty =
    editState.body !== initial.body ||
    editState.description !== initial.description ||
    optionsDirty

  function optionsToOverrides(opts: Record<string, OptionValue>): Partial<Agent> {
    const out: Partial<Agent> = {}
    for (const def of OPTION_DEFS) {
      const v = opts[def.key]
      // Cast through `any` because Agent's optional fields are loosely typed strings;
      // values come from typed inputs (select/toggle/number) so they're safe.
      ;(out as Record<string, unknown>)[def.key] = v === null ? undefined : v
    }
    return out
  }

  async function handleSave() {
    if (!dirty || saving) return
    try {
      setSaving(true)
      setError(null)
      const raw = serializeAgent(agent, editState.body, {
        description: editState.description || undefined,
        ...optionsToOverrides(editState.options),
      })
      await onSave(raw)
      setMode('view')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function handleDiscard() {
    setEditState(initial)
    setMode('view')
    setError(null)
  }

  /* ⌘S keybinding while in edit mode */
  useEffect(() => {
    if (mode !== 'edit') return
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editState, saving])

  const canRun = !!project && !!onDispatchRun && mode === 'view'

  const topbarRight = (
    <>
      <span className="cl-vseg">
        <button
          type="button"
          className={mode === 'view' ? 'on' : ''}
          onClick={() => mode === 'edit' && dirty ? handleDiscard() : setMode('view')}
        >
          View
        </button>
        <button
          type="button"
          className={mode === 'edit' ? 'on warm' : ''}
          onClick={() => setMode('edit')}
        >
          Edit
        </button>
      </span>

      {mode === 'view' ? (
        <>
          {onDuplicate && (
            <button type="button" className="cl-btn-ghost" onClick={onDuplicate} title="Duplicate this agent file">
              <ExportIcon /> Duplicate
            </button>
          )}
          {canRun && (
            <button
              type="button"
              className="cl-btn-solid"
              onClick={() => setShowRun(true)}
              title={`Dispatch ${agent.name} as a background agent in this project`}
            >
              <PlayIcon /> Run agent
            </button>
          )}
        </>
      ) : (
        <>
          {error && (
            <span
              className="font-mono"
              style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--cl-warn)' }}
            >
              ✕ {error}
            </span>
          )}
          <span
            className="font-mono"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              fontSize: 10.5, letterSpacing: '0.16em', textTransform: 'uppercase',
              color: dirty ? 'var(--cl-accent-ink)' : 'var(--cl-ink-4)',
            }}
          >
            <span
              style={{
                width: 7, height: 7, borderRadius: '50%',
                background: dirty ? 'var(--cl-accent)' : 'var(--cl-ink-4)',
                boxShadow: dirty
                  ? '0 0 0 3px color-mix(in oklch, var(--cl-accent) 22%, transparent)'
                  : '0 0 0 3px color-mix(in oklch, var(--cl-ink-4) 18%, transparent)',
              }}
            />
            {dirty ? 'unsaved' : 'saved'}
          </span>
          <button
            type="button"
            className="cl-btn-ghost"
            onClick={handleDiscard}
            disabled={saving}
            title="Discard changes"
          >
            Discard
          </button>
          <button
            type="button"
            className="cl-btn-solid"
            onClick={handleSave}
            disabled={!dirty || saving}
            title="Save changes (⌘S)"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </>
  )

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar
        onBack={onBack}
        backLabel="Agents"
        crumbs={[
          { label: agent.scope === 'global' ? 'Global' : 'Project' },
          { label: agent.name, accent: true },
        ]}
        right={topbarRight}
      />

      <ValidationNotice agent={agent} />

      {mode === 'view' ? (
        <AgentViewManifesto agent={agent} />
      ) : (
        <AgentEditWorkbench
          agent={agent}
          state={editState}
          onChange={setEditState}
        />
      )}

      {showRun && project && onDispatchRun && (
        <RunAgentDialog
          agent={agent}
          project={project}
          onClose={() => setShowRun(false)}
          onSubmit={async args => {
            await onDispatchRun(args)
            setShowRun(false)
          }}
        />
      )}
    </div>
  )
}
