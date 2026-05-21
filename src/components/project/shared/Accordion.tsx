import React, { useState } from 'react'
import { SCOPE_STYLES } from '../types'

export function Accordion({ title, badge, defaultOpen = false, children }: {
  title: string
  badge?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[var(--cl-paper-2)] transition-all text-left group"
      >
        <div className="w-[26px] h-[26px] rounded-md bg-[var(--cl-paper)] flex items-center justify-center shrink-0 transition-colors group-hover:bg-[var(--cl-paper-3)]">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--cl-ink-4)" strokeWidth="1.3" strokeLinecap="round">
            <path d={open ? 'M2 8l4-4 4 4' : 'M2 4l4 4 4-4'}/>
          </svg>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {badge && (
            <span className={`${SCOPE_STYLES[badge] ?? 'bg-[var(--cl-paper-3)] text-[var(--cl-ink-3)] ring-1 ring-[var(--cl-line)]'} text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0`}>
              {badge}
            </span>
          )}
          <span className="text-[12.5px] font-medium text-[var(--cl-ink-3)] tracking-tight truncate font-mono">{title}</span>
        </div>
      </button>
      {open && (
        <div className="pl-10 pr-2 pb-2 pt-1">
          {children}
        </div>
      )}
    </div>
  )
}
