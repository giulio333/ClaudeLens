import { useState } from 'react'
import { ToolGroup, isMemoryFile, resolveToolIcon } from './utils'

export function ToolGroupCard({ group, showDetails, onOpenDetail }: {
  group: ToolGroup
  showDetails: boolean
  onOpenDetail: () => void
}) {
  const [open, setOpen] = useState(false)
  const { use, result } = group
  const isMemory = isMemoryFile(use.input as Record<string, unknown>)
  const icon = resolveToolIcon(use.name, use.input as Record<string, unknown>)
  const inputPreview = (
    use.input.description as string ??
    use.input.command as string ??
    use.input.file_path as string ??
    use.input.pattern as string ??
    use.input.prompt as string ??
    ''
  )
  const resultPreview = result ? result.content.split('\n')[0]?.slice(0, 80) ?? '' : null
  const hasExpandable = showDetails || (result && result.content.length > 80)

  return (
    <div className={`border overflow-hidden text-[12px] ${isMemory ? 'border-[var(--cl-violet)] bg-[var(--cl-paper-3)]/30' : 'border-[var(--cl-line)] bg-[var(--cl-paper-3)]'}`} style={{ borderRadius: '2px' }}>
      <div className="flex items-center">
        <button
          onClick={() => hasExpandable && setOpen(o => !o)}
          className={`flex-1 flex items-center gap-2 px-3 py-2 text-left transition-colors ${isMemory ? 'hover:bg-[var(--cl-paper-3)]' : 'hover:bg-[var(--cl-paper-3)]'} ${!hasExpandable ? 'cursor-default' : ''}`}
        >
          <span className="text-[13px] shrink-0">{icon}</span>
          <span className="font-mono font-semibold text-[var(--cl-ink-3)] shrink-0">{use.name}</span>
          {inputPreview && !open && (
            <span className="text-[var(--cl-ink-3)] text-[11px] truncate">{String(inputPreview).slice(0, 55)}</span>
          )}
          {isMemory && (
            <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 bg-[var(--cl-violet)] text-[var(--cl-paper)] border border-[var(--cl-violet)] uppercase tracking-wide" style={{ borderRadius: '2px' }}>Memory</span>
          )}
          {hasExpandable && (
            <span className="ml-auto text-[var(--cl-ink-3)] text-[10px] shrink-0 pr-1">{open ? '▲' : '▼'}</span>
          )}
        </button>
        {showDetails && (
          <button
            onClick={e => { e.stopPropagation(); onOpenDetail() }}
            className="shrink-0 px-2.5 py-2 border-l border-[var(--cl-line)] text-[var(--cl-ink-3)] hover:text-[var(--cl-accent-ink)] hover:bg-[var(--cl-accent-soft)]/20 transition-colors"
            title="Open detail"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3" strokeLinecap="round"/>
              <path d="M10 2h4v4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 2L8 8" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {result && !open && (
        <div className={`flex items-center gap-2 px-3 py-1.5 border-t text-[11px] ${
          result.isError
            ? 'border-[var(--cl-danger)] bg-[var(--cl-danger-soft)] text-[var(--cl-danger)]'
            : 'border-[var(--cl-ok)] bg-[var(--cl-paper-3)] text-[var(--cl-ok)]'
        }`}>
          <span className="shrink-0">{result.isError ? '⚠️' : '✓'}</span>
          <span className="truncate font-mono text-[10px] opacity-75">{resultPreview}</span>
        </div>
      )}

      {open && (
        <div className="border-t border-[var(--cl-line)] bg-[var(--cl-paper-2)]/90">
          {showDetails && (
            <div className="px-3 py-2 border-b border-[var(--cl-line-soft)]">
              <div className="text-[10px] font-semibold text-[var(--cl-ink-3)] uppercase tracking-wider mb-1">Input</div>
              <pre className="text-[11px] text-[var(--cl-ink-3)] whitespace-pre-wrap break-words font-mono leading-relaxed">
                {JSON.stringify(use.input, null, 2)}
              </pre>
            </div>
          )}
          {result && (
            <div className={`px-3 py-2 ${result.isError ? 'bg-[var(--cl-danger-soft)]/50' : ''}`}>
              <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${result.isError ? 'text-[var(--cl-danger)]' : 'text-[var(--cl-ok)]'}`}>
                {result.isError ? '⚠️ Error' : '✓ Result'}
              </div>
              <pre className={`text-[11px] whitespace-pre-wrap break-words font-mono leading-relaxed max-h-60 overflow-y-auto ${result.isError ? 'text-[var(--cl-danger)]' : 'text-[var(--cl-ink-3)]'}`}>
                {result.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
