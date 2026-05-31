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
  onOpenSession: (project: Project, session: SessionSummary) => void
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

  const liveCount = sessions.filter(s => s.alive).length
  const groups = BUCKET_ORDER
    .map(b => ({ ...b, items: sessions.filter(s => statusOf(s).bucket === b.key) }))
    .filter(g => g.items.length > 0)

  return (
    <div className={embedded ? '' : 'h-full flex flex-col'} style={embedded ? undefined : { background: 'var(--cl-paper)' }}>
      <style>{`@keyframes alPulse { 0%,100%{opacity:1} 50%{opacity:.35} }`}</style>
      {!embedded && (
        <TopBar onBack={onBack} crumbs={[{ label: project ? `Project · Agent View · ${projectName}` : 'Global · Agent View' }]} />
      )}

      <div className={embedded ? '' : 'flex-1 overflow-y-auto'}>
        {!hideHero && (
          <section className="cl-hero">
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
          groups.map(g => (
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
          ))
        )}
      </div>
      
      {actionError && (
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--cl-line)', background: '#fef2f2', color: '#ef4444', fontSize: 12, fontFamily: 'var(--font-mono)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✕ {actionError}</span>
          <button type="button" onClick={() => setActionError(null)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}>dismiss</button>
        </div>
      )}

      {project && (
        <div style={{ padding: '16px', borderTop: '1px solid var(--cl-line)', background: 'var(--cl-panel)', zIndex: 10 }}>
          {dispatchBg.isError && (
            <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '8px', padding: '8px', background: '#fef2f2', borderRadius: '6px', border: '1px solid #f87171' }}>
              <b>Error dispatching:</b> {String(dispatchBg.error)}
            </div>
          )}
          <form 
            style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%', maxWidth: '800px', margin: '0 auto' }}
            onSubmit={(e) => {
              e.preventDefault()
              if (!prompt.trim()) return
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
            <input 
              type="text" 
              placeholder="Prompt for background task..." 
              value={prompt} 
              onChange={e => setPrompt(e.target.value)}
              style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--cl-line)', background: 'var(--cl-paper)', color: 'var(--cl-ink-1)' }}
            />
            <input 
              type="text" 
              placeholder="Name (optional)" 
              value={sessionName} 
              onChange={e => setSessionName(e.target.value)}
              style={{ width: '150px', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--cl-line)', background: 'var(--cl-paper)', color: 'var(--cl-ink-1)' }}
            />
            <select
              value={agentName}
              onChange={e => setAgentName(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--cl-line)', background: 'var(--cl-paper)', color: 'var(--cl-ink-1)' }}
            >
              <option value="">No subagent</option>
              {allAgents.map(a => (
                <option key={a.name} value={a.name}>{a.name}</option>
              ))}
            </select>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              title="Override model for this session (passed as --model)"
              style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--cl-line)', background: 'var(--cl-paper)', color: 'var(--cl-ink-1)' }}
            >
              <option value="">Default model</option>
              <option value="opus">Opus 4.7</option>
              <option value="sonnet">Sonnet 4.6</option>
              <option value="haiku">Haiku 4.5</option>
            </select>
            <button 
              type="submit" 
              disabled={!prompt.trim() || dispatchBg.isPending}
              style={{ 
                padding: '8px 16px', borderRadius: '6px', background: 'var(--cl-ink-1)', color: 'var(--cl-paper)', 
                fontWeight: 600, cursor: prompt.trim() && !dispatchBg.isPending ? 'pointer' : 'not-allowed', 
                opacity: prompt.trim() && !dispatchBg.isPending ? 1 : 0.5 
              }}
            >
              {dispatchBg.isPending ? 'Dispatching...' : 'Dispatch'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
