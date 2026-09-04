import { open, readFile, stat } from 'fs/promises';
import { basename, dirname, resolve, sep, join } from 'path';
import { glob } from 'glob';
import { CLAUDE_DIR } from '../utils';
import { listProjectSessionFiles } from './session-files';

// Plans are stored globally under ~/.claude/plans. The planFilePath we read comes
// verbatim from transcript attachments, so a poisoned/shared .jsonl could point it
// anywhere on disk. Confine reads to this dir to preserve the ~/.claude invariant.
const PLANS_DIR = join(CLAUDE_DIR, 'plans');

/** True when an absolute path resolves inside ~/.claude/plans.
 *  Exported because it is the containment rule for a `planFilePath`, and that
 *  value reaches a SECOND consumer that acts on it far more destructively than
 *  this module does: `session-deleter` offers plans for deletion. One rule, one
 *  definition — a reader that refuses to open a path outside this dir and a
 *  deleter that would happily remove it are not two opinions, they are a bug. */
export function isWithinPlansDir(filePath: string): boolean {
  const resolved = resolve(filePath);
  return resolved === PLANS_DIR || resolved.startsWith(PLANS_DIR + sep);
}

// Lo status che una riga `attachment` può dichiarare…
export type PlanRefStatus = 'proposed' | 'approved';
// …e quello che la UI può mostrare: un piano "unlinked" è un .md presente in
// ~/.claude/plans che nessun attachment referenzia, quindi non ha transizione di
// plan mode da cui derivare proposed/approved (#154).
export type PlanStatus = PlanRefStatus | 'unlinked';

export interface Plan {
  filePath: string;
  slug: string;
  title: string;
  status: PlanStatus;
  exists: boolean; // il file markdown è ancora leggibile su disco
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
  status: PlanRefStatus;
  timestamp: string;
  slug?: string;
  gitBranch?: string;
}

// A parità di timestamp, plan_mode_exit (approvato) ha priorità su plan_mode (proposto).
function statusRank(s: PlanRefStatus): number {
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
  consumed: number; // byte già ripiegati in `refs`
  mtimeMs: number;
  // Byte dopo l'ultimo newline non ancora terminati (riga finale a metà
  // scrittura). Buffer e non stringa: un carattere UTF-8 multi-byte spezzato
  // sul confine di lettura non va mai decodificato a metà sequenza (0x0A non
  // può comparire dentro una sequenza multi-byte).
  partial: Buffer;
  refs: PlanRef[];
}

// Raggruppata per directory contenitore (dir → path del transcript → entry)
// invece che path→entry piatta, così una scansione può scartare le entry dei
// file spariti in O(file della dir) anziché percorrere tutta la cache — vedi
// `retainSessions`. Le chiavi di directory passano da `resolve()` perché sono
// confrontate con path costruiti via `join()`, mentre glob restituisce
// separatori POSIX anche su Windows.
const refCache = new Map<string, Map<string, RefCacheEntry>>();

// Osservabilità per i test: dimostra che un file invariato è un cache hit
// (nessuna lettura), che un file cresciuto si legge in modo incrementale e che
// un transcript sparito smette di essere in cache (`cachedFiles`/`evictions`).
const refStats = { cacheHits: 0, fullParses: 0, incrementalParses: 0, fileReads: 0, evictions: 0 };

export function getPlanRefStats() {
  let cachedFiles = 0;
  for (const byFile of refCache.values()) cachedFiles += byFile.size;
  return { ...refStats, cachedFiles };
}

export function resetPlanRefCache() {
  refCache.clear();
  refStats.cacheHits = 0;
  refStats.fullParses = 0;
  refStats.incrementalParses = 0;
  refStats.fileReads = 0;
  refStats.evictions = 0;
}

function dirKey(path: string): string {
  return resolve(dirname(path));
}

function cacheGet(filePath: string): RefCacheEntry | undefined {
  return refCache.get(dirKey(filePath))?.get(filePath);
}

function cacheSet(filePath: string, entry: RefCacheEntry): void {
  const key = dirKey(filePath);
  const byFile = refCache.get(key);
  if (byFile) byFile.set(filePath, entry);
  else refCache.set(key, new Map([[filePath, entry]]));
}

function cacheDelete(filePath: string): void {
  const key = dirKey(filePath);
  const byFile = refCache.get(key);
  if (!byFile) return;
  if (byFile.delete(filePath)) refStats.evictions++;
  if (byFile.size === 0) refCache.delete(key);
}

/** Scarta le entry dei transcript non più presenti in `dir`. `live` è la glob
 *  che ogni scansione già esegue, cioè l'insieme COMPLETO dei transcript di
 *  quella directory: ciò che è in cache sotto di essa e non compare nella lista
 *  è sparito per certo (sessione cancellata dall'app, progetto mergiato
 *  altrove, retention `cleanupPeriodDays` di Claude Code). Senza questo passo
 *  l'entry sopravvive per tutta la vita del processo — `readPlanRefs` sfratta
 *  solo un path che qualcuno richiede di nuovo, e un transcript cancellato non
 *  viene più richiesto. */
function retainSessions(dir: string, live: string[]): void {
  const key = resolve(dir);
  const byFile = refCache.get(key);
  if (!byFile) return;
  const keep = new Set(live);
  for (const path of byFile.keys()) {
    if (!keep.has(path)) {
      byFile.delete(path);
      refStats.evictions++;
    }
  }
  if (byFile.size === 0) refCache.delete(key);
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
    cacheDelete(sessionFilePath);
    return [];
  }
  if (!st.isFile()) {
    cacheDelete(sessionFilePath);
    return [];
  }

  const cached = cacheGet(sessionFilePath);
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
  cacheSet(sessionFilePath, entry);

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

/** I transcript di sessione di un progetto, dalle DUE location che Claude Code
 *  usa (`listProjectSessionFiles`). Dev'essere la stessa enumerazione di
 *  cost-tracker, perché `getUnlinkedPlans` deriva "non referenziato" dalla lista
 *  dei transcript — mancarne una location farebbe passare per orfani tutti i
 *  piani di un progetto in layout `sessions/`.
 *
 *  Ogni glob è l'insieme vivo della sua directory: la passa a `retainSessions`
 *  per sfrattare le entry dei transcript spariti dopo il popolamento della cache.
 *
 *  Esportata perché `session-deleter` conta gli stessi riferimenti con lo stesso
 *  `readPlanRefs`: la potatura vive QUI, agganciata a questa enumerazione, quindi
 *  un chiamante che elenca i transcript per conto suo popola la cache in
 *  directory che nessuna scansione ripasserà mai. */
export async function listPlanSessionFiles(projectPath: string): Promise<string[]> {
  return listProjectSessionFiles(projectPath, retainSessions);
}

// Per ogni sessione del progetto, raccoglie i piani referenziati negli attachment
// (plan_mode / plan_mode_exit) e legge il markdown dal dir globale ~/.claude/plans/.
// Restituisce solo i gruppi non vuoti, sessione più recente prima.
export async function getProjectPlans(projectPath: string): Promise<PlanGroup[]> {
  try {
    const sessionFiles = await listPlanSessionFiles(projectPath);
    const groups: { group: PlanGroup; sortKey: string }[] = [];

    for (const sessionFile of sessionFiles) {
      const filename = basename(sessionFile);
      const sessionId = basename(filename, '.jsonl');

      const refs = dedupeRefs(await readPlanRefs(sessionFile));
      if (refs.length === 0) continue;

      const plans = (await Promise.all(refs.map(toPlan))).sort((a, b) =>
        a.timestamp < b.timestamp ? 1 : -1
      ); // piano più recente prima

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

// ──────────────────────────────────────────────────────────────────────────
// Piani "unlinked" (#154)
//
// Il modello dei piani è "piano = riferimento trovato in una sessione", non
// "piano = file nella cartella": un .md scritto direttamente in ~/.claude/plans
// (Write/Bash, o qualunque strada che non passi dal plan mode nativo) non compare
// da nessuna parte, pur essendo un piano validissimo su disco.
//
// "Non referenziato" è deliberatamente definito sull'INTERA installazione, non
// sul progetto corrente: la cartella dei piani è globale, quindi restringendo lo
// scan al progetto aperto ogni piano nato in un altro progetto sfilerebbe qui
// come orfano. Il costo è una scansione di tutti i transcript, che la cache
// incrementale di `readPlanRefs` riduce a uno `stat` per file invariato.
// ──────────────────────────────────────────────────────────────────────────

/** Ogni `planFilePath` referenziato da un attachment, in tutti i progetti. */
async function referencedPlanPaths(projectsDir: string): Promise<Set<string>> {
  const referenced = new Set<string>();
  // Le dir di progetto, non i transcript: `listPlanSessionFiles` sa poi da quale delle
  // due location leggerli, e riceve la lista viva che serve alla potatura.
  // Stesso pattern di `calculateCostSummary` per enumerare i progetti.
  const projectDirs = await glob('[!.]*', { cwd: projectsDir, absolute: true });
  for (const projectPath of projectDirs) {
    for (const sessionFile of await listPlanSessionFiles(projectPath)) {
      for (const ref of await readPlanRefs(sessionFile)) referenced.add(resolve(ref.filePath));
    }
  }
  return referenced;
}

async function toUnlinkedPlan(filePath: string): Promise<Plan | null> {
  let content: string;
  let mtime: Date;
  try {
    [content, { mtime }] = await Promise.all([readFile(filePath, 'utf-8'), stat(filePath)]);
  } catch {
    // Sparito tra la glob e la lettura: semplicemente non è più un piano.
    return null;
  }
  const slug = basename(filePath, '.md');
  return {
    filePath,
    slug,
    title: deriveTitle(content, slug),
    status: 'unlinked',
    // Un orfano è per definizione un file che ESISTE: lo stato "deleted" (piano
    // referenziato il cui markdown è sparito) qui non è rappresentabile.
    exists: true,
    content,
    // Nessun attachment da cui leggere l'ora: resta l'mtime del file.
    timestamp: mtime.toISOString(),
  };
}

/** I `.md` di ~/.claude/plans che nessuna sessione, di nessun progetto,
 *  referenzia in un attachment plan_mode/plan_mode_exit. Più recenti prima. */
export async function getUnlinkedPlans(projectsDir: string): Promise<Plan[]> {
  try {
    const candidates = await glob('*.md', { cwd: PLANS_DIR, absolute: true });
    // Nessun candidato (cartella vuota o inesistente) → nessun motivo di toccare
    // un solo transcript: è il caso di chi non ha mai usato il plan mode.
    if (candidates.length === 0) return [];

    const referenced = await referencedPlanPaths(projectsDir);
    const orphans = candidates.filter(f => !referenced.has(resolve(f)));

    const plans = (await Promise.all(orphans.map(toUnlinkedPlan))).filter(
      (p): p is Plan => p !== null
    );
    return plans.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  } catch (error) {
    console.error(`Errore leggendo piani non collegati: ${error}`);
    return [];
  }
}
