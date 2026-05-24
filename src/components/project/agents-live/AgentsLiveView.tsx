import { useState, useRef, useCallback } from 'react'
import { useLiveSessions, BgSession, SessionSummary, useProjectAgents, useGlobalAgents, useDispatchBackgroundAgent, useDeleteBackgroundAgent } from '../../../hooks/useIPC'
import { Lens } from '../overview/Lens'
import { TopBar } from '../shared/TopBar'

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

function StopButton({ onStop, isStopping }: { onStop: () => void; isStopping: boolean }) {
  const [confirm, setConfirm] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm) {
      if (timerRef.current) clearTimeout(timerRef.current)
      setConfirm(false)
      onStop()
    } else {
      setConfirm(true)
      timerRef.current = setTimeout(() => setConfirm(false), 2000)
    }
  }, [confirm, onStop])

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isStopping}
      title={confirm ? 'Click again to confirm delete' : 'Delete agent (claude rm)'}
      style={{
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        border: `1px solid ${confirm ? '#ef4444' : 'var(--cl-line)'}`,
        background: confirm ? '#fef2f2' : 'transparent',
        color: confirm ? '#ef4444' : 'var(--cl-ink-4)',
        cursor: isStopping ? 'not-allowed' : 'pointer',
        opacity: isStopping ? 0.5 : 1,
        transition: 'all 0.15s',
        flexShrink: 0,
      }}
    >
      {isStopping ? '…' : confirm ? 'confirm?' : 'delete'}
    </button>
  )
}

function SessionRow({
  s,
  showProject,
  onOpen,
  onStop,
  isStopping,
}: {
  s: BgSession
  showProject: boolean
  onOpen: () => void
  onStop: () => void
  isStopping: boolean
}) {
  const st = statusOf(s)
  const subtitle = s.detail || s.result || s.intent || '—'
  const canStop = true
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
        {canStop && <StopButton onStop={onStop} isStopping={isStopping} />}
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
}: {
  onBack: () => void
  project?: Project
  onOpenSession: (project: Project, session: SessionSummary) => void
  embedded?: boolean
}) {
  const projectName = project?.realPath.split('/').pop()
  const { data, isLoading } = useLiveSessions()

  const { data: globalAgents = [] } = useGlobalAgents()
  const { data: projectAgents = [] } = useProjectAgents(project?.realPath || null)
  const allAgents = [...projectAgents, ...globalAgents].filter((a, i, arr) => arr.findIndex(x => x.name === a.name) === i)

  const dispatchBg = useDispatchBackgroundAgent()
  const deleteBg = useDeleteBackgroundAgent()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [agentName, setAgentName] = useState('')
  const [sessionName, setSessionName] = useState('')

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
        <TopBar onBack={onBack} crumbs={[{ label: project ? `Project · Live Agents · ${projectName}` : 'Global · Live Agents' }]} />
      )}

      <div className={embedded ? '' : 'flex-1 overflow-y-auto'}>
        <section className="cl-hero">
          <Lens />
          <div className="cl-eyebrow">
            <span className="pip" />
            <span>{project ? `Project · ${projectName} · background sessions` : 'Global · claude agents'}</span>
          </div>
          <h1 className="cl-h-name static">
            <span className="label-name">Live Agents</span>
            <span className="glyph">.</span>
          </h1>
          <div className="cl-h-meta">
            <span><b>{sessions.length}</b> {sessions.length === 1 ? 'session' : 'sessions'}</span>
            <span className="sep">·</span>
            <span><b>{liveCount}</b> live</span>
          </div>
        </section>

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
                {g.items.map(s => (
                  <SessionRow
                    key={s.id}
                    s={s}
                    showProject={!project}
                    onOpen={() => onOpenSession(
                      project ?? { hash: hashFromCwd(s.cwd), realPath: s.cwd },
                      summaryFor(s),
                    )}
                    onStop={() => {
                      setDeletingId(s.id)
                      deleteBg.mutate(s.id, { onSettled: () => setDeletingId(null) })
                    }}
                    isStopping={deletingId === s.id}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      
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
              dispatchBg.mutate({ cwd: project.realPath, prompt: prompt.trim(), name: sessionName.trim() || undefined, agent: agentName || undefined }, {
                onSuccess: () => {
                  setPrompt('')
                  setSessionName('')
                  setAgentName('')
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
            <button 
              type="submit" 
              disabled={!prompt.trim() || dispatchBg.isLoading}
              style={{ 
                padding: '8px 16px', borderRadius: '6px', background: 'var(--cl-ink-1)', color: 'var(--cl-paper)', 
                fontWeight: 600, cursor: prompt.trim() && !dispatchBg.isLoading ? 'pointer' : 'not-allowed', 
                opacity: prompt.trim() && !dispatchBg.isLoading ? 1 : 0.5 
              }}
            >
              {dispatchBg.isLoading ? 'Dispatching...' : 'Dispatch'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
