import { useLiveSessions, BgSession, SessionSummary } from '../../../hooks/useIPC'
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
  }
}

// ─── Status mapping ────────────────────────────────────────────────────────────

type Bucket = 'working' | 'ready' | 'completed' | 'failed' | 'stopped'

interface StatusInfo {
  bucket: Bucket
  label: string
  color: string
  pulse: boolean
}

function statusOf(s: BgSession): StatusInfo {
  if (s.state === 'done') return { bucket: 'completed', label: 'Completed', color: '#22c55e', pulse: false }
  if (s.state === 'failed') return { bucket: 'failed', label: 'Failed', color: '#ef4444', pulse: false }
  if (s.state === 'stopped' || (!s.alive && s.state !== 'running'))
    return { bucket: 'stopped', label: 'Stopped', color: '#94a3b8', pulse: false }
  if (s.alive && (s.tempo === 'thinking' || s.tempo === 'busy' || s.inFlightTasks > 0))
    return { bucket: 'working', label: s.tempo === 'thinking' ? 'Thinking' : 'Working', color: '#6366f1', pulse: true }
  if (!s.alive) return { bucket: 'stopped', label: 'Asleep', color: '#94a3b8', pulse: false }
  return { bucket: 'ready', label: 'Ready', color: '#0ea5e9', pulse: false }
}

const BUCKET_ORDER: { key: Bucket; title: string; hint: string }[] = [
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

function SessionRow({ s, showProject, onOpen }: { s: BgSession; showProject: boolean; onOpen: () => void }) {
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
          {s.template === 'bg' && (
            <span
              style={{
                fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'var(--cl-ink-4)', border: '1px solid var(--cl-line)',
                borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--font-mono)',
              }}
            >
              bg
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
      <span className="t-meta" style={{ textAlign: 'right' }}>
        <b style={{ color: st.color }}>{st.label}</b>
        {s.inFlightTasks > 0 && <> · {s.inFlightTasks} task</>}
        <br />
        <span style={{ color: 'var(--cl-ink-4)' }}>{relTime(s.updatedAt)}</span>
      </span>
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
            <span className="sep">·</span>
            <span>auto-refresh 4s</span>
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
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
