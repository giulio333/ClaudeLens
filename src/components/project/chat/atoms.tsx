import { ParsedMemory, MEMORY_TYPE_STYLE } from './utils'

export function PathChip({ path }: { path: string }) {
  const parts = path.split('/')
  const file = parts.pop() ?? path
  const dir = parts.join('/') || '/'
  return (
    <div className="flex items-center gap-1.5 bg-[#1c2133] border border-[#252836] rounded-lg px-3 py-2 text-[12px] font-mono min-w-0 overflow-hidden">
      <span className="text-zinc-400 truncate shrink-1 min-w-0">{dir}/</span>
      <span className="text-[#c4c8e0] font-semibold shrink-0">{file}</span>
    </div>
  )
}

export function SectionLabel({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{label}</span>
      {meta && <span className="text-[10px] text-zinc-300">{meta}</span>}
    </div>
  )
}

export function CodeBlock({ code, dark = true, className = '' }: { code: string; dark?: boolean; className?: string }) {
  const lines = code.split('\n').length
  return (
    <div className={`rounded-lg overflow-hidden border ${dark ? 'border-zinc-800' : 'border-[#252836]'} ${className}`}>
      <div className={`flex items-center justify-between px-3 py-1.5 text-[10px] ${dark ? 'bg-zinc-800 text-zinc-400' : 'bg-[#1c2133] text-zinc-500'}`}>
        <span>{lines} lines</span>
      </div>
      <pre className={`px-4 py-3 text-[12px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-words ${dark ? 'bg-zinc-900 text-zinc-200' : 'bg-[#161a26] text-[#c4c8e0]'}`}>
        {code}
      </pre>
    </div>
  )
}

export function MemoryPreviewCard({ parsed }: { parsed: ParsedMemory }) {
  const style = MEMORY_TYPE_STYLE[parsed.type] ?? MEMORY_TYPE_STYLE.user
  return (
    <div className="rounded-xl border border-violet-700/40 bg-violet-950/15 overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-violet-700/40/60 bg-[#161a26]/90">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-[#c4c8e0]">{parsed.name || '—'}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${style.badge}`}>
              {style.label}
            </span>
          </div>
          {parsed.description && (
            <p className="text-[11px] text-zinc-500 mt-0.5">{parsed.description}</p>
          )}
        </div>
        <span className="text-base shrink-0">🧠</span>
      </div>
      {parsed.body && (
        <div className="px-4 py-3">
          <pre className="text-[12px] text-[#9096b0] whitespace-pre-wrap break-words font-sans leading-relaxed">
            {parsed.body}
          </pre>
        </div>
      )}
    </div>
  )
}
