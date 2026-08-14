import { MemoryTopic } from '../../../hooks/useIPC';

/**
 * Il grafo delle memorie di un progetto, derivato dai `[[wikilink]]` che le
 * memorie già contengono nel body.
 *
 * Perché i wikilink e non la somiglianza testuale: sono un dato **scritto a
 * mano**, quindi ogni arco è una relazione che qualcuno ha davvero affermato.
 * Misurato sulle 33 memorie di ClaudeLens: 28 archi su 33 nodi (5,5% delle
 * coppie possibili) → un grafo sparso, che si legge. Il matching per keyword,
 * provato sugli stessi dati, produce 41 archi su 25 nodi a soglia bassa — la
 * nuvola indistinta che non dice nulla — e ~55% di precisione a soglia alta:
 * per questo vive separato in `affinities`, da rendere tratteggiato, e non
 * entra mai in `links`.
 *
 * Nessuna lettura in più: il renderer riceve già il contenuto completo di ogni
 * topic in `MemoryData.topics`, quindi tutto qui è una regex su testo che è già
 * in memoria.
 */

export interface MemoryGraphNode {
  /** id del nodo: il filename del topic (`feedback_ui_language.md`). */
  filename: string;
  name: string;
  /** Etichetta breve per il disegno: filename senza prefisso di tipo né estensione. */
  label: string;
  type: MemoryTopic['type'];
  topic: MemoryTopic;
  /** Quante memorie citano questa: è la misura di "canonica". */
  inDeg: number;
  /** Quante ne cita: è la misura di "derivata". */
  outDeg: number;
  clusterId: number;
}

export interface MemoryGraphLink {
  from: string;
  to: string;
  /** `fuzzy` = il target non combaciava esattamente (forma abbreviata del nome). */
  resolved: 'exact' | 'fuzzy';
}

/** Coppia collegata solo da parole in comune: un suggerimento, non un fatto. */
export interface MemoryAffinity {
  a: string;
  b: string;
  shared: string[];
  weight: number;
}

/** Un `[[link]]` che non punta a nessuna memoria (spesso: a un modulo di codice). */
export interface MemoryDanglingLink {
  from: string;
  target: string;
}

export interface MemoryCluster {
  id: number;
  /** Il nodo più citato del cluster: dà il nome al gruppo. */
  hub: string;
  label: string;
  members: string[];
}

/**
 * Community detection per modularità (Louvain, fase locale + aggregazione).
 *
 * **Perché non le componenti connesse**, che erano la prima versione: separano
 * solo ciò che è del tutto scollegato, quindi un singolo arco fra due temi li
 * fonde. Misurato su due archivi reali: ClaudeLens (33 memorie, 0,85 archi per
 * nodo) si spezzava bene, ma SARA2.0 (43 memorie, **1,91** archi per nodo)
 * collassava in **un'unica isola da 39 nodi** — l'hairball. Sugli stessi dati
 * la modularità trova gruppi coerenti (infra, repo, broker legacy, federation,
 * docs…) e il **68% degli archi cade dentro un gruppo**: la struttura c'era,
 * era l'algoritmo a non vederla.
 *
 * Deterministico di proposito: Louvain classico visita i nodi in ordine
 * casuale e restituisce partizioni diverse a ogni giro. Qui la visita segue un
 * ordine **canonico** (per filename), non quello di arrivo, così la stessa
 * memoria finisce sempre nello stesso gruppo — la vista si impara a memoria e
 * due aperture si confrontano. Coperto da `test/memory-graph-real.test.ts`, che
 * ripete la costruzione su input permutati di ogni archivio locale.
 */
function detectCommunities(input: string[], edges: MemoryGraphLink[]): string[][] {
  if (!input.length) return [];
  // Ordine canonico, NON quello di arrivo: la fase locale visita i nodi in
  // sequenza e l'esito dipende da quella sequenza. I topic arrivano da un
  // `readdir`, il cui ordine non è garantito fra filesystem — misurato sugli
  // archivi reali, permutare l'input cambiava la partizione in 2 casi su 5.
  // Ordinare qui rende il raggruppamento una funzione del solo grafo.
  const nodes = [...input].sort((a, b) => a.localeCompare(b));
  const neighbors = new Map<string, Map<string, number>>(nodes.map(n => [n, new Map()]));
  const bump = (a: string, b: string, w: number) =>
    neighbors.get(a)?.set(b, (neighbors.get(a)!.get(b) ?? 0) + w);
  for (const e of edges) {
    bump(e.from, e.to, 1);
    bump(e.to, e.from, 1);
  }

  const degree = new Map(
    nodes.map(n => [n, [...neighbors.get(n)!.values()].reduce((s, w) => s + w, 0)])
  );
  const m2 = nodes.reduce((s, n) => s + degree.get(n)!, 0);
  // Nessun arco: ogni nodo è solo, e il chiamante li tratta come tali.
  if (m2 === 0) return nodes.map(n => [n]);

  const community = new Map(nodes.map(n => [n, n]));
  const totalDegree = new Map(nodes.map(n => [n, degree.get(n)!]));

  // La fase locale converge in poche passate; il cap è una rete di sicurezza
  // contro oscillazioni fra due assegnazioni di guadagno identico.
  for (let pass = 0; pass < 24; pass++) {
    let moved = false;
    for (const node of nodes) {
      const own = degree.get(node)!;
      const current = community.get(node)!;
      totalDegree.set(current, totalDegree.get(current)! - own);

      const weightTo = new Map<string, number>();
      for (const [nb, w] of neighbors.get(node)!)
        weightTo.set(community.get(nb)!, (weightTo.get(community.get(nb)!) ?? 0) + w);

      let best = current;
      let bestGain = (weightTo.get(current) ?? 0) - (totalDegree.get(current)! * own) / m2;
      // Candidati in ordine canonico: l'iterazione di una Map segue l'ordine di
      // inserimento, cioè quello degli archi, che il chiamante non controlla.
      for (const [candidate, w] of [...weightTo].sort((x, y) => x[0].localeCompare(y[0]))) {
        const gain = w - (totalDegree.get(candidate)! * own) / m2;
        // A parità di guadagno vince l'id minore: rende stabile l'esito.
        if (gain > bestGain + 1e-9 || (Math.abs(gain - bestGain) <= 1e-9 && candidate < best)) {
          bestGain = gain;
          best = candidate;
        }
      }
      community.set(node, best);
      totalDegree.set(best, totalDegree.get(best)! + own);
      if (best !== current) moved = true;
    }
    if (!moved) break;
  }

  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const c = community.get(n)!;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(n);
  }

  // Un gruppo di un solo nodo che però ha vicini è un'isola da un elemento:
  // rumore di layout. Lo si assorbe nel gruppo con cui ha più legami — che è
  // il gruppo in cui un lettore lo cercherebbe comunque.
  const merged = new Map(groups);
  for (const [id, members] of groups) {
    if (members.length !== 1) continue;
    const solo = members[0];
    if (!neighbors.get(solo)!.size) continue;
    const pull = new Map<string, number>();
    for (const [nb, w] of neighbors.get(solo)!) {
      const target = community.get(nb)!;
      if (target === id) continue;
      pull.set(target, (pull.get(target) ?? 0) + w);
    }
    let bestTarget: string | null = null;
    let bestWeight = 0;
    for (const [target, w] of [...pull].sort((a, b) => a[0].localeCompare(b[0])))
      if (w > bestWeight && merged.has(target)) {
        bestWeight = w;
        bestTarget = target;
      }
    if (bestTarget) {
      merged.get(bestTarget)!.push(solo);
      merged.delete(id);
    }
  }

  return [...merged.values()];
}

export interface MemoryGraph {
  nodes: MemoryGraphNode[];
  links: MemoryGraphLink[];
  affinities: MemoryAffinity[];
  dangling: MemoryDanglingLink[];
  /** Cluster con almeno due membri, dal più grande. */
  clusters: MemoryCluster[];
  /** Memorie che nessun link tocca: debito di connessione, non rumore. */
  loners: string[];
}

const TYPE_PREFIX = /^(feedback|project|reference|user)[-_]/;

/** Etichetta di disegno: `feedback_ui_language.md` → `ui language`. */
export function graphLabel(filename: string): string {
  return filename.replace(/\.md$/, '').replace(TYPE_PREFIX, '').replace(/[-_]/g, ' ');
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/\.md$/, '')
    .replace(/[_\s]+/g, '-');

/**
 * Risolve il target di un `[[wikilink]]` al filename di una memoria.
 *
 * Serve perché gli stessi wikilink sono scritti in forme diverse — sulle
 * memorie reali convivono `[[project_design_system]]`,
 * `[[project-design-system]]` (underscore vs dash) e `[[verify-with-live-tests]]`
 * (il nome accorciato). Ordine: filename esatto, `name` del frontmatter,
 * infine un match parziale **solo se è l'unico candidato** — con più candidati
 * si preferisce un link mancante a un link inventato.
 */
function makeResolver(topics: MemoryTopic[]) {
  const byKey = new Map<string, string>();
  // I filename prima: sono l'identità del file, i `name` del frontmatter solo
  // un alias (e possono ripetersi).
  for (const t of topics) byKey.set(normalize(t.filename), t.filename);
  for (const t of topics) {
    const k = normalize(t.name ?? '');
    if (k && !byKey.has(k)) byKey.set(k, t.filename);
  }
  const keys = [...byKey.keys()];

  return (target: string): { filename: string; resolved: 'exact' | 'fuzzy' } | null => {
    const t = normalize(target);
    if (!t) return null;
    const exact = byKey.get(t);
    if (exact) return { filename: exact, resolved: 'exact' };
    const hits = keys.filter(k => k.endsWith(`-${t}`) || k.includes(t));
    if (hits.length !== 1) return null;
    return { filename: byKey.get(hits[0])!, resolved: 'fuzzy' };
  };
}

/**
 * Stopword per il matching di affinità: articoli/preposizioni it+en più i
 * termini che *ogni* memoria porta (il vocabolario del dominio e le parole del
 * frontmatter), che accoppierebbero tutto con tutto. Sui dati reali era proprio
 * questo a produrre falsi come `reference_x ~ reference_y` per la sola parola
 * "reference".
 */
const AFFINITY_STOPWORDS = new Set(
  `feedback project projects progetto progetti reference user users utente memory memoria memorie
   claude claudelens code node type name description metadata
   vivo verificato piano vista deve devono usare sempre anche solo dove come quando quale
   file files path paths dati data stato sono viene essere fare fatto altro altri questo quello
   della delle dello degli nella nelle sulla sulle prima dopo senza tutto tutti ogni loro
   with from that this they them into over more than very just also only when where what
   avere`
    .split(/\s+/)
    .filter(Boolean)
);

function affinityTokens(topic: MemoryTopic): Set<string> {
  const text = `${topic.filename.replace(/\.md$/, '').replace(TYPE_PREFIX, '')} ${
    topic.name ?? ''
  } ${topic.description ?? ''}`;
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9àèéìòù]+/)
      .filter(t => t.length > 3 && !AFFINITY_STOPWORDS.has(t) && !/^\d+$/.test(t))
  );
}

/** Peso minimo perché un'affinità valga la pena di essere suggerita. */
const AFFINITY_MIN_WEIGHT = 0.8;

export function buildMemoryGraph(
  topics: MemoryTopic[],
  contents: Record<string, string>
): MemoryGraph {
  const resolve = makeResolver(topics);
  const links: MemoryGraphLink[] = [];
  const dangling: MemoryDanglingLink[] = [];
  const seen = new Set<string>();

  for (const t of topics) {
    const body = contents[t.filename] ?? '';
    for (const m of body.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      const hit = resolve(m[1]);
      if (!hit) {
        dangling.push({ from: t.filename, target: m[1].trim() });
        continue;
      }
      if (hit.filename === t.filename) continue;
      const key = `${t.filename}>${hit.filename}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ from: t.filename, to: hit.filename, resolved: hit.resolved });
    }
  }

  // Ordinamento per memoria di origine, così il grafo prodotto è identico
  // comunque il chiamante abbia ordinato i topic. `sort` è stabile per spec,
  // quindi i link scritti nello stesso file restano nell'ordine in cui li si
  // incontra leggendolo.
  links.sort((a, b) => a.from.localeCompare(b.from));
  dangling.sort((a, b) => a.from.localeCompare(b.from));

  const inDeg = new Map(topics.map(t => [t.filename, 0]));
  const outDeg = new Map(topics.map(t => [t.filename, 0]));
  for (const l of links) {
    inDeg.set(l.to, (inDeg.get(l.to) ?? 0) + 1);
    outDeg.set(l.from, (outDeg.get(l.from) ?? 0) + 1);
  }

  // I cluster tematici sono comunità per modularità, non componenti connesse:
  // vedi `detectCommunities` per la misura che ha imposto il cambio.
  const degOf = (f: string) => (inDeg.get(f) ?? 0) + (outDeg.get(f) ?? 0);
  const connected = topics.filter(t => degOf(t.filename) > 0).map(t => t.filename);
  const communities = detectCommunities(connected, links);

  const islands = communities
    .map(c => [...c].sort((a, b) => a.localeCompare(b)))
    .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  // "Solo" = nessun link. Una memoria che cita o è citata resta sempre nel suo
  // gruppo, mai nella fascia in fondo: da lì i suoi archi attraverserebbero
  // tutta la mappa per dire il contrario di quello che la fascia dichiara.
  const loners = topics
    .filter(t => degOf(t.filename) === 0)
    .map(t => t.filename)
    .sort((a, b) => a.localeCompare(b));

  // Ordina le isole per affinità reciproca: si parte dalla più grande e a ogni
  // passo si accoda quella che scambia più archi con le già collocate. Il 32%
  // di archi che attraversa i gruppi (misurato su SARA2.0) resta, ma percorre
  // distanze brevi invece di tagliare la mappa da parte a parte.
  const islandOf = new Map<string, number>();
  islands.forEach((members, i) => members.forEach(f => islandOf.set(f, i)));
  const between = islands.map(() => new Array<number>(islands.length).fill(0));
  for (const l of links) {
    const a = islandOf.get(l.from);
    const b = islandOf.get(l.to);
    if (a === undefined || b === undefined || a === b) continue;
    between[a][b] += 1;
    between[b][a] += 1;
  }
  const order: number[] = [];
  const placed = new Set<number>();
  while (order.length < islands.length) {
    let pick = -1;
    let bestTies = -1;
    for (let i = 0; i < islands.length; i++) {
      if (placed.has(i)) continue;
      const ties = order.reduce((s, j) => s + between[i][j], 0);
      // Primo giro (nessuna piazzata): vince la più grande, cioè l'indice 0.
      if (ties > bestTies || (ties === bestTies && pick === -1)) {
        bestTies = ties;
        pick = i;
      }
    }
    order.push(pick);
    placed.add(pick);
  }
  const orderedIslands = order.map(i => islands[i]);

  const clusterOf = new Map<string, number>();
  const clusters: MemoryCluster[] = orderedIslands.map((members, id) => {
    const ordered = [...members].sort(
      (a, b) =>
        (inDeg.get(b) ?? 0) - (inDeg.get(a) ?? 0) || degOf(b) - degOf(a) || a.localeCompare(b)
    );
    for (const m of ordered) clusterOf.set(m, id);
    return { id, hub: ordered[0], label: graphLabel(ordered[0]), members: ordered };
  });
  loners.forEach((f, i) => clusterOf.set(f, clusters.length + i));

  // Anche i nodi in ordine canonico: chiude la garanzia "stesso archivio →
  // stesso grafo", qualunque ordine di lettura il chiamante abbia usato.
  const nodes: MemoryGraphNode[] = [...topics]
    .sort((a, b) => a.filename.localeCompare(b.filename))
    .map(t => ({
      filename: t.filename,
      name: t.name,
      label: graphLabel(t.filename),
      type: t.type,
      topic: t,
      inDeg: inDeg.get(t.filename) ?? 0,
      outDeg: outDeg.get(t.filename) ?? 0,
      clusterId: clusterOf.get(t.filename) ?? -1,
    }));

  // ---- affinità (suggerimenti, mai archi veri) ----
  const linked = new Set(links.flatMap(l => [`${l.from}|${l.to}`, `${l.to}|${l.from}`]));
  const tokens = new Map(topics.map(t => [t.filename, affinityTokens(t)]));
  const df = new Map<string, number>();
  for (const set of tokens.values()) for (const tok of set) df.set(tok, (df.get(tok) ?? 0) + 1);
  // Una parola presente in troppe memorie non distingue nulla: la soglia sale
  // con la dimensione dell'archivio invece di restare un numero fisso.
  const maxDf = Math.max(3, Math.ceil(topics.length * 0.15));

  const affinities: MemoryAffinity[] = [];
  for (let i = 0; i < topics.length; i++)
    for (let j = i + 1; j < topics.length; j++) {
      // Coppia normalizzata: quale delle due arrivi prima dipende dall'ordine
      // dei topic, che il chiamante non garantisce — senza normalizzare, la
      // stessa affinità uscirebbe come {a,b} o {b,a} a seconda della lettura.
      const [a, b] = [topics[i].filename, topics[j].filename].sort((x, y) => x.localeCompare(y));
      if (linked.has(`${a}|${b}`)) continue;
      const tb = tokens.get(b)!;
      const shared = [...tokens.get(a)!].filter(tok => tb.has(tok) && (df.get(tok) ?? 0) <= maxDf);
      if (!shared.length) continue;
      const weight = shared.reduce((s, tok) => s + 1 / (df.get(tok) ?? 1), 0);
      if (weight < AFFINITY_MIN_WEIGHT) continue;
      affinities.push({ a, b, shared: shared.sort(), weight: Math.round(weight * 100) / 100 });
    }
  // Ordine totale: `cap` più sotto tronca la lista, quindi a parità di peso un
  // ordinamento parziale cambierebbe *quali* suggerimenti sopravvivono.
  affinities.sort(
    (x, y) => y.weight - x.weight || x.a.localeCompare(y.a) || x.b.localeCompare(y.b)
  );
  // Tetto in proporzione all'archivio: la soglia da sola basta sui dati reali,
  // questo evita che un vocabolario molto ripetitivo riempia la vista.
  const cap = Math.max(6, Math.ceil(topics.length / 2));

  return {
    nodes,
    links,
    affinities: affinities.slice(0, cap),
    dangling,
    clusters,
    loners,
  };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Raggio del pallino: cresce con quante memorie citano quella (cap a 6). */
export function nodeRadius(inDeg: number): number {
  return 4.5 + Math.min(inDeg, 6) * 2.1;
}

/** Caratteri di etichetta disegnati sotto il nodo (oltre: ellissi). */
export const LABEL_MAX_CHARS = 24;

/** Spazio orizzontale che un'etichetta si prende (24 char di mono a 9px). */
const LABEL_W = 150;
/** Schiacciamento dell'anello: le etichette stanno sotto, serve più larghezza. */
const RING_RATIO = 0.62;
const INNER_RING = 0.6;
/** Fattore perimetro di un'ellisse con questo rapporto: 2π·√((1+ratio²)/2). */
const PERIMETER_K = 2 * Math.PI * Math.sqrt((1 + RING_RATIO * RING_RATIO) / 2);
const PAD_X = 86;
const PAD_Y = 44;
const GAP = 26;
const LONER_STEP = 152;
const LONER_ROW_H = 62;

export interface MemoryIsland {
  clusterId: number;
  hub: string;
  label: string;
  size: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MemoryGraphLayout {
  width: number;
  height: number;
  positions: Record<string, { x: number; y: number }>;
  islands: MemoryIsland[];
  /** Fascia delle memorie senza relazioni, in fondo (assente se non ce ne sono). */
  lonersBand: { y: number; height: number } | null;
}

/** Semiasse orizzontale che tiene le etichette di `m` satelliti separate. */
function ringRadius(m: number): number {
  if (m <= 7) return Math.max(96, (LABEL_W * m) / PERIMETER_K);
  const inner = Math.round(m * 0.37);
  const outer = m - inner;
  return Math.max(
    96,
    (LABEL_W * outer) / PERIMETER_K,
    (LABEL_W * inner) / (PERIMETER_K * INNER_RING)
  );
}

/**
 * Dispone le isole su scaffali di larghezza `maxWidth`, ogni cluster come un
 * hub centrale con i suoi satelliti su uno o due anelli.
 *
 * **Deterministico di proposito**: nessuna simulazione fisica, nessun seed
 * casuale. Un force-directed layout mette la stessa memoria in un punto
 * diverso a ogni apertura e trasforma i cluster in una nuvola indistinta —
 * qui la posizione è funzione dei soli dati, quindi il grafo si impara a
 * memoria e due aperture si confrontano.
 */
export function layoutMemoryGraph(graph: MemoryGraph, maxWidth = 1180): MemoryGraphLayout {
  const positions: Record<string, { x: number; y: number }> = {};
  const islands: MemoryIsland[] = [];

  let shelfX = 0;
  let shelfY = 0;
  let shelfH = 0;
  let usedWidth = 0;

  for (const cluster of graph.clusters) {
    const satellites = cluster.members.slice(1);
    const rx = ringRadius(satellites.length);
    const ry = rx * RING_RATIO;
    const w = rx * 2 + PAD_X * 2;
    const h = ry * 2 + PAD_Y * 2;

    if (shelfX > 0 && shelfX + w > maxWidth) {
      shelfY += shelfH + GAP;
      shelfX = 0;
      shelfH = 0;
    }
    const box: MemoryIsland = {
      clusterId: cluster.id,
      hub: cluster.hub,
      label: cluster.label,
      size: cluster.members.length,
      x: shelfX,
      y: shelfY,
      w,
      h,
    };
    islands.push(box);

    const cx = box.x + w / 2;
    const cy = box.y + h / 2;
    positions[cluster.hub] = { x: cx, y: cy };

    const twoRings = satellites.length > 7;
    const innerCount = twoRings ? Math.round(satellites.length * 0.37) : 0;
    const outerCount = satellites.length - innerCount;
    satellites.forEach((filename, i) => {
      const onInner = i >= outerCount;
      const idx = onInner ? i - outerCount : i;
      const count = onInner ? innerCount : outerCount;
      const scale = onInner ? INNER_RING : 1;
      // Mezzo passo di sfasamento sull'anello interno: due anelli allineati
      // metterebbero le etichette sulla stessa verticale.
      const offset = onInner ? Math.PI / count : 0;
      const angle = (idx / count) * Math.PI * 2 - Math.PI / 2 + offset;
      positions[filename] = {
        x: cx + Math.cos(angle) * rx * scale,
        y: cy + Math.sin(angle) * ry * scale,
      };
    });

    shelfX += w + GAP;
    shelfH = Math.max(shelfH, h);
    usedWidth = Math.max(usedWidth, Math.min(shelfX - GAP, Math.max(w, maxWidth)));
  }

  let height = graph.clusters.length ? shelfY + shelfH : 0;
  let lonersBand: MemoryGraphLayout['lonersBand'] = null;

  if (graph.loners.length) {
    const perRow = Math.max(1, Math.floor(maxWidth / LONER_STEP));
    const rows = Math.ceil(graph.loners.length / perRow);
    const bandTop = height ? height + GAP + 18 : 18;
    graph.loners.forEach((filename, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      positions[filename] = {
        x: LONER_STEP / 2 + col * LONER_STEP,
        y: bandTop + 22 + row * LONER_ROW_H,
      };
    });
    const bandHeight = rows * LONER_ROW_H + 34;
    lonersBand = { y: bandTop, height: bandHeight };
    height = bandTop + bandHeight;
    usedWidth = Math.max(usedWidth, Math.min(graph.loners.length, perRow) * LONER_STEP);
  }

  return {
    width: Math.max(usedWidth, 320),
    height: Math.max(height, 200),
    positions,
    islands,
    lonersBand,
  };
}

/** Vicinato di una memoria: chi la cita, chi cita, e il secondo grado. */
export interface MemoryNeighborhood {
  ring1: { filename: string; direction: 'in' | 'out' | 'both' }[];
  ring2: string[];
}

export function neighborhoodOf(graph: MemoryGraph, filename: string): MemoryNeighborhood {
  const dir = new Map<string, 'in' | 'out' | 'both'>();
  const add = (f: string, d: 'in' | 'out') => {
    const prev = dir.get(f);
    dir.set(f, prev && prev !== d ? 'both' : d);
  };
  for (const l of graph.links) {
    if (l.from === filename) add(l.to, 'out');
    if (l.to === filename) add(l.from, 'in');
  }
  const ring1 = [...dir.entries()]
    .map(([f, direction]) => ({ filename: f, direction }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
  const inRing1 = new Set(ring1.map(r => r.filename));

  const ring2 = new Set<string>();
  for (const l of graph.links) {
    if (inRing1.has(l.from) && l.to !== filename && !inRing1.has(l.to)) ring2.add(l.to);
    if (inRing1.has(l.to) && l.from !== filename && !inRing1.has(l.from)) ring2.add(l.from);
  }
  return { ring1, ring2: [...ring2].sort((a, b) => a.localeCompare(b)) };
}
