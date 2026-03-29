import { useState, useEffect, useRef, useCallback } from 'react'
import { LiveEvent, ClaudeProcess } from '../hooks/useIPC'
import { UsedItem, VISIBLE_TYPES, MAX_EVENTS, CHART_H } from './live/types'
import { ActivityChart } from './live/ActivityChart'
import { ProjectContextPanel } from './live/ProjectContextPanel'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getArg(input: Record<string, unknown>): string {
  if (input.file_path) return '…/' + String(input.file_path).split('/').slice(-2).join('/')
  if (input.command)   return String(input.command).slice(0, 48)
  if (input.pattern)   return String(input.pattern).slice(0, 48)
  if (input.query)     return String(input.query).slice(0, 48)
  return ''
}

function shortPath(p: string): string {
  return '/' + p.split('/').filter(Boolean).slice(-2).join('/')
}

// ─── Componente principale ────────────────────────────────────────────────────

export default function LiveMonitor({
  project,
  onBack,
}: {
  project: { hash: string; realPath: string }
  onBack: () => void
}) {
  const [events, setEvents]         = useState<LiveEvent[]>([])
  const [processes, setProcesses]   = useState<ClaudeProcess[]>([])
  const [watching, setWatching]     = useState(false)
  const [claudeStatus, setClaudeStatus] = useState<'idle' | 'thinking' | 'busy'>('idle')
  const [activeTool, setActiveTool] = useState<{ name: string; arg: string; status: 'running' | 'done'; finalDuration?: number } | null>(null)
  const [usedItems, setUsedItems]   = useState<UsedItem[]>([])
  const [elapsed, setElapsed]       = useState(0)
  const lastUsedIdRef = useRef<string | null>(null)
  const toolStartRef = useRef<number>(0)
  const projectName  = project.realPath.split('/').pop() ?? project.realPath

  const toolCount  = events.filter(e => e.type === 'tool_use').length
  const thinkCount = events.filter(e => e.type === 'thinking').length
  const errCount   = events.filter(e => e.type === 'tool_result' && e.isError).length

  // Timer elapsed — attivo solo mentre il tool è in esecuzione
  useEffect(() => {
    if (!activeTool || activeTool.status === 'done') return
    const t = setInterval(() => setElapsed(Date.now() - toolStartRef.current), 100)
    return () => clearInterval(t)
  }, [activeTool])

  // Polling processi
  useEffect(() => {
    async function load() {
      try {
        const r = await window.electronAPI.live.getProcesses()
        if (r.data) setProcesses(r.data)
      } catch { /* ignore */ }
    }
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [])

  const handleEvent = useCallback((ev: LiveEvent) => {
    // Status change — gestito separatamente, non aggiunto agli eventi chart
    if (ev.type === 'status_change') {
      setClaudeStatus(ev.content as 'idle' | 'thinking' | 'busy')
      return
    }

    if (!VISIBLE_TYPES.has(ev.type)) return

    setEvents(prev => {
      const next = [...prev, ev]
      return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
    })

    if (ev.type === 'tool_use') {
      toolStartRef.current = Date.now()
      setElapsed(0)
      const arg = ev.toolInput ? getArg(ev.toolInput) : ''
      setActiveTool({ name: ev.toolName ?? '?', arg, status: 'running' })

      // Rileva MCP (mcp__<server>__<tool>) e Agent
      const tname = ev.toolName ?? ''
      if (tname.startsWith('mcp__')) {
        const parts = tname.split('__')
        const server = parts[1] ?? ''
        const tool   = parts.slice(2).join('_')
        lastUsedIdRef.current = ev.id
        setUsedItems(prev => [
          { id: ev.id, category: 'mcp', label: tool, server, status: 'running' },
          ...prev,
        ])
      } else if (tname === 'Agent') {
        const subtype = (ev.toolInput?.subagent_type as string | undefined) ?? 'agent'
        lastUsedIdRef.current = ev.id
        setUsedItems(prev => [
          { id: ev.id, category: 'agent', label: subtype, status: 'running' },
          ...prev,
        ])
      }
    }

    if (ev.type === 'tool_result') {
      const duration = Date.now() - toolStartRef.current
      setActiveTool(prev => prev ? { ...prev, status: 'done', finalDuration: duration } : null)
      // Aggiorna status dell'ultimo item usato
      const lastId = lastUsedIdRef.current
      if (lastId) {
        setUsedItems(prev => prev.map(item =>
          item.id === lastId && item.status === 'running'
            ? { ...item, status: ev.isError ? 'error' : 'done', duration }
            : item
        ))
        lastUsedIdRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    window.electronAPI.live.onEvent(e => handleEvent(e as LiveEvent))
    window.electronAPI.live.startWatch(project.hash).then(r => {
      if (r.data?.started) setWatching(true)
    })
    return () => { window.electronAPI.live.stopWatch() }
  }, [project.hash, handleEvent])

  const activeProcs = processes.filter(p =>
    p.cwd === project.realPath || p.cwd.startsWith(project.realPath + '/')
  )

  const toolFreq = events
    .filter(e => e.type === 'tool_use')
    .reduce<Record<string, number>>((a, e) => {
      const n = e.toolName ?? '?'; a[n] = (a[n] ?? 0) + 1; return a
    }, {})

  return (
    <div
      className="flex flex-col h-full overflow-hidden relative"
      style={{ background: '#03040a', fontFamily: "'JetBrains Mono','Cascadia Code','Fira Code',monospace" }}
    >
      <style>{`
        @keyframes blink     { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes ringPulse { 0%,100%{opacity:.6;transform:scale(1)} 50%{opacity:0;transform:scale(2.4)} }
        @keyframes dotPulse  { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes progress  { 0%{transform:translateX(-100%)} 100%{transform:translateX(400%)} }
        @keyframes glow         { 0%,100%{text-shadow:0 0 30px rgba(0,229,255,0.3)} 50%{text-shadow:0 0 60px rgba(0,229,255,0.7)} }
        @keyframes thinkPulse   { 0%,100%{box-shadow:0 0 0 0 rgba(168,85,247,0.5)} 60%{box-shadow:0 0 0 8px rgba(168,85,247,0)} }
        @keyframes busyPulse    { 0%,100%{box-shadow:0 0 0 0 rgba(0,229,255,0.6)} 60%{box-shadow:0 0 0 8px rgba(0,229,255,0)} }
        .no-scrollbar::-webkit-scrollbar { display:none }
        .no-scrollbar { scrollbar-width:none }
      `}</style>

      {/* Grid bg */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(rgba(0,229,255,0.022) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,0.022) 1px,transparent 1px)',
        backgroundSize: '48px 48px',
      }} />
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.035) 3px,rgba(0,0,0,0.035) 4px)',
      }} />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="relative z-10 shrink-0 flex items-center gap-3 px-5 py-2.5 border-b"
        style={{ borderColor: 'rgba(0,229,255,0.1)', background: 'rgba(3,4,10,0.92)' }}
      >
        <button onClick={onBack} className="flex items-center gap-1.5 transition-colors"
          style={{ color: '#2e3650' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#9096b0')}
          onMouseLeave={e => (e.currentTarget.style.color = '#2e3650')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M7.5 2.5L4 6l3.5 3.5" />
          </svg>
          <span className="text-[11px]">Back</span>
        </button>
        <div className="w-px h-4" style={{ background: 'rgba(0,229,255,0.12)' }} />

        {/* Badge LIVE */}
        <div className="flex items-center gap-2">
          <div className="relative w-2.5 h-2.5">
            <div className="absolute inset-0 rounded-full" style={{
              background: watching ? '#00e5ff' : '#2e3650',
              animation: watching ? 'dotPulse 2s ease-in-out infinite' : undefined,
            }} />
            {watching && <div className="absolute inset-0 rounded-full" style={{
              background: 'rgba(0,229,255,0.4)', animation: 'ringPulse 2s ease-in-out infinite',
            }} />}
          </div>
          <span className="text-[10px] font-bold tracking-[0.2em]"
            style={{ color: watching ? '#00e5ff' : '#2e3650' }}>
            {watching ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        <div className="w-px h-4" style={{ background: 'rgba(0,229,255,0.12)' }} />

        {/* Badge STATUS — il dato fondamentale */}
        {(() => {
          const cfg = {
            idle:     { label: 'IDLE',     color: '#4a5568', dot: '#4a5568', anim: undefined as string | undefined },
            thinking: { label: 'THINKING', color: '#a855f7', dot: '#a855f7', anim: 'thinkPulse 1.6s ease-in-out infinite' },
            busy:     { label: 'BUSY',     color: '#00e5ff', dot: '#00e5ff', anim: 'busyPulse 1s ease-in-out infinite' },
          }[claudeStatus]
          return (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full" style={{
              background: claudeStatus === 'idle' ? 'rgba(74,85,104,0.1)' : claudeStatus === 'thinking' ? 'rgba(168,85,247,0.1)' : 'rgba(0,229,255,0.1)',
              border: `1px solid ${claudeStatus === 'idle' ? 'rgba(74,85,104,0.2)' : claudeStatus === 'thinking' ? 'rgba(168,85,247,0.25)' : 'rgba(0,229,255,0.25)'}`,
            }}>
              <div className="w-2 h-2 rounded-full shrink-0" style={{
                background: cfg.dot,
                animation: cfg.anim,
              }} />
              <span className="text-[10px] font-bold tracking-[0.18em]" style={{ color: cfg.color }}>
                {cfg.label}
              </span>
            </div>
          )
        })()}

        <div className="w-px h-4" style={{ background: 'rgba(0,229,255,0.12)' }} />
        <span className="text-[12px] font-medium" style={{ color: '#787e98' }}>{projectName}</span>
        <div className="flex-1" />

        <div className="flex items-center gap-5">
          {[
            { l: 'TOOL CALLS', v: toolCount,  c: '#00e5ff' },
            { l: 'THINKING',   v: thinkCount, c: '#a855f7' },
            { l: 'ERRORS',     v: errCount,   c: errCount > 0 ? '#ff453a' : '#2e3650' },
          ].map(({ l, v, c }) => (
            <div key={l} className="flex flex-col items-end">
              <span className="text-[7.5px] font-bold tracking-[0.16em]" style={{ color: '#2e3650' }}>{l}</span>
              <span className="text-[17px] font-bold tabular-nums leading-none" style={{ color: c }}>{v}</span>
            </div>
          ))}
        </div>
      </header>

      {/* ── Top area: 3 colonne ──────────────────────────────────────────── */}
      <div className="relative z-10 flex overflow-hidden" style={{ flex: '1 1 0', minHeight: 0 }}>

        {/* Sinistra: processo + frequenza */}
        <aside className="w-[190px] shrink-0 flex flex-col border-r overflow-hidden"
          style={{ borderColor: 'rgba(0,229,255,0.08)', background: 'rgba(3,4,10,0.65)' }}
        >
          <section className="p-4 border-b shrink-0" style={{ borderColor: 'rgba(0,229,255,0.07)' }}>
            <div className="text-[7.5px] font-bold tracking-[0.22em] mb-3" style={{ color: '#2e3650' }}>PROCESS</div>
            {activeProcs.length === 0 ? (
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#2e3650' }} />
                <span className="text-[10px]" style={{ color: '#2e3650' }}>None detected</span>
              </div>
            ) : activeProcs.map(p => (
              <div key={p.pid} className="flex items-start gap-2">
                <div className="relative shrink-0 mt-1">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#22d858' }} />
                  <div className="absolute inset-0 rounded-full" style={{
                    background: 'rgba(34,216,88,0.4)', animation: 'ringPulse 2s ease-in-out infinite',
                  }} />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-bold" style={{ color: '#22d858' }}>PID {p.pid}</div>
                  <div className="text-[9px] font-mono truncate" style={{ color: '#3d4460' }}>{shortPath(p.cwd)}</div>
                </div>
              </div>
            ))}
          </section>

          <section className="p-4 flex-1 overflow-hidden">
            <div className="text-[7.5px] font-bold tracking-[0.22em] mb-3" style={{ color: '#2e3650' }}>TOOLS</div>
            {Object.keys(toolFreq).length === 0 ? (
              <span className="text-[10px]" style={{ color: '#2e3650' }}>— none</span>
            ) : (
              <div className="space-y-1.5">
                {Object.entries(toolFreq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => {
                  const maxC = Math.max(...Object.values(toolFreq))
                  return (
                    <div key={name} className="flex items-center gap-2">
                      <span className="text-[9.5px] font-mono truncate flex-1" style={{ color: '#787e98' }}>{name}</span>
                      <div className="w-14 h-[3px] rounded-full overflow-hidden shrink-0" style={{ background: 'rgba(0,229,255,0.08)' }}>
                        <div className="h-full rounded-full" style={{
                          width: `${Math.round((count / maxC) * 100)}%`,
                          background: 'linear-gradient(90deg,#00e5ff,#00bcd4)',
                          transition: 'width 0.4s ease',
                        }} />
                      </div>
                      <span className="text-[9.5px] font-bold tabular-nums w-4 text-right shrink-0" style={{ color: '#00e5ff' }}>{count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </aside>

        {/* Centro: spotlight tool attivo */}
        <div className="flex-1 flex items-center justify-center p-8 overflow-hidden">
          {activeTool ? (
            <div className="flex flex-col items-center gap-4 text-center">
              {/* Nome tool — colore pieno se running, opaco se done */}
              <div
                className="text-[42px] font-bold tracking-tight leading-none"
                style={{
                  color: activeTool.status === 'running' ? '#00e5ff' : 'rgba(0,229,255,0.45)',
                  animation: activeTool.status === 'running' ? 'glow 2s ease-in-out infinite' : undefined,
                }}
              >
                {activeTool.name}
              </div>

              {/* Arg */}
              {activeTool.arg && (
                <div className="text-[11px] font-mono px-4 py-2 rounded-lg" style={{
                  background: 'rgba(0,229,255,0.05)',
                  border: `1px solid ${activeTool.status === 'running' ? 'rgba(0,229,255,0.16)' : 'rgba(0,229,255,0.08)'}`,
                  color: activeTool.status === 'running' ? 'rgba(0,229,255,0.55)' : 'rgba(0,229,255,0.3)',
                  maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {activeTool.arg}
                </div>
              )}

              {/* Barra progresso o linea statica */}
              <div className="w-40 h-px rounded-full overflow-hidden" style={{
                background: activeTool.status === 'running' ? 'rgba(0,229,255,0.1)' : 'rgba(0,229,255,0.06)',
              }}>
                {activeTool.status === 'running' && (
                  <div className="h-full w-16 rounded-full" style={{
                    background: 'linear-gradient(90deg,transparent,#00e5ff,transparent)',
                    animation: 'progress 1.4s ease-in-out infinite',
                  }} />
                )}
              </div>

              {/* Tempo + badge stato */}
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-mono tabular-nums" style={{
                  color: activeTool.status === 'running' ? '#3d4460' : '#2e3650',
                }}>
                  {activeTool.status === 'running'
                    ? `${(elapsed / 1000).toFixed(1)}s`
                    : `${((activeTool.finalDuration ?? 0) / 1000).toFixed(2)}s`
                  }
                </span>
                {activeTool.status === 'done' && (
                  <span
                    className="text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(34,216,88,0.1)', border: '1px solid rgba(34,216,88,0.2)', color: '#22d858' }}
                  >
                    DONE
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-5">
              {/* Cerchio animato che riflette lo status */}
              {claudeStatus === 'idle' && (
                <>
                  <div className="w-16 h-16 rounded-full border flex items-center justify-center" style={{
                    borderColor: 'rgba(74,85,104,0.25)',
                  }}>
                    <div className="w-4 h-4 rounded-full" style={{ background: 'rgba(74,85,104,0.3)' }} />
                  </div>
                  <p className="text-[11px] font-bold tracking-[0.25em]" style={{ color: '#4a5568' }}>IDLE</p>
                </>
              )}
              {claudeStatus === 'thinking' && (
                <>
                  <div className="w-16 h-16 rounded-full border-2 flex items-center justify-center" style={{
                    borderColor: 'rgba(168,85,247,0.4)', animation: 'thinkPulse 1.6s ease-in-out infinite',
                  }}>
                    <div className="w-5 h-5 rounded-full" style={{ background: 'rgba(168,85,247,0.4)', animation: 'dotPulse 1.6s ease-in-out infinite' }} />
                  </div>
                  <p className="text-[11px] font-bold tracking-[0.25em]" style={{ color: '#a855f7' }}>THINKING</p>
                </>
              )}
              {claudeStatus === 'busy' && (
                <>
                  <div className="w-16 h-16 rounded-full border-2 flex items-center justify-center" style={{
                    borderColor: 'rgba(0,229,255,0.4)', animation: 'busyPulse 1s ease-in-out infinite',
                  }}>
                    <div className="w-5 h-5 rounded-full" style={{ background: 'rgba(0,229,255,0.35)', animation: 'dotPulse 1s ease-in-out infinite' }} />
                  </div>
                  <p className="text-[11px] font-bold tracking-[0.25em]" style={{ color: '#00e5ff' }}>BUSY</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Destra: project context */}
        <aside className="w-[210px] shrink-0 flex flex-col border-l"
          style={{ borderColor: 'rgba(0,229,255,0.08)', background: 'rgba(3,4,10,0.65)' }}
        >
          <div className="px-3 py-3 border-b shrink-0" style={{ borderColor: 'rgba(0,229,255,0.07)' }}>
            <span className="text-[7.5px] font-bold tracking-[0.22em]" style={{ color: '#2e3650' }}>PROJECT CONTEXT</span>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            <ProjectContextPanel usedItems={usedItems} />
          </div>
        </aside>
      </div>

      {/* ── Bottom: activity chart ───────────────────────────────────────── */}
      <div
        className="relative z-10 shrink-0 border-t"
        style={{ borderColor: 'rgba(0,229,255,0.1)', background: 'rgba(3,4,10,0.88)', height: CHART_H }}
      >
        {/* Label + legenda */}
        <div className="absolute top-2 left-3 right-3 z-20 flex items-center gap-3 pointer-events-none">
          <span className="text-[7px] font-bold tracking-[0.25em]" style={{ color: '#2e3650' }}>ACTIVITY</span>
          <div className="flex items-center gap-3 ml-2">
            {([['call','#00e5ff'],['think','#a855f7'],['result','#22d858'],['error','#ff453a']] as const).map(([l,c])=>(
              <div key={l} className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: c, opacity: 0.7 }} />
                <span className="text-[6.5px] font-bold tracking-widest uppercase" style={{ color: c, opacity: 0.5 }}>{l}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-5 h-full">
          <ActivityChart events={events} />
        </div>
      </div>
    </div>
  )
}
