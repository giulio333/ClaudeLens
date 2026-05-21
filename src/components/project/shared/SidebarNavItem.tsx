interface SidebarNavItemProps {
  label: string
  icon: React.ReactNode
  isActive: boolean
  activeIconBg: string
  onClick: () => void
}

export function SidebarNavItem({ label, icon, isActive, activeIconBg, onClick }: SidebarNavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all text-left group ${
        isActive
          ? 'bg-[var(--cl-paper-3)] text-[var(--cl-ink-2)]'
          : 'text-[var(--cl-ink-4)] hover:bg-[var(--cl-paper-2)] hover:text-[var(--cl-ink-3)]'
      }`}
    >
      <div className={`w-[26px] h-[26px] rounded-md flex items-center justify-center shrink-0 transition-colors ${
        isActive ? activeIconBg : 'bg-[var(--cl-paper)] group-hover:bg-[var(--cl-paper-3)]'
      }`}>
        {icon}
      </div>
      <span className="text-[12.5px] font-medium tracking-tight">{label}</span>
    </button>
  )
}
