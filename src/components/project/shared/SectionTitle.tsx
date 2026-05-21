import React from 'react'

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 className="text-[10px] font-bold text-[var(--cl-ink-4)] uppercase tracking-[0.12em] shrink-0">{children}</h2>
      <div className="flex-1 h-px bg-[var(--cl-line-soft)]" />
      {action}
    </div>
  )
}
