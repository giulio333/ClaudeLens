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
          ? 'bg-[#1c2235] text-[#c4c8e0]'
          : 'text-[#555c75] hover:bg-[#161b26] hover:text-[#9096b0]'
      }`}
    >
      <div className={`w-[26px] h-[26px] rounded-md flex items-center justify-center shrink-0 transition-colors ${
        isActive ? activeIconBg : 'bg-[#1a1f2e] group-hover:bg-[#1e2440]'
      }`}>
        {icon}
      </div>
      <span className="text-[12.5px] font-medium tracking-tight">{label}</span>
    </button>
  )
}
