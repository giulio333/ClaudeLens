import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  buildMemoryGraph,
  layoutMemoryGraph,
  nodeRadius,
  type MemoryGraph,
} from '../src/components/project/memory/graph';
import type { MemoryTopic } from '../src/types';

/**
 * Il grafo misurato su **tutti gli archivi di memoria presenti su questa
 * macchina**, non su fixture — scoperti scandendo `~/.claude/projects`, così il
 * corpus cresce da sé man mano che si lavora invece di restare i due progetti
 * che avevo sott'occhio quando l'ho scritto.
 *
 * È il file che ha trovato i due difetti veri di questa feature:
 *
 * 1. **L'hairball.** Con le componenti connesse, SARA2.0 (1,91 archi per nodo)
 *    collassava in un'unica isola da 39 nodi mentre ClaudeLens (0,85) sembrava
 *    a posto: un solo arco fra due temi bastava a fonderli. Da qui il passaggio
 *    alla modularità.
 * 2. **La dipendenza dall'ordine di lettura.** I topic arrivano da un `readdir`,
 *    il cui ordine non è garantito fra filesystem; permutando l'input la
 *    partizione cambiava su 2 archivi su 6. Un grafo che si riorganizza a ogni
 *    apertura non si può imparare a memoria — che è tutto il punto della vista.
 *
 * Si auto-salta dove quelle cartelle non esistono (CI, altre macchine): è una
 * sonda per chi sviluppa qui, non un test che possa rompersi altrove.
 */

const PROJECTS = join(homedir(), '.claude', 'projects');

interface Archive {
  name: string;
  topics: MemoryTopic[];
  contents: Record<string, string>;
}

function loadArchive(hash: string): Archive | null {
  const dir = join(PROJECTS, hash, 'memory');
  if (!existsSync(dir)) return null;
  let files: string[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md');
  } catch {
    return null;
  }
  if (files.length < 4) return null;

  const topics: MemoryTopic[] = [];
  const contents: Record<string, string> = {};
  for (const filename of files) {
    let raw: string;
    try {
      raw = readFileSync(join(dir, filename), 'utf8');
    } catch {
      continue;
    }
    const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    const block = fm ? fm[1] : '';
    const get = (k: string) =>
      new RegExp(`^\\s*${k}:\\s*"?(.*?)"?\\s*$`, 'm').exec(block)?.[1] ?? '';
    const prefix = filename.split('_')[0];
    const declared = get('type');
    const type = (['user', 'feedback', 'project', 'reference'] as const).find(
      t => t === declared || t === prefix
    );
    topics.push({
      name: get('name') || filename.replace(/\.md$/, ''),
      description: get('description'),
      type: type ?? 'user',
      filename,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    contents[filename] = fm ? raw.slice(fm[0].length) : raw;
  }
  return {
    name: hash.replace(/^-Users-[^-]+-/, ''),
    topics,
    contents,
  };
}

/** Ogni archivio locale che abbia abbastanza memorie E almeno una relazione. */
function discoverArchives(): Archive[] {
  if (!existsSync(PROJECTS)) return [];
  let hashes: string[];
  try {
    hashes = readdirSync(PROJECTS);
  } catch {
    return [];
  }
  return hashes
    .map(loadArchive)
    .filter((a): a is Archive => !!a)
    .filter(a => buildMemoryGraph(a.topics, a.contents).links.length > 0)
    .sort((a, b) => b.topics.length - a.topics.length);
}

/** Permutazione riproducibile: `Math.random` renderebbe il test intermittente. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clusterSignature = (g: MemoryGraph) =>
  g.clusters
    .map(c => [...c.members].sort().join(','))
    .sort()
    .join(' | ');

/**
 * Modularità Q della partizione prodotta: la misura standard di quanto un
 * raggruppamento spiega la topologia. Q ≈ 0 significa "come raggruppare a
 * caso"; sopra ~0,3 la struttura comunitaria è considerata reale.
 */
function modularity(g: MemoryGraph): number {
  const m = g.links.length;
  if (!m) return 0;
  const communityOf = new Map<string, number>();
  g.clusters.forEach(c => c.members.forEach(f => communityOf.set(f, c.id)));
  // Ogni memoria scollegata è una comunità a sé.
  g.loners.forEach((f, i) => communityOf.set(f, 10_000 + i));

  const degree = new Map<string, number>();
  for (const l of g.links) {
    degree.set(l.from, (degree.get(l.from) ?? 0) + 1);
    degree.set(l.to, (degree.get(l.to) ?? 0) + 1);
  }
  let inside = 0;
  for (const l of g.links) if (communityOf.get(l.from) === communityOf.get(l.to)) inside++;

  const totalDegree = new Map<number, number>();
  for (const [f, d] of degree) {
    const c = communityOf.get(f)!;
    totalDegree.set(c, (totalDegree.get(c) ?? 0) + d);
  }
  let expected = 0;
  for (const t of totalDegree.values()) expected += (t / (2 * m)) ** 2;
  return inside / m - expected;
}

const ARCHIVES = discoverArchives();

describe.skipIf(ARCHIVES.length === 0)('memory graph on every local archive', () => {
  it('found archives to probe', () => {
    expect(ARCHIVES.length).toBeGreaterThan(0);
  });

  for (const archive of ARCHIVES) {
    describe(`${archive.name} (${archive.topics.length} topics)`, () => {
      const graph = buildMemoryGraph(archive.topics, archive.contents);

      it('resolves relations without inventing any', () => {
        expect(graph.nodes).toHaveLength(archive.topics.length);
        const known = new Set(archive.topics.map(t => t.filename));
        for (const l of graph.links) {
          expect(known.has(l.from)).toBe(true);
          expect(known.has(l.to)).toBe(true);
          expect(l.from).not.toBe(l.to);
        }
        // Un'affinità non deve mai raddoppiare una relazione già dichiarata.
        const declared = new Set(
          graph.links.flatMap(l => [`${l.from}|${l.to}`, `${l.to}|${l.from}`])
        );
        for (const a of graph.affinities) expect(declared.has(`${a.a}|${a.b}`)).toBe(false);
      });

      it('never collapses the archive into one giant island', () => {
        const biggest = Math.max(...graph.clusters.map(c => c.members.length), 0);
        expect(biggest).toBeLessThan(graph.nodes.length * 0.6);
      });

      it('produces a grouping that explains the topology (modularity > 0.15)', () => {
        // Soglia bassa di proposito: è una rete anti-regressione, non un
        // bersaglio. Gli archivi reali stanno fra 0,17 e 0,66; un algoritmo che
        // scende sotto questa riga sta raggruppando quasi a caso.
        expect(modularity(graph)).toBeGreaterThan(0.15);
      });

      it('keeps most links inside a cluster', () => {
        const communityOf = new Map<string, number>();
        graph.clusters.forEach(c => c.members.forEach(f => communityOf.set(f, c.id)));
        const inside = graph.links.filter(
          l => communityOf.has(l.from) && communityOf.get(l.from) === communityOf.get(l.to)
        ).length;
        expect(inside / graph.links.length).toBeGreaterThan(0.5);
      });

      it('gives the same graph whatever order the topics were read in', () => {
        // Il difetto #2 in testa al file. Confronta l'output INTERO: cluster,
        // archi, affinità, scollegate — non solo i gruppi.
        const canonical = JSON.stringify({
          clusters: clusterSignature(graph),
          order: graph.clusters.map(c => c.hub),
          links: graph.links,
          affinities: graph.affinities,
          dangling: graph.dangling,
          loners: graph.loners,
          nodes: graph.nodes.map(n => [n.filename, n.inDeg, n.outDeg, n.clusterId]),
        });
        for (const seed of [7, 42, 1234, 99_999, 5, 31_337]) {
          const other = buildMemoryGraph(shuffled(archive.topics, seed), archive.contents);
          expect(
            JSON.stringify({
              clusters: clusterSignature(other),
              order: other.clusters.map(c => c.hub),
              links: other.links,
              affinities: other.affinities,
              dangling: other.dangling,
              loners: other.loners,
              nodes: other.nodes.map(n => [n.filename, n.inDeg, n.outDeg, n.clusterId]),
            })
          ).toBe(canonical);
        }
      });

      it('keeps a memory in the same cluster as its strongest neighbours when one more is added', () => {
        // Robustezza al caso quotidiano: si scrive una memoria nuova. Il grafo
        // può assestarsi, ma non deve riorganizzarsi da capo.
        const extra: MemoryTopic = {
          name: 'zz probe topic',
          description: 'una memoria nuova, scollegata',
          type: 'user',
          filename: 'zz_probe_topic.md',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        };
        const grown = buildMemoryGraph([...archive.topics, extra], {
          ...archive.contents,
          'zz_probe_topic.md': 'nessun collegamento qui',
        });
        // Una memoria senza link non tocca i gruppi esistenti.
        expect(clusterSignature(grown)).toBe(clusterSignature(graph));
        expect(grown.loners).toContain('zz_probe_topic.md');
      });

      it('lays out every memory without overlapping another', () => {
        const layout = layoutMemoryGraph(graph);
        const radius = new Map(graph.nodes.map(n => [n.filename, nodeRadius(n.inDeg)]));
        const entries = Object.entries(layout.positions);
        expect(entries).toHaveLength(graph.nodes.length);
        for (let i = 0; i < entries.length; i++)
          for (let j = i + 1; j < entries.length; j++) {
            const [fa, pa] = entries[i];
            const [fb, pb] = entries[j];
            expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeGreaterThan(
              radius.get(fa)! + radius.get(fb)!
            );
          }
      });

      it('draws in-cluster links shorter than cross-cluster ones', () => {
        // La prova che il layout riflette il raggruppamento: se un arco interno
        // fosse lungo quanto uno che attraversa la mappa, le isole sarebbero
        // solo una cornice disegnata attorno a posizioni arbitrarie.
        const layout = layoutMemoryGraph(graph);
        const clusterOf = new Map(graph.nodes.map(n => [n.filename, n.clusterId]));
        const len = (l: (typeof graph.links)[number]) => {
          const p = layout.positions[l.from];
          const q = layout.positions[l.to];
          return Math.hypot(p.x - q.x, p.y - q.y);
        };
        const inside = graph.links.filter(l => clusterOf.get(l.from) === clusterOf.get(l.to));
        const across = graph.links.filter(l => clusterOf.get(l.from) !== clusterOf.get(l.to));
        if (!inside.length || !across.length) return; // archivio troppo semplice
        const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
        expect(mean(inside.map(len))).toBeLessThan(mean(across.map(len)));
      });

      it('puts in the unconnected band only memories with no link at all', () => {
        const linked = new Set(graph.links.flatMap(l => [l.from, l.to]));
        for (const f of graph.loners) expect(linked.has(f)).toBe(false);
        // e viceversa: nessuna memoria collegata resta fuori dai gruppi
        const grouped = new Set(graph.clusters.flatMap(c => c.members));
        for (const f of linked) expect(grouped.has(f)).toBe(true);
      });
    });
  }
});
