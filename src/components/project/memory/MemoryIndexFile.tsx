import { useState } from 'react'
import Markdown from '../../Markdown'

export function MemoryIndexFile({ memoryMd }: { memoryMd: { content: string; lineCount: number } }) {
  const [open, setOpen] = useState(false)
  const pct = Math.min((memoryMd.lineCount / 200) * 100, 100)
  const isWarning = memoryMd.lineCount > 160
  const isOver = memoryMd.lineCount >= 200

  const iconColor = isOver ? 'var(--cl-danger)' : isWarning ? 'var(--cl-warn)' : 'var(--cl-accent-ink)'
  const iconBg = isOver
    ? 'bg-[var(--cl-danger-soft)] border border-[var(--cl-danger)]'
    : isWarning
    ? 'bg-[var(--cl-warn-soft)] border border-[var(--cl-warn)]'
    : 'bg-[var(--cl-accent-soft)]/20 border border-[var(--cl-accent)]/20'
  const countColor = isOver ? 'text-[var(--cl-danger)]' : isWarning ? 'text-[var(--cl-warn)]' : 'text-[var(--cl-ink-4)]'
  const barColor = isOver ? 'bg-[var(--cl-danger)]' : isWarning ? 'bg-[var(--cl-warn)]' : 'bg-[var(--cl-accent)]/60'

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[var(--cl-paper-2)] transition-all text-left group"
      >
        <div className={`w-[26px] h-[26px] rounded-md flex items-center justify-center shrink-0 ${iconBg}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={iconColor} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 1.5h5l3 3v6H2v-9z"/>
            <path d="M7 1.5v3h3"/>
          </svg>
        </div>

        <span className="text-[12px] font-mono text-[var(--cl-ink-4)] flex-1 tracking-tight">MEMORY.md</span>

        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-14 h-1 bg-[var(--cl-paper-3)] rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
          <span className={`text-[10px] font-mono tabular-nums ${countColor}`}>{memoryMd.lineCount}/200</span>
          {isOver && <span className="text-[10px] text-[var(--cl-danger)] font-semibold">limite</span>}
        </div>

        <svg className="w-3 h-3 text-[var(--cl-ink-4)] group-hover:text-[var(--cl-ink-4)] transition-colors ml-1 shrink-0"
          viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d={open ? 'M2 8l4-4 4 4' : 'M2 4l4 4 4-4'}/>
        </svg>
      </button>

      {open && (
        <div className="ml-9 pl-3 border-l border-[var(--cl-line-soft)] pb-2 pt-1 overflow-x-auto">
          <Markdown>{memoryMd.content}</Markdown>
        </div>
      )}
    </div>
  )
}
