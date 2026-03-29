export function StatChip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`flex flex-col px-4 py-2.5 rounded-lg border ${accent ? 'bg-indigo-950/20 border-indigo-700/40' : 'bg-[#161a26] border-[#252836]'}`}>
      <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">{label}</span>
      <span className={`text-[15px] font-semibold tabular-nums mt-0.5 ${accent ? 'text-indigo-300' : 'text-[#e0e2f0]'}`}>{value}</span>
    </div>
  )
}
