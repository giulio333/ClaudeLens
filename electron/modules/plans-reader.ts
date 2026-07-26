import { open, readFile, stat } from 'fs/promises';
import { basename, resolve, sep, join } from 'path';
import { glob } from 'glob';
import { CLAUDE_DIR } from '../utils';

// Plans are stored globally under ~/.claude/plans. The planFilePath we read comes
// verbatim from transcript attachments, so a poisoned/shared .jsonl could point it
// anywhere on disk. Confine reads to this dir to preserve the ~/.claude invariant.
const PLANS_DIR = join(CLAUDE_DIR, 'plans');

/** True when an absolute path resolves inside ~/.claude/plans. */
function isWithinPlansDir(filePath: string): boolean {
  const resolved = resolve(filePath);
  return resolved === PLANS_DIR || resolved.startsWith(PLANS_DIR + sep);
}

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
export interface PlanRef {
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

// Ripiega una singola riga JSONL in `refs`. Righe malformate: ignorate.
function foldLine(line: string, refs: PlanRef[]): void {
  // Fast path: salta le righe che non possono essere attachment di plan.
  if (!line.includes('plan_mode')) return;
  try {
    const entry = JSON.parse(line) as Record<string, any>;
    if (entry.type !== 'attachment' || !entry.attachment) return;
    const att = entry.attachment as Record<string, any>;
    if (att.type !== 'plan_mode' && att.type !== 'plan_mode_exit') return;
    if (typeof att.planFilePath !== 'string') return;
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

/** Estrae i riferimenti ai piani dalle righe attachment di un transcript.
 *  Puro sul contenuto — l'I/O (con cache) vive in `readPlanRefs`. */
export function extractPlanRefs(raw: string): PlanRef[] {
  const refs: PlanRef[] = [];
  for (const line of raw.split('\n')) foldLine(line, refs);
  return refs;
}

// ──────────────────────────────────────────────────────────────────────────
// Cache incrementale append-only (stesso schema di cost-tracker.ts).
//
// Il subtab Plans monta il suo conteggio su OGNI vista di progetto, e ogni
// data:changed lo reinvalida: senza cache questo modulo rileggeva per intero
// tutti i transcript del progetto (~92 MB su una history reale) a ogni raffica
// del watcher, in modo sincrono, bloccando il main process (#148). I transcript
// sono append-only, quindi un file invariato si serve dalla cache senza I/O e
// un file cresciuto si legge solo dalla coda.
// ──────────────────────────────────────────────────────────────────────────

interface RefCacheEntry {
  consumed: number;  // byte già ripiegati in `refs`
  mtimeMs: number;
  // Byte dopo l'ultimo newline non ancora terminati (riga finale a metà
  // scrittura). Buffer e non stringa: un carattere UTF-8 multi-byte spezzato
  // sul confine di lettura non va mai decodificato a metà sequenza (0x0A non
  // può comparire dentro una sequenza multi-byte).
  partial: Buffer;
  refs: PlanRef[];
}

const refCache = new Map<string, RefCacheEntry>();

// Osservabilità per i test: dimostra che un file invariato è un cache hit
// (nessuna lettura) e che un file cresciuto si legge in modo incrementale.
const refStats = { cacheHits: 0, fullParses: 0, incrementalParses: 0, fileReads: 0 };
export function getPlanRefStats() {
  return { ...refStats };
}
export function resetPlanRefCache() {
  refCache.clear();
  refStats.cacheHits = 0;
  refStats.fullParses = 0;
  refStats.incrementalParses = 0;
  refStats.fileReads = 0;
}

/** Riferimenti ai piani di un transcript, riusando il lavoro già fatto:
 *   • invariato (mtime+size)  → serve la cache, zero I/O
 *   • cresciuto (append-only) → legge e ripiega solo la coda
 *   • nuovo / troncato        → rilegge da byte 0
 *  Non solleva mai: un file illeggibile vale []. */
export async function readPlanRefs(sessionFilePath: string): Promise<PlanRef[]> {
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(sessionFilePath);
  } catch {
    refCache.delete(sessionFilePath);
    return [];
  }
  if (!st.isFile()) {
    refCache.delete(sessionFilePath);
    return [];
  }

  const cached = refCache.get(sessionFilePath);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.consumed === st.size) {
    refStats.cacheHits++;
    return withPartial(cached);
  }

  const incremental = !!cached && st.size > cached.consumed;
  const entry: RefCacheEntry = incremental
    ? cached!
    : { consumed: 0, mtimeMs: st.mtimeMs, partial: Buffer.alloc(0), refs: [] };
  if (incremental) refStats.incrementalParses++;
  else refStats.fullParses++;

  const len = st.size - entry.consumed;
  let chunk = Buffer.alloc(0);
  if (len > 0) {
    try {
      const fh = await open(sessionFilePath, 'r');
      try {
        const buf = Buffer.allocUnsafe(len);
        const { bytesRead } = await fh.read(buf, 0, len, entry.consumed);
        chunk = buf.subarray(0, bytesRead);
        refStats.fileReads++;
      } finally {
        await fh.close();
      }
    } catch {
      return entry.refs; // lettura fallita: quel che abbiamo già ripiegato
    }
  }

  // Ripiega ogni riga terminata da newline; il resto (riga finale parziale)
  // resta in buffer per l'incremento successivo.
  const combined = Buffer.concat([entry.partial, chunk]);
  let start = 0;
  for (let i = 0; i < combined.length; i++) {
    if (combined[i] === 0x0a) {
      foldLine(combined.toString('utf-8', start, i), entry.refs);
      start = i + 1;
    }
  }
  entry.partial = combined.subarray(start);
  entry.consumed += chunk.length;
  entry.mtimeMs = st.mtimeMs;
  refCache.set(sessionFilePath, entry);

  return withPartial(entry);
}

/** Le righe ripiegate più l'eventuale riga finale non terminata da newline.
 *  Quest'ultima NON entra in `entry.refs`: un transcript a metà scrittura la
 *  vedrà completa al prossimo incremento e la ripiegherebbe due volte. */
function withPartial(entry: RefCacheEntry): PlanRef[] {
  if (entry.partial.length === 0) return entry.refs;
  const refs = [...entry.refs];
  foldLine(entry.partial.toString('utf-8'), refs);
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

async function toPlan(ref: PlanRef): Promise<Plan> {
  let content: string | null = null;
  let exists = false;
  // Only read the markdown when the path is confined to ~/.claude/plans. A path
  // escaping that dir (poisoned transcript pointing at e.g. ~/.aws/credentials) is
  // surfaced as "deleted" rather than disclosed — never read.
  if (isWithinPlansDir(ref.filePath)) {
    try {
      content = await readFile(ref.filePath, 'utf-8');
      exists = true;
    } catch {
      // Il file del piano è stato cancellato (planExists:false): lo segnaliamo come "deleted".
    }
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
    // Non-recursive: real session files are direct children. `**/*.jsonl` would
    // also match `{sessionId}/subagents/**/agent-*.jsonl`, roughly doubling I/O
    // by re-reading every sub-agent transcript (#95). Aligned with findSessionFiles.
    const sessionFiles = await glob('*.jsonl', { cwd: projectPath, absolute: true });
    const groups: { group: PlanGroup; sortKey: string }[] = [];

    for (const sessionFile of sessionFiles) {
      const filename = basename(sessionFile);
      const sessionId = basename(filename, '.jsonl');

      const refs = dedupeRefs(await readPlanRefs(sessionFile));
      if (refs.length === 0) continue;

      const plans = (await Promise.all(refs.map(toPlan)))
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
