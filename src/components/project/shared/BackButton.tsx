export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-medium text-[#555c75] hover:text-[#9096b0] hover:bg-[#161b26] transition-all"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M7.5 2.5L4 6l3.5 3.5"/>
      </svg>
      {label}
    </button>
  )
}
