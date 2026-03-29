import { useState } from 'react'
import Markdown from '../../Markdown'
import { Agent } from '../../../hooks/useIPC'
import { AgentPropertiesPanel } from './AgentPropertiesPanel'

export function AgentDetailView({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  const [showRaw, setShowRaw] = useState(false)

  return (
    <div className="h-full flex flex-col bg-[#161a26]">
      <div className="shrink-0 border-b border-[#252836] px-6 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[12px] text-zinc-400 hover:text-[#9096b0] transition-colors"
        >
          <span className="text-[10px]">←</span>
          Agents
        </button>
        <span className="text-zinc-200 text-[11px]">/</span>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] shrink-0">🤖</span>
          <span className="text-[13px] font-semibold text-[#e0e2f0] truncate">{agent.name}</span>
          <span className={`shrink-0 text-[9px] font-bold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded ${
            agent.scope === 'global'
              ? 'bg-blue-950/20 text-blue-400 ring-1 ring-blue-700/30'
              : 'bg-emerald-950/20 text-emerald-400 ring-1 ring-emerald-700/30'
          }`}>
            {agent.scope}
          </span>
        </div>
      </div>

      {agent.description && (
        <div className="shrink-0 px-6 py-2 bg-[#161a26] border-b border-[#1c2030]">
          <p className="text-[11px] text-zinc-500 leading-relaxed">{agent.description}</p>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="shrink-0 border-b border-[#1c2030] px-6 flex items-center gap-0.5 h-8">
            {(['View', 'Raw'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setShowRaw(tab === 'Raw')}
                className={`px-3 h-full text-[11px] font-medium transition-colors border-b-2 -mb-px ${
                  (tab === 'Raw') === showRaw
                    ? 'text-[#e0e2f0] border-zinc-800'
                    : 'text-zinc-400 border-transparent hover:text-[#787e98]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-auto">
            <div className="px-8 py-6 max-w-3xl">
              {!showRaw ? (
                <Markdown>{agent.content}</Markdown>
              ) : (
                <pre className="bg-zinc-950 text-zinc-200 p-5 rounded-lg font-mono text-[11px] leading-relaxed overflow-x-auto">
                  <code>{agent.rawContent}</code>
                </pre>
              )}
            </div>
          </div>
        </div>

        <AgentPropertiesPanel agent={agent} />
      </div>
    </div>
  )
}
