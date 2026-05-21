import { ParsedMemory, MEMORY_TYPE_STYLE } from './utils'

export function PathChip({ path }: { path: string }) {
  const parts = path.split('/')
  const file = parts.pop() ?? path
  const dir = parts.join('/') || '/'
  return (
    <div className="flex items-center gap-1.5 bg-[var(--cl-paper-3)] border border-[var(--cl-line)] px-3 py-2 text-[12px] font-mono min-w-0 overflow-hidden" style={{ borderRadius: '2px' }}>
      <span className="text-[var(--cl-ink-3)] truncate shrink-1 min-w-0">{dir}/</span>
      <span className="text-[var(--cl-ink-2)] font-semibold shrink-0">{file}</span>
    </div>
  )
}

export function SectionLabel({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[10px] font-bold text-[var(--cl-ink-3)] uppercase tracking-widest">{label}</span>
      {meta && <span className="text-[10px] text-[var(--cl-ink-2)]">{meta}</span>}
    </div>
  )
}

export function CodeBlock({ code, dark = true, className = '' }: { code: string; dark?: boolean; className?: string }) {
  const lines = code.split('\n').length
  return (
    <div className={`overflow-hidden border ${dark ? 'border-[var(--cl-line)]' : 'border-[var(--cl-line)]'} ${className}`} style={{ borderRadius: '2px' }}>
      <div className={`flex items-center justify-between px-3 py-1.5 text-[10px] ${dark ? 'bg-[var(--cl-paper-3)] text-[var(--cl-ink-3)]' : 'bg-[var(--cl-paper-3)] text-[var(--cl-ink-3)]'}`}>
        <span>{lines} lines</span>
      </div>
      <pre className={`px-4 py-3 text-[12px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-words ${dark ? 'bg-[var(--cl-paper-2)] text-[var(--cl-ink-2)]' : 'bg-[var(--cl-paper-2)] text-[var(--cl-ink-2)]'}`}>
        {code}
      </pre>
    </div>
  )
}

export function MemoryPreviewCard({ parsed }: { parsed: ParsedMemory }) {
  const style = MEMORY_TYPE_STYLE[parsed.type] ?? MEMORY_TYPE_STYLE.user
  return (
    <div className="border border-[var(--cl-violet)] bg-[var(--cl-paper-3)] overflow-hidden" style={{ borderRadius: '2px' }}>
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[var(--cl-violet)]/60 bg-[var(--cl-paper-2)]/90">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-[var(--cl-ink-2)]">{parsed.name || '—'}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 uppercase tracking-wide ${style.badge}`} style={{ borderRadius: '2px' }}>
              {style.label}
            </span>
          </div>
          {parsed.description && (
            <p className="text-[11px] text-[var(--cl-ink-3)] mt-0.5">{parsed.description}</p>
          )}
        </div>
        <span className="text-base shrink-0">🧠</span>
      </div>
      {parsed.body && (
        <div className="px-4 py-3">
          <pre className="text-[12px] text-[var(--cl-ink-3)] whitespace-pre-wrap break-words font-sans leading-relaxed">
            {parsed.body}
          </pre>
        </div>
      )}
    </div>
  )
}
