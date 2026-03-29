import { useGlobalMcp, McpData } from '../../../hooks/useIPC'
import { BackButton } from '../shared/BackButton'
import { SectionTitle } from '../shared/SectionTitle'
import { McpServerCard } from './McpServerCard'

export function GlobalMcpView({ onBack }: { onBack: () => void }) {
  const { data, isLoading } = useGlobalMcp()
  const mcp = data as McpData | undefined

  const total = (mcp?.cloudServers.length ?? 0) + (mcp?.localServers.length ?? 0)
  const totalProjects = mcp?.totalProjects ?? 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-[#1e2130] shrink-0">
        <BackButton label="MCP Servers" onClick={onBack} />
        {!isLoading && total > 0 && (
          <span className="text-[11px] text-[#3d4460] ml-auto tabular-nums">
            {total} server · {totalProjects} projects
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
        {isLoading && (
          <p className="text-[13px] text-zinc-500 italic">Loading...</p>
        )}

        {!isLoading && total === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <div className="w-10 h-10 rounded-xl bg-[#161a26] border border-[#252836] flex items-center justify-center mb-3">
              <svg width="16" height="16" viewBox="0 0 13 13" fill="none">
                <circle cx="6.5" cy="6.5" r="5" stroke="#3d4460" strokeWidth="1.2"/>
                <circle cx="6.5" cy="6.5" r="1.5" fill="#3d4460"/>
                <path d="M6.5 1.5v2M6.5 9v2M1.5 6.5h2M9 6.5h2" stroke="#3d4460" strokeWidth="1.1" strokeLinecap="round"/>
              </svg>
            </div>
            <p className="text-[13px] text-zinc-500 italic">No MCP servers configured</p>
          </div>
        )}

        {!isLoading && (mcp?.cloudServers.length ?? 0) > 0 && (
          <div>
            <SectionTitle>
              <span className="flex items-center gap-1.5">
                Cloud
                <span className="text-[10px] font-mono text-cyan-600 normal-case tracking-normal ml-1">{mcp!.cloudServers.length}</span>
              </span>
            </SectionTitle>
            <div className="space-y-1.5">
              {mcp!.cloudServers.map(s => (
                <McpServerCard key={s.name} server={s} totalProjects={totalProjects} />
              ))}
            </div>
          </div>
        )}

        {!isLoading && (mcp?.localServers.length ?? 0) > 0 && (
          <div>
            <SectionTitle>
              <span className="flex items-center gap-1.5">
                Local
                <span className="text-[10px] font-mono text-amber-600 normal-case tracking-normal ml-1">{mcp!.localServers.length}</span>
              </span>
            </SectionTitle>
            <div className="space-y-1.5">
              {mcp!.localServers.map(s => (
                <McpServerCard key={s.name} server={s} totalProjects={totalProjects} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
