import React from 'react'

export function NavCard({
  iconColor, iconBg, iconChildren, title, stat, sub, onClick,
}: {
  iconColor: string
  iconBg: string
  iconChildren: React.ReactNode
  title: string
  stat: string
  sub: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-xl bg-[#0f1117] border border-[#1e2130] hover:border-[#252836] hover:bg-[#111318] p-4 transition-all group w-full"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={iconColor} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            {iconChildren}
          </svg>
        </div>
        <svg className="w-3 h-3 text-[#3d4460] group-hover:text-[#555c75] transition-colors mt-1" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M4.5 2.5L9 6l-4.5 3.5"/>
        </svg>
      </div>
      <p className="text-[10px] font-bold text-[#3d4460] uppercase tracking-[0.12em] mb-2">{title}</p>
      <p className="text-[24px] font-bold text-[#e0e2f0] tabular-nums leading-none mb-1.5">{stat}</p>
      <p className="text-[11px] text-[#555c75] truncate leading-snug">{sub}</p>
    </button>
  )
}
