import { useSessionList, useProjectCost, SessionSummary } from '../../../hooks/useIPC'
import { fmt, fmtDate, fmtModel, modelColor } from '../utils'

export function SessionsDetailView({
  project,
  onBack,
  onOpenChat,
}: {
  project: { hash: string; realPath: string }
  onBack: () => void
  onOpenChat: (session: SessionSummary) => void
}) {
  const { data: sessions, isLoading } = useSessionList(project.hash)
  const { data: cost } = useProjectCost(project.hash)
  const projectName = project.realPath.split('/').pop() ?? project.realPath

  const maxTokens = sessions ? Math.max(...sessions.map(s => s.totalTokens), 1) : 1

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--cl-paper)' }}>

      {/* ── BREADCRUMB BAR ── */}
      <nav style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        height: '38px',
        padding: '0 28px',
        background: 'var(--cl-paper-2)',
        borderBottom: '1px solid var(--cl-line)',
      }}>
        <button
          onClick={onBack}
          style={{
            fontFamily: 'var(--cl-mono)',
            fontSize: '10.5px',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--cl-ink-4)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0 14px 0 0',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          {projectName}
        </button>
        <span style={{
          fontFamily: 'var(--cl-mono)',
          fontSize: '10.5px',
          color: 'var(--cl-ink-4)',
          opacity: 0.4,
          marginRight: '14px',
        }}>/</span>
        <span style={{
          fontFamily: 'var(--cl-mono)',
          fontSize: '10.5px',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--cl-ink)',
        }}>
          Sessions
        </span>

        {/* New session button */}
        <button
          onClick={() => window.electronAPI.sessions.newInTerminal(project.realPath)}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 11px',
            background: 'var(--cl-ink)',
            color: 'var(--cl-paper)',
            border: 'none',
            borderRadius: '2px',
            fontFamily: 'var(--cl-sans)',
            fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M12 4v16m8-8H4" />
          </svg>
          New session
        </button>
      </nav>

      {/* ── STAT STRIP ── */}
      {cost && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          background: 'var(--cl-ink)',
          color: 'var(--cl-paper)',
          borderBottom: '1.5px solid var(--cl-ink)',
        }}>
          {[
            { label: 'Sessions', value: String(cost.sessionsCount) },
            { label: 'Total tokens', value: fmt(cost.totalTokens) },
            {
              label: 'Avg / session',
              value: cost.sessionsCount > 0 ? fmt(Math.round(cost.totalTokens / cost.sessionsCount)) : '—',
            },
            { label: 'Est. cost', value: cost.cost != null ? `$${cost.cost.toFixed(4)}` : '—' },
          ].map(({ label, value }, i) => (
            <div key={label} style={{
              padding: '14px 0',
              borderLeft: i > 0 ? '1px solid oklch(0.32 0.012 60)' : 'none',
              paddingLeft: i > 0 ? '24px' : '28px',
            }}>
              <div style={{
                fontFamily: 'var(--cl-mono)',
                fontSize: '9.5px',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                color: 'oklch(0.62 0.005 80)',
              }}>
                {label}
              </div>
              <div style={{
                fontSize: '24px',
                fontWeight: 600,
                letterSpacing: '-0.025em',
                marginTop: '6px',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
              }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── SESSION LIST ── */}
      <div>
        {isLoading && (
          <p style={{
            fontFamily: 'var(--cl-mono)',
            fontSize: '11px',
            color: 'var(--cl-ink-3)',
            padding: '32px 28px',
          }}>
            Loading sessions…
          </p>
        )}

        {sessions && sessions.length > 0 && sessions.map((s: SessionSummary, idx) => {
          const tokenPct = (s.totalTokens / maxTokens) * 100
          const title = s.customTitle || fmtDate(s.date)
          return (
            <div
              key={s.filename}
              onClick={() => onOpenChat(s)}
              style={{
                display: 'grid',
                gridTemplateColumns: '52px 1fr',
                gap: '0',
                borderBottom: '1px solid var(--cl-line)',
                cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--cl-paper-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Index column */}
              <div style={{
                padding: '16px 0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                borderRight: '1px solid var(--cl-line)',
                gap: '6px',
              }}>
                <span style={{
                  fontFamily: 'var(--cl-sans)',
                  fontSize: '18px',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  color: 'var(--cl-ink-3)',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1,
                }}>
                  {String(sessions.length - idx).padStart(2, '0')}
                </span>
              </div>

              {/* Content column */}
              <div style={{ padding: '16px 28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '16px', marginBottom: '10px' }}>
                  <div>
                    <div style={{
                      fontSize: '15px',
                      fontWeight: 600,
                      letterSpacing: '-0.015em',
                      color: 'var(--cl-ink)',
                      lineHeight: 1.2,
                    }}>
                      {title}
                    </div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      marginTop: '4px',
                    }}>
                      {s.model && (
                        <span style={{
                          fontFamily: 'var(--cl-mono)',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: modelColor(s.model),
                          letterSpacing: '0.01em',
                        }}>
                          {fmtModel(s.model)}
                        </span>
                      )}
                      <span style={{
                        fontFamily: 'var(--cl-mono)',
                        fontSize: '10.5px',
                        color: 'var(--cl-ink-4)',
                      }}>
                        {s.filename}
                      </span>
                    </div>
                  </div>

                  {/* Resume on hover */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      window.electronAPI.sessions.openInTerminal(project.realPath, s.filename.replace('.jsonl', ''))
                    }}
                    style={{
                      flexShrink: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '5px 10px',
                      background: 'transparent',
                      border: '1px solid var(--cl-line)',
                      borderRadius: '2px',
                      fontFamily: 'var(--cl-mono)',
                      fontSize: '10px',
                      letterSpacing: '0.10em',
                      textTransform: 'uppercase',
                      color: 'var(--cl-ink-3)',
                      cursor: 'pointer',
                      opacity: 0.6,
                      transition: 'opacity 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
                    title="Resume this session"
                  >
                    <span style={{
                      width: '7px',
                      height: '7px',
                      background: 'var(--cl-accent)',
                      clipPath: 'polygon(0 0, 100% 50%, 0 100%)',
                      display: 'inline-block',
                    }} />
                    Resume
                  </button>
                </div>

                {/* Stat row */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, auto) 1fr',
                  gap: '16px',
                  alignItems: 'center',
                }}>
                  {[
                    { label: 'Input', value: fmt(s.inputTokens) },
                    { label: 'Output', value: fmt(s.outputTokens) },
                    { label: 'Total', value: fmt(s.totalTokens) },
                    { label: 'Msgs', value: String(s.messageCount) },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{
                        fontFamily: 'var(--cl-mono)',
                        fontSize: '9.5px',
                        letterSpacing: '0.18em',
                        textTransform: 'uppercase',
                        color: 'var(--cl-ink-4)',
                        marginBottom: '2px',
                      }}>
                        {label}
                      </div>
                      <div style={{
                        fontFamily: 'var(--cl-mono)',
                        fontSize: '12.5px',
                        fontWeight: 500,
                        color: 'var(--cl-ink-2)',
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {value}
                      </div>
                    </div>
                  ))}

                  {/* Token bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      flex: 1,
                      height: '2px',
                      background: 'var(--cl-line)',
                      position: 'relative',
                      borderRadius: '1px',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        height: '100%',
                        background: 'var(--cl-accent)',
                        width: `${tokenPct}%`,
                      }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {sessions?.length === 0 && (
          <p style={{
            fontFamily: 'var(--cl-mono)',
            fontSize: '11px',
            color: 'var(--cl-ink-3)',
            fontStyle: 'italic',
            padding: '32px 28px',
          }}>
            No sessions found.
          </p>
        )}
      </div>
    </div>
  )
}
