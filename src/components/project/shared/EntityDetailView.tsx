import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { TopBar, Crumb } from './TopBar'
import Markdown from '../../Markdown'
import {
  OptionDef,
  OptionValue,
  entityTint,
  initialOf,
  optionValueOf,
  defaultFor,
  isOptionSet,
  optionsDirty,
  fluidTitleSize,
} from './entityOptions'
import { ToolsInput } from './CreateFormKit'

/* ════════════════════════════════════════════════════════════════════
   EntityDetailView — vista detail unificata config-driven (markdown +
   frontmatter strutturato + view/edit/save/delete). Generalizza il
   "manifesto" dell'agent a tutte le entità: agent, skill, CLAUDE.md, plan.
   ════════════════════════════════════════════════════════════════════ */

export type TapeCell = {
  label: string
  value: string
  mono?: boolean
  /** Renderizza il pallino di stato. */
  status?: boolean
  /** Variante warn (stato invalido). */
  warn?: boolean
  /** Cella "Color" dell'agent (campione colore). */
  colorName?: boolean
}

export type EntityConfig = {
  kind: 'agent' | 'skill' | 'claudemd' | 'plan'
  /** Titolo (agent.name, skill.name, "CLAUDE", plan.title). */
  name: string
  titleGlyph?: string
  /** Titolo a tutta frase (plan): wrap + scaling invece di troncamento. */
  titleFluid?: boolean
  /** Etichetta scope mostrata nello strip/tape (es. "Global"/"Project"). */
  scopeLabel: string
  /** Path file mostrato nello strip. */
  path?: string
  /** Descrizione/lead nell'hero. */
  description?: string
  /** Eyebrow dell'hero (es. "Agent · markdown manifest"). */
  eyebrow: string
  /** Etichetta sintetica accanto al nome nello strip (es. "agent", "skill"). */
  kindLabel: string

  /** backLabel della TopBar. */
  backLabel: string
  crumbs: Crumb[]

  /** Colore identità (solo agent). */
  color?: string
  /** Lettera dell'orb. */
  initial?: string
  /** Tint neutro quando non c'è il concetto di colore. */
  neutralTint?: boolean

  tape: TapeCell[]
  /** Se true l'ultima cella della tape è la "feature" scura (solo agent). Default false → tape flat. */
  tapeFeature?: boolean
  /** Etichetta del body (es. "System prompt · markdown body"). */
  bodyLabel: string

  optionDefs: OptionDef[]
  /** Stato iniziale delle opzioni (chiave def.key → valore). */
  initialOptions: Record<string, OptionValue>

  body: string
  hasDescriptionField?: boolean
  descriptionValue?: string
  /** Righe core read-only nell'editor frontmatter (es. name, scope). */
  coreRows?: { label: string; value: string }[]

  /** Serializza lo stato editato in markdown grezzo da salvare. */
  serialize?: (args: { body: string; description: string; options: Record<string, OptionValue> }) => string

  editable: boolean
  deletable: boolean
  duplicable: boolean
  runnable: boolean

  validation?: { title: string; messages: ReactNode[] }
  emptyMessage?: string
  /** Nota opzionale in fondo al body (es. plan: stored globally · read-only). */
  footerNote?: ReactNode
}

/* ════════════════════════════════ ICONS ════════════════════════════════ */
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
const TrashIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 4h11" /><path d="M5.5 4V2.5h5V4" /><path d="M3.5 4l.6 9h7.8l.6-9" /><path d="M6.5 6.5v4M9.5 6.5v4" />
  </svg>
)

/* ════════════════════════════ OPTION EDITOR ════════════════════════════ */
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
      <button type="button" className={'cl-opt-toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
        <span className="cl-opt-toggle-knob" />
        <span className="cl-opt-toggle-label">{on ? 'enabled' : 'disabled'}</span>
      </button>
    )
  }
  if (def.isArray) {
    const arr = Array.isArray(value) ? value : []
    if (def.isTools) {
      // Tool-list field: chips + autocomplete of known tools, free text still allowed.
      return (
        <ToolsInput
          value={arr}
          onChange={v => onChange(v)}
          placeholder="Read, Grep, Bash…"
          accent="accent"
        />
      )
    }
    return (
      <input
        type="text"
        className="cl-opt-input"
        value={arr.join(', ')}
        placeholder="comma, separated, values"
        onChange={e => onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
      />
    )
  }
  if (def.enum?.length) {
    return (
      <select className="cl-opt-input" value={typeof value === 'string' ? value : ''} onChange={e => onChange(e.target.value)}>
        {def.enum.map(o => <option key={o} value={o}>{o}</option>)}
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

/* ════════════════════════════════ VIEW ════════════════════════════════ */
function ViewManifesto({ config }: { config: EntityConfig }) {
  const body = config.body || ''
  const charCount = body.length
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0
  const propertyRows = config.optionDefs.map(def => ({
    def,
    value: optionValueOf(config.initialOptions as unknown as Record<string, unknown>, def),
  }))
  const hasOptions = config.optionDefs.length > 0
  const setProperties = propertyRows.filter(row => row.value)
  const unsetProperties = propertyRows.filter(row => !row.value)
  const initial = config.initial ?? initialOf(config.name)

  return (
    <div className="cl-agent-v2" style={entityTint(config.color, { neutral: config.neutralTint })}>
      <div className="cl-agent-v2-strip">
        <span className="scope-pill"><span className="d" /> {config.scopeLabel}</span>
        {config.path && <span className="path" title={config.path}>{config.path}</span>}
        <span className="id-tag">
          <span className="orb-tiny">{initial}</span>
          {config.name} · {config.kindLabel}
        </span>
      </div>

      <section className="cl-agent-v2-hero">
        <div>
          <div className="ey">
            <span className="pip" />
            <span>{config.eyebrow}</span>
          </div>
          <h1
            className={config.titleFluid ? 'fluid' : undefined}
            style={config.titleFluid ? { fontSize: fluidTitleSize(config.name) } : undefined}
          >
            {config.name}{config.titleGlyph && <span className="ext">{config.titleGlyph}</span>}
          </h1>
          {config.description && <div className="desc">{config.description}</div>}
        </div>
        <div className="cl-agent-v2-lens" aria-hidden="true">
          <span className="orb-big" />
          <span className="orb-sm" />
          <span className="orb-mid" />
        </div>
      </section>

      {config.tape.length > 0 && (
        <section
          className={'cl-agent-v2-tape' + (config.tapeFeature ? '' : ' cl-agent-v2-tape--flat')}
          style={{ gridTemplateColumns: `repeat(${config.tape.length}, minmax(0, 1fr))` }}
        >
          {config.tape.map(cell => (
            <div className="cell" key={cell.label}>
              <div className="l">{cell.label}</div>
              <div
                className={
                  'v' +
                  (cell.mono ? ' mono' : '') +
                  (cell.colorName ? ' agent-color' : '') +
                  (cell.status ? ' status' : '') +
                  (cell.warn ? ' is-warn' : '')
                }
              >
                {cell.status && <span className="d" />}{cell.value}
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="cl-agent-v2-body">
        <div className="lab">{config.bodyLabel} · {charCount} chars · {wordCount} words</div>
        <div className="prose">
          {body ? <Markdown>{body}</Markdown> : (
            <p style={{ color: 'var(--cl-ink-3)', fontStyle: 'italic' }}>{config.emptyMessage ?? 'No content.'}</p>
          )}
        </div>

        {hasOptions && (
          <div className="cl-agent-v2-opts">
            <h3><span>Properties</span><b>{setProperties.length} / {config.optionDefs.length} set</b></h3>

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
        )}

        {config.footerNote && (
          <p style={{ marginTop: 24, fontSize: 11, lineHeight: 1.5, color: 'var(--cl-ink-3)' }}>
            {config.footerNote}
          </p>
        )}
      </section>
    </div>
  )
}

/* ════════════════════════════════ EDIT ════════════════════════════════ */
type EditState = {
  body: string
  description: string
  options: Record<string, OptionValue>
}

function EditWorkbench({
  config,
  state,
  onChange,
}: {
  config: EntityConfig
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
  const setDefs = config.optionDefs.filter(d => isOptionSet(state.options[d.key]))
  const unsetDefs = config.optionDefs.filter(d => !isOptionSet(state.options[d.key]))
  const hasLeftCol = !!config.hasDescriptionField || config.optionDefs.length > 0
  const colorForTint = config.color ?? (typeof state.options.color === 'string' ? state.options.color : undefined)
  const initial = config.initial ?? initialOf(config.name)

  return (
    <div
      className={'cl-agent-edit-v2' + (hasLeftCol ? '' : ' is-single-col')}
      style={entityTint(colorForTint, { neutral: config.neutralTint })}
    >
      <div className="cl-agent-edit-v2-strip">
        <div className="crumbs">
          <span className="pip" />
          <span>{config.scopeLabel}</span>
          {config.path && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span className="path" title={config.path}>{config.path}</span>
            </>
          )}
        </div>
      </div>

      <section className="cl-agent-edit-v2-head">
        <span className="cl-agent-edit-v2-orb">{initial}</span>
        <div style={{ minWidth: 0 }}>
          <h1>{config.name}{config.titleGlyph && <span className="ext">{config.titleGlyph}</span>}</h1>
          <div className="label-row">
            <span className="ey"><span className="pip" />Edit {config.kindLabel} · {config.scopeLabel}</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{hasLeftCol ? 'frontmatter + body' : 'markdown body'}</span>
          </div>
        </div>
        <div className="hint">
          <div className="l">changes apply on save</div>
          <div className="v">⌘S</div>
        </div>
      </section>

      <div className="cl-agent-edit-v2-work">
        {hasLeftCol && (
          <div className="cl-agent-edit-v2-col">
            <h2><span>Frontmatter</span><b>yaml header</b></h2>

            {config.hasDescriptionField && (
              <div className="cl-agent-edit-v2-desc">
                <div className="l">Description</div>
                <textarea
                  className="ed"
                  value={state.description}
                  onChange={e => onChange({ ...state, description: e.target.value })}
                  rows={2}
                  placeholder="What this is for…"
                />
              </div>
            )}

            {config.optionDefs.length > 0 && (
              <>
                <h2>
                  <span>Properties</span>
                  <b>{setDefs.length} / {config.optionDefs.length} optional set</b>
                </h2>
                <div className="cl-agent-edit-v2-card" style={{ padding: '6px 18px 8px' }}>
                  <div className="cl-agent-edit-v2-rows">
                    {(config.coreRows ?? []).map(row => (
                      <div key={row.label} className="opt set core">
                        <span className="nm"><span className="dot" />{row.label}</span>
                        <span className="vl muted">{row.value}</span>
                        <span className="cl-opt-ro">read-only</span>
                      </div>
                    ))}
                    {setDefs.map(def => (
                      <div key={def.label} className="opt set">
                        <span className="nm"><span className="dot" />{def.label}</span>
                        <span className="vl as-editor">
                          <OptionEditor def={def} value={state.options[def.key]} onChange={v => setOption(def, v)} />
                        </span>
                        <button type="button" className="plus minus" title="Remove property" onClick={() => setOption(def, null)}>✕</button>
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
                            <button type="button" className="plus" title="Add property" onClick={() => setOption(def, defaultFor(def))}>＋</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        <div className="cl-agent-edit-v2-col">
          <h2><span>{config.kind === 'agent' ? 'System prompt' : 'Body'}</span><b>markdown body</b></h2>

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

/* ════════════════════════════ VALIDATION ════════════════════════════ */
function ValidationNotice({ validation }: { validation: EntityConfig['validation'] }) {
  if (!validation || validation.messages.length === 0) return null
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
        <div className="font-mono uppercase" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--cl-warn)', marginBottom: 6 }}>
          {validation.title}
        </div>
        {validation.messages.map((m, i) => (
          <p key={i} style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--cl-ink-2)' }}>{m}</p>
        ))}
      </div>
    </div>
  )
}

/* ════════════════════════ CONFIRM DELETE DIALOG ════════════════════════ */
function ConfirmDeleteDialog({
  name,
  path,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  name: string
  path?: string
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="cl-run-agent-backdrop" onClick={onCancel}>
      <div className="cl-run-agent-panel" onClick={e => e.stopPropagation()}>
        <div className="ey"><span className="pip" />Delete file</div>
        <h2>Delete <span style={{ color: 'var(--cl-accent)' }}>{name}</span>?</h2>
        {path && <div className="sub">{path}</div>}
        {error && <div className="error">✕ {error}</div>}
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--cl-ink-2)', marginTop: 8 }}>
          This permanently removes the file from disk. This action cannot be undone.
        </p>
        <div className="actions">
          <button type="button" className="cl-btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="cl-btn-solid"
            style={{ background: 'var(--cl-warn)', borderColor: 'var(--cl-warn)' }}
            onClick={onConfirm}
            disabled={busy}
          >
            <TrashIcon /> {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════ ROOT ════════════════════════════════ */
export function EntityDetailView({
  config,
  onBack,
  onSave,
  onDelete,
  onDuplicate,
  renderRunOverlay,
}: {
  config: EntityConfig
  onBack: () => void
  onSave?: (raw: string) => Promise<void>
  onDelete?: () => Promise<void>
  onDuplicate?: () => void
  /** Overlay agent-specifico (Run dialog). Riceve open/onClose. */
  renderRunOverlay?: (args: { onClose: () => void }) => ReactNode
}) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRun, setShowRun] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const optionsKey = useMemo(() => JSON.stringify(config.initialOptions), [config.initialOptions])
  const initial = useMemo<EditState>(
    () => ({
      body: config.body,
      description: config.descriptionValue ?? '',
      options: { ...config.initialOptions },
    }),
    // deps su valori primitivi stabili: la config è ricreata a ogni render
    // ma questi valori cambiano solo a contenuto effettivamente diverso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.body, config.descriptionValue, optionsKey]
  )

  const [editState, setEditState] = useState<EditState>(initial)
  // Re-seed the edit buffer when the source content changes, and clear any
  // stale error when toggling view/edit — both via React's "adjust state during
  // render" pattern instead of effects.
  const [lastInitial, setLastInitial] = useState(initial)
  if (initial !== lastInitial) {
    setLastInitial(initial)
    setEditState(initial)
  }
  const [lastMode, setLastMode] = useState(mode)
  if (mode !== lastMode) {
    setLastMode(mode)
    setError(null)
  }

  const dirty =
    mode === 'edit' &&
    (editState.body !== initial.body ||
      editState.description !== initial.description ||
      optionsDirty(editState.options, initial.options, config.optionDefs))

  const editable = config.editable && typeof onSave === 'function' && typeof config.serialize === 'function'
  const canRun = config.runnable && !!renderRunOverlay && mode === 'view'

  async function handleSave() {
    if (!dirty || saving || !onSave || !config.serialize) return
    try {
      setSaving(true)
      setError(null)
      const raw = config.serialize({
        body: editState.body,
        description: editState.description,
        options: editState.options,
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

  async function handleDelete() {
    if (!onDelete || deleting) return
    try {
      setDeleting(true)
      setDeleteError(null)
      await onDelete()
      setShowDelete(false)
      onBack()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  /* ⌘S in edit mode */
  useEffect(() => {
    if (mode !== 'edit') return
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, editState, saving])

  const topbarRight = (
    <>
      {editable && (
        <span className="cl-vseg">
          <button
            type="button"
            className={mode === 'view' ? 'on' : ''}
            onClick={() => (mode === 'edit' && dirty ? handleDiscard() : setMode('view'))}
          >
            View
          </button>
          <button type="button" className={mode === 'edit' ? 'on warm' : ''} onClick={() => setMode('edit')}>
            Edit
          </button>
        </span>
      )}

      {mode === 'view' ? (
        <>
          {config.duplicable && onDuplicate && (
            <button type="button" className="cl-btn-ghost" onClick={onDuplicate} title="Duplicate this file">
              <ExportIcon /> Duplicate
            </button>
          )}
          {config.deletable && onDelete && (
            <button
              type="button"
              className="cl-btn-ghost"
              style={{ color: 'var(--cl-warn)' }}
              onClick={() => { setDeleteError(null); setShowDelete(true) }}
              title="Delete this file"
            >
              <TrashIcon /> Delete
            </button>
          )}
          {canRun && (
            <button type="button" className="cl-btn-solid" onClick={() => setShowRun(true)} title="Dispatch as a background agent">
              <PlayIcon /> Run agent
            </button>
          )}
        </>
      ) : (
        <>
          {error && (
            <span className="font-mono" style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--cl-warn)' }}>
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
          <button type="button" className="cl-btn-ghost" onClick={handleDiscard} disabled={saving} title="Discard changes">
            Discard
          </button>
          <button type="button" className="cl-btn-solid" onClick={handleSave} disabled={!dirty || saving} title="Save changes (⌘S)">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </>
  )

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--cl-paper)' }}>
      <TopBar onBack={onBack} backLabel={config.backLabel} crumbs={config.crumbs} right={topbarRight} />

      <ValidationNotice validation={config.validation} />

      <div className="flex-1 overflow-y-auto">
        {mode === 'edit' && editable ? (
          <EditWorkbench config={config} state={editState} onChange={setEditState} />
        ) : (
          <ViewManifesto config={config} />
        )}
      </div>

      {showRun && renderRunOverlay && renderRunOverlay({ onClose: () => setShowRun(false) })}

      {showDelete && (
        <ConfirmDeleteDialog
          name={config.name}
          path={config.path}
          busy={deleting}
          error={deleteError}
          onCancel={() => setShowDelete(false)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  )
}
