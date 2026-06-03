import { readFileSync } from 'fs';
import { basename } from 'path';
import { glob } from 'glob';

export type PlanStatus = 'proposed' | 'approved';

export interface Plan {
  filePath: string;
  slug: string;
  title: string;
  status: PlanStatus;
  exists: boolean;        // il file markdown è ancora leggibile su disco
  content: string | null; // markdown del piano, null se mancante
  timestamp: string;
  gitBranch?: string;
}

export interface PlanGroup {
  sessionId: string;
  filename: string;
  plans: Plan[];
}

// Una riga `attachment` di tipo plan estratta da una sessione .jsonl.
interface PlanRef {
  filePath: string;
  status: PlanStatus;
  timestamp: string;
  slug?: string;
  gitBranch?: string;
}

// A parità di timestamp, plan_mode_exit (approvato) ha priorità su plan_mode (proposto).
function statusRank(s: PlanStatus): number {
  return s === 'approved' ? 1 : 0;
}

function humanizeSlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

// Titolo: prima intestazione H1 del markdown, altrimenti slug "umanizzato".
function deriveTitle(content: string | null, slug: string): string {
  if (content) {
    const m = content.match(/^#\s+(.+)$/m);
    if (m) return m[1].trim();
  }
  return humanizeSlug(slug) || slug;
}

// Estrae i riferimenti ai piani dalle righe attachment di una sessione .jsonl.
function extractPlanRefs(sessionFilePath: string): PlanRef[] {
  let raw: string;
  try {
    raw = readFileSync(sessionFilePath, 'utf-8');
  } catch {
    return [];
  }

  const refs: PlanRef[] = [];
  for (const line of raw.split('\n')) {
    // Fast path: salta le righe che non possono essere attachment di plan.
    if (!line.includes('plan_mode')) continue;
    try {
      const entry = JSON.parse(line) as Record<string, any>;
      if (entry.type !== 'attachment' || !entry.attachment) continue;
      const att = entry.attachment as Record<string, any>;
      if (att.type !== 'plan_mode' && att.type !== 'plan_mode_exit') continue;
      if (typeof att.planFilePath !== 'string') continue;
      refs.push({
        filePath: att.planFilePath,
        status: att.type === 'plan_mode_exit' ? 'approved' : 'proposed',
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : '',
        slug: typeof entry.slug === 'string' ? entry.slug : undefined,
        gitBranch: typeof entry.gitBranch === 'string' ? entry.gitBranch : undefined,
      });
    } catch {
      // riga malformata: ignora
    }
  }
  return refs;
}

// Dedup per planFilePath: mantiene l'evento più recente per timestamp, così lo
// status riflette l'ultima transizione. Un piano approvato e poi riaperto in
// plan mode torna quindi "proposed". A parità di timestamp vince l'approvazione.
function dedupeRefs(refs: PlanRef[]): PlanRef[] {
  const byPath = new Map<string, PlanRef>();
  for (const ref of refs) {
    const prev = byPath.get(ref.filePath);
    const better =
      !prev ||
      ref.timestamp > prev.timestamp ||
      (ref.timestamp === prev.timestamp && statusRank(ref.status) > statusRank(prev.status));
    if (better) byPath.set(ref.filePath, ref);
  }
  return [...byPath.values()];
}

function toPlan(ref: PlanRef): Plan {
  let content: string | null = null;
  let exists = false;
  try {
    content = readFileSync(ref.filePath, 'utf-8');
    exists = true;
  } catch {
    // Il file del piano è stato cancellato (planExists:false): lo segnaliamo come "deleted".
  }
  const slug = ref.slug ?? basename(ref.filePath, '.md');
  return {
    filePath: ref.filePath,
    slug,
    title: deriveTitle(content, slug),
    status: ref.status,
    exists,
    content,
    timestamp: ref.timestamp,
    ...(ref.gitBranch ? { gitBranch: ref.gitBranch } : {}),
  };
}

// Per ogni sessione del progetto, raccoglie i piani referenziati negli attachment
// (plan_mode / plan_mode_exit) e legge il markdown dal dir globale ~/.claude/plans/.
// Restituisce solo i gruppi non vuoti, sessione più recente prima.
export async function getProjectPlans(projectPath: string): Promise<PlanGroup[]> {
  try {
    const sessionFiles = await glob('**/*.jsonl', { cwd: projectPath, absolute: true });
    const groups: { group: PlanGroup; sortKey: string }[] = [];

    for (const sessionFile of sessionFiles) {
      const filename = basename(sessionFile);
      const sessionId = basename(filename, '.jsonl');

      const refs = dedupeRefs(extractPlanRefs(sessionFile));
      if (refs.length === 0) continue;

      const plans = refs
        .map(toPlan)
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)); // piano più recente prima

      if (plans.length === 0) continue;

      const sortKey = plans[0]?.timestamp ?? '';
      groups.push({ group: { sessionId, filename, plans }, sortKey });
    }

    return groups.sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1)).map(g => g.group);
  } catch (error) {
    console.error(`Errore leggendo piani progetto: ${error}`);
    return [];
  }
}
