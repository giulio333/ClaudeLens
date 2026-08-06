import type { Plan } from '../../../types';
import {
  useProjectPlans,
  useUnlinkedPlans,
  useWriteMarkdownFile,
  useDeleteMarkdownFile,
} from '../../../hooks/useIPC';
import { EntityDetailView, EntityConfig, TapeCell } from '../shared/EntityDetailView';

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Project = { hash: string; realPath: string };

export function PlanDetailView({
  plan: initialPlan,
  project,
  onBack,
}: {
  plan: Plan;
  project: Project;
  onBack: () => void;
}) {
  const write = useWriteMarkdownFile(['plans:project', 'plans:unlinked']);
  const del = useDeleteMarkdownFile(['plans:project', 'plans:unlinked']);

  // Ri-deriva il piano fresco dopo un save (il watcher invalida 'plans:*'). Un
  // piano non collegato non compare in nessun gruppo di sessione: senza il
  // fallback sulla lista globale resterebbe fermo al contenuto d'apertura.
  const { data: groups } = useProjectPlans(project.hash);
  const { data: unlinked } = useUnlinkedPlans();
  const sameFile = (p: Plan) => p.filePath === initialPlan.filePath;
  const fresh = groups?.flatMap(g => g.plans).find(sameFile) ?? unlinked?.find(sameFile);
  const plan = fresh ?? initialPlan;

  const statusLabel =
    plan.status === 'unlinked' ? 'Unlinked' : plan.status === 'approved' ? 'Approved' : 'Proposed';

  const unlinkedPlan = plan.status === 'unlinked';

  const tape: TapeCell[] = [{ label: 'Status', value: statusLabel }];
  // Un piano non collegato non ha attachment da cui leggere l'ora: il timestamp
  // è l'mtime del file, e la label lo dice invece di spacciarlo per "Created".
  if (plan.timestamp)
    tape.push({ label: unlinkedPlan ? 'Modified' : 'Created', value: fmtDateTime(plan.timestamp) });
  if (plan.gitBranch) tape.push({ label: 'Branch', value: plan.gitBranch, mono: true });

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
    // Nessun frontmatter modellato: il body è l'intero markdown del piano.
    serialize: ({ body }) => body,
    editable: plan.exists,
    deletable: plan.exists,
    duplicable: false,
    runnable: false,
    emptyMessage: 'Plan file no longer on disk.',
    footerNote: 'Stored globally in ~/.claude/plans',
  };

  return (
    <EntityDetailView
      config={config}
      onBack={onBack}
      onSave={async raw => {
        await write.mutateAsync({ filePath: plan.filePath, content: raw });
      }}
      onDelete={async () => {
        await del.mutateAsync({ filePath: plan.filePath });
      }}
    />
  );
}
