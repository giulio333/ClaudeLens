import type { MergePlan } from '../../../hooks/useIPC'

interface MergeConfirmDialogProps {
  plan: MergePlan
  sourceName: string
  destName: string
  isLoading: boolean
  /** Finché l'esecuzione del merge non è disponibile, il bottone di conferma resta disattivato. */
  canExecute: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function MergeConfirmDialog({
  plan,
  sourceName,
  destName,
  isLoading,
  canExecute,
  onConfirm,
  onCancel,
}: MergeConfirmDialogProps) {
  const moved = plan.sessions.length
  const renamed = plan.sessions.filter(s => s.collides).length
  const memCopy = plan.memory.filter(m => m.kind === 'copy').length
  const memConflicts = plan.memory.filter(m => m.kind === 'conflict-rename')
  const memIdentical = plan.memory.filter(m => m.kind === 'identical').length
  const hasBlockers = plan.blockers.length > 0
  const confirmDisabled = hasBlockers || !canExecute || isLoading

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--cl-paper-2)] rounded-lg shadow-lg p-6 max-w-lg w-full mx-4 max-h-[85vh] overflow-auto">
        <h3 className="text-[15px] font-semibold text-[var(--cl-ink)] mb-1">Merge into primary</h3>
        <p className="text-[13px] text-[var(--cl-ink-3)] mb-4">
          Move <span className="font-mono">{sourceName}</span> into{' '}
          <span className="font-mono">{destName}</span>.
        </p>

        {/* Blockers — stop the merge */}
        {hasBlockers && (
          <div className="rounded-lg border border-[var(--cl-danger)] bg-[var(--cl-danger-soft)] p-3 mb-4">
            <div className="text-[12px] font-semibold text-[var(--cl-danger)] mb-1">Cannot merge</div>
            <ul className="text-[12px] text-[var(--cl-ink-3)] list-disc pl-4 space-y-1">
              {plan.blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        )}

        {/* Plan summary */}
        <div className="space-y-3 text-[13px] text-[var(--cl-ink-3)] mb-4">
          <PlanRow label="Sessions">
            {moved === 0 ? 'none' : `${moved} moved${renamed > 0 ? ` (${renamed} renamed to avoid collision)` : ''}`}
          </PlanRow>

          <PlanRow label="Session data">
            {plan.sidecars.length === 0
              ? 'none'
              : `${plan.sidecars.filter(s => !s.collides).length} folders moved${plan.sidecars.some(s => s.collides) ? ` (${plan.sidecars.filter(s => s.collides).length} kept in place)` : ''}`}
          </PlanRow>

          <PlanRow label="cwd rewrite">
            {plan.cwdRewrite ? (
              <span className="font-mono text-[11px] break-all">
                {plan.cwdRewrite.from} → {plan.cwdRewrite.to}
              </span>
            ) : 'not needed'}
          </PlanRow>

          <PlanRow label="Memory">
            {memCopy + memConflicts.length + memIdentical === 0
              ? 'none'
              : `${memCopy} copied · ${memConflicts.length} conflict${memConflicts.length === 1 ? '' : 's'} · ${memIdentical} identical (skipped)`}
            {memConflicts.length > 0 && (
              <ul className="mt-1 text-[11px] font-mono text-[var(--cl-ink-4)] list-disc pl-4">
                {memConflicts.map(m => (
                  <li key={m.filename}>{m.filename} → {m.targetName}</li>
                ))}
              </ul>
            )}
          </PlanRow>

          <PlanRow label="Index">
            {plan.regenerateIndex ? 'MEMORY.md updated' : 'unchanged'}
          </PlanRow>

          <PlanRow label="Source folder">
            {plan.sourceEmptyAfter
              ? 'deleted (empty after merge)'
              : 'kept (still contains other files)'}
          </PlanRow>
        </div>

        {/* Warnings — non-blocking */}
        {plan.warnings.length > 0 && (
          <div className="rounded-lg border border-[var(--cl-line)] bg-[var(--cl-warn-soft)] p-3 mb-4">
            <div className="text-[12px] font-semibold text-[var(--cl-warn)] mb-1">Warnings</div>
            <ul className="text-[12px] text-[var(--cl-ink-3)] list-disc pl-4 space-y-1">
              {plan.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-[var(--cl-ink-4)] mb-5">
          A backup of the source folder is created before any change.
          {!canExecute && ' Execution is not available yet — this is a preview of the plan.'}
        </p>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-lg border border-[var(--cl-line)] hover:bg-[var(--cl-paper-3)] transition-colors text-[13px] font-medium text-[var(--cl-ink-3)]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            title={!canExecute ? 'Merge execution is not available yet' : undefined}
            className="flex-1 px-4 py-2 rounded-lg bg-[var(--cl-accent)] hover:bg-[var(--cl-accent)] disabled:opacity-40 transition-colors text-[13px] font-medium text-[var(--cl-on-accent)]"
          >
            {isLoading ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PlanRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="text-[11px] font-mono uppercase tracking-wide text-[var(--cl-ink-4)] min-w-[96px] pt-0.5">
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
