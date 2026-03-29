import { useState } from 'react'
import Markdown from '../../Markdown'
import { useGlobalClaudeMd } from '../../../hooks/useIPC'

export function GlobalClaudeMdView({ onBack }: { onBack: () => void }) {
  const { data: content, isLoading } = useGlobalClaudeMd()

  return (
    <div className="h-full bg-[#161a26] flex flex-col">
      <div className="border-b border-[#252836] px-8 py-4 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-2.5 py-1.5 text-sm text-[#787e98] hover:text-[#e0e2f0] hover:bg-[#1c2133] rounded-md transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-lg font-semibold text-[#e0e2f0]">Global CLAUDE.md</h1>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="px-8 py-6 max-w-4xl">
          {isLoading ? (
            <p className="text-sm text-zinc-400">Loading...</p>
          ) : !content ? (
            <p className="text-sm text-zinc-400 italic">No global CLAUDE.md found.</p>
          ) : (
            <Markdown>{content}</Markdown>
          )}
        </div>
      </div>
    </div>
  )
}

export function ProjectClaudeMdView({ layer, onBack }: { layer: { filePath: string; content: string; scope: string }; onBack: () => void }) {
  const [showRaw, setShowRaw] = useState(false)

  return (
    <div className="h-full bg-[#161a26] flex flex-col">
      <div className="border-b border-[#252836] px-8 py-4 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-2.5 py-1.5 text-sm text-[#787e98] hover:text-[#e0e2f0] hover:bg-[#1c2133] rounded-md transition-colors"
        >
          ← Back
        </button>
        <h1 className="text-lg font-semibold text-[#e0e2f0]">{layer.filePath}</h1>
        <span className="ml-auto text-xs font-medium px-2 py-1 rounded bg-[#1c2133] text-[#787e98] uppercase tracking-wider">
          {layer.scope}
        </span>
      </div>

      <div className="flex items-center gap-0.5 border-b border-[#252836] bg-[#161a26] px-8 h-10 shrink-0">
        <button
          onClick={() => setShowRaw(false)}
          className={`px-3 py-2 text-[13px] font-medium transition-colors border-b-2 ${
            !showRaw
              ? 'text-[#e0e2f0] border-zinc-900'
              : 'text-zinc-400 border-transparent hover:text-[#787e98]'
          }`}
        >
          View
        </button>
        <button
          onClick={() => setShowRaw(true)}
          className={`px-3 py-2 text-[13px] font-medium transition-colors border-b-2 ${
            showRaw
              ? 'text-[#e0e2f0] border-zinc-900'
              : 'text-zinc-400 border-transparent hover:text-[#787e98]'
          }`}
        >
          Raw
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="px-8 py-6 max-w-4xl">
          {!showRaw ? (
            <Markdown>{layer.content}</Markdown>
          ) : (
            <pre className="bg-zinc-900 text-zinc-100 p-4 rounded-lg font-mono text-[11px] leading-relaxed overflow-x-auto">
              <code>{layer.content}</code>
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
