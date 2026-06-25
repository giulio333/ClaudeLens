import { useState, useRef, useCallback, useEffect } from 'react'
import {
  useLiveSessions, BgSession, SessionSummary, useProjectAgents, useGlobalAgents,
  useDispatchBackgroundAgent, useDeleteBackgroundAgent,
  useStopBackgroundAgent, useRespawnBackgroundAgent, useAttachBackgroundAgent,
} from '../../../hooks/useIPC'
import { Lens } from '../overview/Lens'
import { TopBar } from '../shared/TopBar'
import { projectDisplayName } from '../shared/projectName'

type Project = { hash: string; realPath: string }

// Claude Code nomina la cartella progetto sostituendo '/' e '.' con '-'.
function hashFromCwd(cwd: string): string {
  return cwd.replace(/[/.]/g, '-')
}

// Costruisce un SessionSummary minimale per aprire il transcript nella chat view.
function summaryFor(s: BgSession): SessionSummary {
  return {
    filename: `${s.sessionId}.jsonl`,
    date: s.updatedAt || s.createdAt,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    cacheSavings: 0,
    messageCount: 0,
    models: {},
    customTitle: s.name,
    template: s.template,
  }
}

// ─── Status mapping ────────────────────────────────────────────────────────────

type Bucket = 'needs-input' | 'working' | 'ready' | 'completed' | 'failed' | 'stopped'

interface StatusInfo {
  bucket: Bucket
  label: string
  color: string
  pulse: boolean
}

// Mirrors the bucketing used by `claude agents` TUI: needs-input takes priority
// over working so that rate-limits / pending questions surface immediately.
function statusOf(s: BgSession): StatusInfo {
  const needsInput =
    !!s.hasPendingQuestion ||
    s.state === 'blocked' ||
    s.tempo === 'blocked' ||
    (typeof s.needs === 'string' && s.needs.length > 0)
  if (needsInput) return { bucket: 'needs-input', label: 'Needs input', color: '#f59e0b', pulse: true }

  if (s.state === 'done') return { bucket: 'completed', label: 'Completed', color: '#22c55e', pulse: false }
  if (s.state === 'failed' || s.state === 'errored')
    return { bucket: 'failed', label: 'Failed', color: '#ef4444', pulse: false }
  if (s.state === 'stopped') return { bucket: 'stopped', label: 'Stopped', color: '#94a3b8', pulse: false }

  // Alive worker: anything that's not idle-done is treated as Working so the
  // user sees motion even when `tempo` lags behind the actual state.
  if (s.alive) {
    if (s.tempo === 'thinking') return { bucket: 'working', label: 'Thinking', color: '#6366f1', pulse: true }
    if (s.tempo === 'busy' || s.inFlightTasks > 0 || s.state === 'running' || s.state === 'working')
      return { bucket: 'working', label: 'Working', color: '#6366f1', pulse: true }
    return { bucket: 'ready', label: 'Ready', color: '#0ea5e9', pulse: false }
  }

  return { bucket: 'stopped', label: 'Asleep', color: '#94a3b8', pulse: false }
}

// Buckets that represent finished work. A worker process can stay alive (warm,
// idle) after its task is done — `claude agents` keeps it around for attach /
// resume — so pid-liveness alone overcounts "running now".
const TERMINAL_BUCKETS = new Set<Bucket>(['completed', 'failed', 'stopped'])

const BUCKET_ORDER: { key: Bucket; title: string; hint: string }[] = [
  { key: 'needs-input', title: 'Needs input', hint: 'waiting on you' },
  { key: 'working', title: 'Working', hint: 'actively running' },
  { key: 'ready', title: 'Ready', hint: 'idle, awaiting next prompt' },
  { key: 'completed', title: 'Completed', hint: 'finished successfully' },
  { key: 'failed', title: 'Failed', hint: 'ended with an error' },
  { key: 'stopped', title: 'Stopped', hint: 'no live process' },
]

function relTime(iso: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return ''
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ─── Row ─────────────────────────────────────────────────────────────────────

type ActionTone = 'neutral' | 'danger'

function ActionButton({
  label, title, onClick, disabled, busy, tone = 'neutral', confirming,
}: {
  label: string
  title: string
  onClick: (e: React.MouseEvent) => void
  disabled?: boolean
  busy?: boolean
  tone?: ActionTone
  confirming?: boolean
}) {
  const danger = tone === 'danger'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        border: `1px solid ${confirming ? '#ef4444' : 'var(--cl-line)'}`,
        background: confirming ? '#fef2f2' : 'transparent',
        color: confirming || danger ? '#ef4444' : 'var(--cl-ink-4)',
        cursor: disabled || busy ? 'not-allowed' : 'pointer',
        opacity: disabled || busy ? 0.5 : 1,
        transition: 'all 0.15s',
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}
    >
      {busy ? '…' : confirming ? 'confirm?' : label}
    </button>
  )
}

/** Two-click confirm wrapper — first click arms, second click within 2s fires. */
function useTwoStepConfirm(onConfirm: () => void) {
  const [confirming, setConfirming] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  const trigger = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirming) {
      if (timerRef.current) clearTimeout(timerRef.current)
      setConfirming(false)
      onConfirm()
    } else {
      setConfirming(true)
      timerRef.current = setTimeout(() => setConfirming(false), 2000)
    }
  }, [confirming, onConfirm])
  return { confirming, trigger }
}

interface RowActions {
  onAttach: () => void
  onStop: () => void
  onRestart: () => void
  onRemove: () => void
  busy: { stop: boolean; restart: boolean; remove: boolean; attach: boolean }
}

function ActionCluster({ s, actions }: { s: BgSession; actions: RowActions }) {
  const stopConfirm = useTwoStepConfirm(actions.onStop)
  const removeConfirm = useTwoStepConfirm(actions.onRemove)
  const canStop = s.alive
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div style={{ display: 'flex', gap: 4 }} onClick={stop}>
      <ActionButton
        label="attach" title="Attach in Terminal (claude attach)"
        onClick={(e) => { e.stopPropagation(); actions.onAttach() }}
        busy={actions.busy.attach}
      />
      <ActionButton
        label="stop" title={canStop ? 'Stop the running session (claude stop)' : 'Session is not running'}
        onClick={stopConfirm.trigger}
        disabled={!canStop}
        busy={actions.busy.stop}
        confirming={stopConfirm.confirming}
      />
      <ActionButton
        label="restart" title="Restart session, preserving conversation (claude respawn)"
        onClick={(e) => { e.stopPropagation(); actions.onRestart() }}
        busy={actions.busy.restart}
      />
      <ActionButton
        label="remove" tone="danger"
        title="Remove from the list (claude rm)"
        onClick={removeConfirm.trigger}
        busy={actions.busy.remove}
        confirming={removeConfirm.confirming}
      />
    </div>
  )
}

function SessionRow({
  s,
  showProject,
  onOpen,
  actions,
}: {
  s: BgSession
  showProject: boolean
  onOpen: () => void
  actions: RowActions
}) {
  const st = statusOf(s)
  const subtitle = s.detail || s.result || s.intent || '—'
  return (
    <button
      type="button"
      className="cl-tile"
      onClick={onOpen}
      style={{ textAlign: 'left', alignItems: 'flex-start' }}
    >
      <span
        className="glyph"
        style={{
          color: st.color,
          fontSize: 14,
          animation: st.pulse ? 'alPulse 1.4s ease-in-out infinite' : undefined,
        }}
      >
        ●
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="t-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="truncate">{s.name}</span>
          {s.template && s.template !== 'claude' && (
            <span
              style={{
                fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--cl-ink-4)', border: '1px solid var(--cl-line)',
                borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--font-mono)',
              }}
            >
              {s.template}
            </span>
          )}
        </div>
        <div className="t-desc truncate">{subtitle}</div>
        {showProject && s.projectName && (
          <div
            className="truncate"
            style={{ fontSize: 11, color: 'var(--cl-ink-4)', fontFamily: 'var(--font-mono)', marginTop: 3 }}
          >
            {s.projectName}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <span className="t-meta" style={{ textAlign: 'right' }}>
          <b style={{ color: st.color }}>{st.label}</b>
          {s.inFlightTasks > 0 && <> · {s.inFlightTasks} task</>}
          <br />
          <span style={{ color: 'var(--cl-ink-4)' }}>{relTime(s.updatedAt)}</span>
        </span>
        <ActionCluster s={s} actions={actions} />
      </div>
    </button>
  )
}


// ─── Dispatch selector ──────────────────────────────────────────────────────────

/** Chip + upward popover anchored in the dispatch meta-row — mirrors the chat
 *  composer's `ComposerSelect` so the two surfaces read the same. */
function DispatchSelect({
  label, value, options, onChange, disabled, icon,
}: {
  label: string
  value: string
  options: { value: string; label: string; hint?: string }[]
  onChange: (value: string) => void
  disabled?: boolean
  icon?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const current = options.find(o => o.value === value)

  return (
    <span className="cl-composer-select" ref={rootRef}>
      {open && (
        <div className="cl-composer-menu" role="menu">
          <span className="cl-composer-menu-label">{label}</span>
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              className={o.value === value ? 'is-active' : ''}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              <span className="cl-composer-menu-item-label">{o.label}</span>
              {o.hint && <span className="cl-composer-menu-item-hint">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="cl-composer-chip"
        data-on={open || undefined}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        {icon && <span className="cl-composer-chip-icon" aria-hidden>{icon}</span>}
        {current?.label ?? value}
        <span className="cl-composer-chip-caret" aria-hidden />
      </button>
    </span>
  )
}

// ─── View ──────────────────────────────────────────────────────────────────────

export function AgentsLiveView({
  onBack,
  project,
  onOpenSession,
  embedded = false,
  hideHero = false,
}: {
  onBack: () => void
  project?: Project
  onOpenSession: (project: Project, session: SessionSummary, bg?: { jobId: string; alive: boolean }) => void
  embedded?: boolean
  hideHero?: boolean
}) {
  const projectName = project ? projectDisplayName(project.realPath) : undefined
  const { data, isLoading } = useLiveSessions()

  const { data: globalAgents = [] } = useGlobalAgents()
  const { data: projectAgents = [] } = useProjectAgents(project?.realPath || null)
  const allAgents = [...projectAgents, ...globalAgents].filter((a, i, arr) => arr.findIndex(x => x.name === a.name) === i)

  const dispatchBg = useDispatchBackgroundAgent()
  const deleteBg = useDeleteBackgroundAgent()
  const stopBg = useStopBackgroundAgent()
  const respawnBg = useRespawnBackgroundAgent()
  const attachBg = useAttachBackgroundAgent()
  const [busyIds, setBusyIds] = useState<Record<string, { stop?: boolean; restart?: boolean; remove?: boolean; attach?: boolean }>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const setBusy = (id: string, key: 'stop' | 'restart' | 'remove' | 'attach', v: boolean) =>
    setBusyIds(prev => ({ ...prev, [id]: { ...prev[id], [key]: v } }))
  const [prompt, setPrompt] = useState('')
  const [agentName, setAgentName] = useState('')
  const [sessionName, setSessionName] = useState('')
  const [model, setModel] = useState('')

  const all = data ?? []
  const sessions = project
    ? all.filter(s => s.cwd === project.realPath || s.cwd.startsWith(project.realPath + '/'))
    : all

  // "Live / running now" = alive workers still doing or ready to do work, not
  // finished ones sitting idle with a warm process (those land in TERMINAL_BUCKETS).
  const liveCount = sessions.filter(s => s.alive && !TERMINAL_BUCKETS.has(statusOf(s).bucket)).length
  const counts = sessions.reduce((acc, s) => {
    const b = statusOf(s).bucket
    acc[b] = (acc[b] ?? 0) + 1
    return acc
  }, {} as Record<Bucket, number>)
  const groups = BUCKET_ORDER
    .map(b => ({ ...b, items: sessions.filter(s => statusOf(s).bucket === b.key) }))
    .filter(g => g.items.length > 0)

  return (
    <div
      className={embedded ? 'flex flex-col' : 'h-full flex flex-col'}
      style={embedded ? { flexGrow: 1 } : { background: 'var(--cl-paper)' }}
    >
      <style>{`@keyframes alPulse { 0%,100%{opacity:1} 50%{opacity:.35} }`}</style>
      {!embedded && (
        <TopBar onBack={onBack} crumbs={[{ label: project ? `Project · Agent View · ${projectName}` : 'Global · Agent View' }]} />
      )}

      <div className={embedded ? 'flex-1' : 'flex-1 overflow-y-auto'}>
        {!hideHero && (
          <section className={`cl-hero${liveCount > 0 ? ' is-live' : ''}`}>
            {liveCount > 0 && <span className="cl-live-bar" aria-hidden />}
            <Lens />
            <div className="cl-eyebrow">
              <span className="pip" />
              <span>{project ? `Project · ${projectName} · background sessions` : 'Global · claude agents'}</span>
            </div>
            <h1 className="cl-h-name static">
              <span className="label-name">Agent View</span>
              <span className="glyph">.</span>
            </h1>
            <div className="cl-h-meta">
              <span><b>{sessions.length}</b> {sessions.length === 1 ? 'session' : 'sessions'}</span>
              <span className="sep">·</span>
              <span><b>{liveCount}</b> live</span>
            </div>
          </section>
        )}

        {isLoading ? (
          <section className="cl-section">
            <p style={{ color: 'var(--cl-ink-3)', fontSize: 13 }}>Loading…</p>
          </section>
        ) : sessions.length === 0 ? (
          <section className="cl-section">
            <div className="cl-empty">
              No background sessions. Dispatch one with{' '}
              <code style={{ fontFamily: 'var(--font-mono)' }}>claude agents</code>
              {project ? ' inside this project.' : '.'}
            </div>
          </section>
        ) : (
          <>
            <section className="cl-stats cl-stats--agents">
              <div className="cl-stat">
                <span className="lbl">Needs input</span>
                <div className="num">{counts['needs-input'] ?? 0}</div>
                <div className="delta">waiting on you</div>
              </div>
              <div className="cl-stat">
                <span className="lbl">Working</span>
                <div className="num">{counts['working'] ?? 0}</div>
                <div className="delta">actively running</div>
              </div>
              <div className="cl-stat">
                <span className="lbl">Ready</span>
                <div className="num">{counts['ready'] ?? 0}</div>
                <div className="delta">idle, awaiting</div>
              </div>
              <div className="cl-stat live">
                <span className="lbl">
                  <span className="pulse" /> Live
                </span>
                <div className="num">{liveCount}</div>
                <div className="uptime">running now</div>
              </div>
            </section>
            {groups.map(g => (
            <section className="cl-section" key={g.key}>
              <div className="cl-sec-head">
                <h2>{g.title}</h2>
                <span className="ct">{g.items.length} · {g.hint}</span>
              </div>
              <div className="cl-tile-grid cl-tile-grid--list">
                {g.items.map(s => {
                  const b = busyIds[s.id] || {}
                  const handle = (key: 'stop' | 'restart' | 'remove' | 'attach', run: () => Promise<unknown>) => {
                    setBusy(s.id, key, true)
                    setActionError(null)
                    run()
                      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)))
                      .finally(() => setBusy(s.id, key, false))
                  }
                  return (
                    <SessionRow
                      key={s.id}
                      s={s}
                      showProject={!project}
                      onOpen={() => onOpenSession(
                        project ?? { hash: hashFromCwd(s.cwd), realPath: s.cwd },
                        summaryFor(s),
                        { jobId: s.id, alive: s.alive },
                      )}
                      actions={{
                        onAttach: () => handle('attach', () => attachBg.mutateAsync({ cwd: s.cwd, id: s.id })),
                        onStop: () => handle('stop', () => stopBg.mutateAsync(s.id)),
                        onRestart: () => handle('restart', () => respawnBg.mutateAsync(s.id)),
                        onRemove: () => handle('remove', () => deleteBg.mutateAsync(s.id)),
                        busy: {
                          stop: !!b.stop, restart: !!b.restart, remove: !!b.remove, attach: !!b.attach,
                        },
                      }}
                    />
                  )
                })}
              </div>
            </section>
            ))}
          </>
        )}
      </div>

      {actionError && (
        <div className="cl-dispatch-action-error">
          <span className="msg">✕ {actionError}</span>
          <button type="button" onClick={() => setActionError(null)}>dismiss</button>
        </div>
      )}

      {project && (
        <div className="cl-dispatch">
          <form
            className="cl-dispatch-inner"
            onSubmit={(e) => {
              e.preventDefault()
              if (!prompt.trim() || dispatchBg.isPending) return
              dispatchBg.mutate({ cwd: project.realPath, prompt: prompt.trim(), name: sessionName.trim() || undefined, agent: agentName || undefined, model: model || undefined }, {
                onSuccess: () => {
                  setPrompt('')
                  setSessionName('')
                  setAgentName('')
                  setModel('')
                }
              })
            }}
          >
            {dispatchBg.isError && (
              <div className="cl-composer-error">{String(dispatchBg.error)}</div>
            )}
            <div className="cl-dispatch-card">
              <div className="cl-dispatch-prompt">
                <span className="cl-dispatch-glyph" aria-hidden>⌁</span>
                <textarea
                  className="cl-dispatch-input"
                  placeholder="Dispatch a background task in this project…"
                  rows={1}
                  value={prompt}
                  disabled={dispatchBg.isPending}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (prompt.trim() && !dispatchBg.isPending) e.currentTarget.form?.requestSubmit()
                    }
                  }}
                />
              </div>
              <div className="cl-dispatch-foot">
                <div className="cl-dispatch-controls">
                  <DispatchSelect
                    label="Subagent"
                    icon="◇"
                    value={agentName}
                    disabled={dispatchBg.isPending}
                    onChange={setAgentName}
                    options={[
                      { value: '', label: 'No subagent' },
                      ...allAgents.map(a => ({ value: a.name, label: a.name })),
                    ]}
                  />
                  <DispatchSelect
                    label="Model"
                    icon="◆"
                    value={model}
                    disabled={dispatchBg.isPending}
                    onChange={setModel}
                    options={[
                      { value: '', label: 'Default model' },
                      { value: 'opus', label: 'Opus' },
                      { value: 'sonnet', label: 'Sonnet' },
                      { value: 'haiku', label: 'Haiku' },
                    ]}
                  />
                  <label className="cl-dispatch-name-wrap">
                    <span className="cl-dispatch-name-icon" aria-hidden>✎</span>
                    <input
                      type="text"
                      className="cl-dispatch-name"
                      placeholder="Name"
                      value={sessionName}
                      disabled={dispatchBg.isPending}
                      onChange={e => setSessionName(e.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  className="cl-dispatch-send"
                  title="Enter to send · Shift+Enter for newline"
                  disabled={!prompt.trim() || dispatchBg.isPending}
                >
                  {dispatchBg.isPending ? 'Dispatching…' : 'Dispatch'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
