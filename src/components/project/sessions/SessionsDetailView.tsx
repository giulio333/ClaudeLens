import { useSessionList, useProjectCost, SessionSummary } from '../../../hooks/useIPC'
import { fmt, fmtDate, fmtModel, modelColor } from '../utils'
import { BackButton } from '../shared/BackButton'
import { StatChip } from '../shared/StatChip'

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
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 bg-[#0d0f14]/95 backdrop-blur-sm border-b border-[#252836] px-8 py-4">
        <div className="flex items-center gap-4 mb-3">
          <BackButton label="Overview" onClick={onBack} />
          <span className="text-zinc-300">·</span>
          <span className="text-[13px] font-medium text-[#9096b0]">{projectName}</span>
        </div>
        <div className="flex items-end justify-between">
          <h1 className="text-[17px] font-semibold text-[#e0e2f0]">Sessions</h1>
          <div className="flex items-center gap-2">
            <StatChip label="Sessions" value={cost ? String(cost.sessionsCount) : '—'} />
            <StatChip label="Total tokens" value={cost ? fmt(cost.totalTokens) : '—'} />
            <StatChip label="Avg / session" value={
              cost && cost.sessionsCount > 0
                ? fmt(Math.round(cost.totalTokens / cost.sessionsCount))
                : '—'
            } />
            <button
              onClick={() => window.electronAPI.sessions.newInTerminal(project.realPath)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-medium transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New session
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 py-6">
        {isLoading && <p className="text-sm text-zinc-400">Loading sessions...</p>}

        {sessions && sessions.length > 0 && (
          <div className="space-y-2">
            {sessions.map((s: SessionSummary) => {
              const tokenPct = (s.totalTokens / maxTokens) * 100
              return (
                <div key={s.filename} onClick={() => onOpenChat(s)} className="bg-[#161a26] border border-[#252836] rounded-xl p-4 hover:border-indigo-600/60 hover:shadow-md cursor-pointer transition-all group">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-[13px] font-semibold text-[#e0e2f0]">{s.customTitle || fmtDate(s.date)}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {s.model && (
                          <span
                            className="text-[11px] font-semibold"
                            style={{ color: modelColor(s.model) }}
                          >
                            {fmtModel(s.model)}
                          </span>
                        )}
                        <span className="text-[11px] text-zinc-400 font-mono">{s.filename}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          window.electronAPI.sessions.openInTerminal(project.realPath, s.filename.replace('.jsonl', ''))
                        }}
                        className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-950/20 hover:bg-indigo-900/30 text-indigo-400 text-[11px] font-medium transition-all"
                        title="Resume this session in Claude"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        Resume
                      </button>
                      <span className="text-zinc-300 group-hover:text-indigo-400 transition-colors text-sm">→</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-3 mb-3.5">
                    {[
                      { label: 'Input tokens', value: fmt(s.inputTokens) },
                      { label: 'Output tokens', value: fmt(s.outputTokens) },
                      { label: 'Total', value: fmt(s.totalTokens) },
                      { label: 'Messages', value: String(s.messageCount) },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-0.5">{label}</div>
                        <div className="text-[13px] font-medium text-[#9096b0] tabular-nums">{value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-400 w-14 shrink-0">Token</span>
                      <div className="flex-1 h-1.5 bg-[#1c2133] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-400 rounded-full transition-all"
                          style={{ width: `${tokenPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {sessions?.length === 0 && (
          <p className="text-sm text-zinc-400 italic">No sessions found.</p>
        )}
      </div>
    </div>
  )
}
