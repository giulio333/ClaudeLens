export function StatChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex flex-col px-4 py-2.5 rounded-lg border ${accent ? 'bg-[var(--cl-accent-soft)]/20 border-[var(--cl-accent)]/40' : 'bg-[var(--cl-paper-2)] border-[var(--cl-line)]'}`}
    >
      <span className="text-[10px] font-semibold text-[var(--cl-ink-3)] uppercase tracking-widest">
        {label}
      </span>
      <span
        className={`text-[15px] font-semibold tabular-nums mt-0.5 ${accent ? 'text-[var(--cl-accent-ink)]' : 'text-[var(--cl-ink)]'}`}
      >
        {value}
      </span>
    </div>
  );
}
