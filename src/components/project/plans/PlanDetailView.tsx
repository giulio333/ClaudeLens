import type { Plan } from '../../../types'
import { EntityDetailView, EntityConfig, TapeCell } from '../shared/EntityDetailView'

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function PlanDetailView({ plan, onBack }: { plan: Plan; onBack: () => void }) {
  const statusLabel = plan.status === 'approved' ? 'Approved' : 'Proposed'

  const tape: TapeCell[] = [{ label: 'Status', value: statusLabel }]
  if (plan.timestamp) tape.push({ label: 'Created', value: fmtDateTime(plan.timestamp) })
  if (plan.gitBranch) tape.push({ label: 'Branch', value: plan.gitBranch, mono: true })

  const config: EntityConfig = {
    kind: 'plan',
    name: plan.title,
    titleGlyph: '.md',
    titleFluid: true,
    scopeLabel: 'Plan',
    path: plan.filePath,
    eyebrow: `${statusLabel.toLowerCase()} · plans/${plan.slug}.md`,
    kindLabel: 'plan',
    backLabel: 'Plans',
    crumbs: [{ label: `Plan · ${plan.title}`, accent: true }],
    neutralTint: true,
    initial: 'P',
    tape,
    bodyLabel: 'Plan · markdown',
    optionDefs: [],
    initialOptions: {},
    body: plan.content ?? '',
    editable: false,
    deletable: false,
    duplicable: false,
    runnable: false,
    emptyMessage: 'Plan file no longer on disk.',
    footerNote: 'Stored globally in ~/.claude/plans · read-only',
  }

  return <EntityDetailView config={config} onBack={onBack} />
}
