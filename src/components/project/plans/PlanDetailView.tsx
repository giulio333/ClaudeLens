import type { Plan } from '../../../types'
import { MarkdownDocView } from '../shared/MarkdownDocView'

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2.5">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--cl-ink-3)' }}>
        {label}
      </div>
      <div className="mt-1 text-[13px]" style={{ color: 'var(--cl-ink-2)' }}>{value}</div>
    </div>
  )
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function PlanDetailView({ plan, onBack }: { plan: Plan; onBack: () => void }) {
  const statusLabel = plan.status === 'approved' ? 'Approved' : 'Proposed'

  const sidebar = (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <div className="pb-3" style={{ borderBottom: '1px solid var(--cl-line)' }}>
        <span className="text-[10px] font-mono font-bold tracking-[0.18em] uppercase" style={{ color: 'var(--cl-ink-3)' }}>
          Plan
        </span>
      </div>

      <div className="flex-1">
        <StatRow label="Status" value={statusLabel} />
        {plan.timestamp && <StatRow label="Created" value={fmtDateTime(plan.timestamp)} />}
        {plan.gitBranch && <StatRow label="Branch" value={plan.gitBranch} />}
      </div>

      <div className="pt-3" style={{ borderTop: '1px solid var(--cl-line)' }}>
        <p className="text-[10px] font-mono leading-snug break-all" style={{ color: 'var(--cl-ink-3)' }}>
          {plan.filePath}
        </p>
        <p className="mt-2 text-[10px] leading-snug" style={{ color: 'var(--cl-ink-3)' }}>
          Stored globally in ~/.claude/plans · read-only
        </p>
      </div>
    </div>
  )

  return (
    <MarkdownDocView
      onBack={onBack}
      backLabel="Plans"
      crumb={`Plan · ${plan.title}`}
      eyebrow={<>{statusLabel.toLowerCase()} · plans/{plan.slug}.md</>}
      titleLabel={plan.title}
      titleGlyph=".md"
      titleFluid
      content={plan.content ?? ''}
      emptyMessage="Plan file no longer on disk."
      sidebar={sidebar}
    />
  )
}
