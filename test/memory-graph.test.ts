import {
  buildMemoryGraph,
  layoutMemoryGraph,
  neighborhoodOf,
  relationSummary,
  graphLabel,
  nodeRadius,
} from '../src/components/project/memory/graph';
import type { MemoryTopic } from '../src/types';

/**
 * Il grafo delle memorie è costruito dai `[[wikilink]]` presenti nei body. I
 * casi qui sotto sono quelli osservati sulle memorie reali di ClaudeLens: forme
 * di link incoerenti (underscore vs dash vs nome abbreviato), link a moduli di
 * codice che non sono memorie, e memorie senza alcuna relazione.
 */

function topic(filename: string, over: Partial<MemoryTopic> = {}): MemoryTopic {
  return {
    name: filename.replace(/\.md$/, ''),
    description: '',
    type: 'project',
    filename,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('buildMemoryGraph — wikilink resolution', () => {
  it('resolves a link written with the exact filename', () => {
    const topics = [topic('a.md'), topic('b.md')];
    const g = buildMemoryGraph(topics, { 'a.md': 'see [[b]]', 'b.md': '' });
    expect(g.links).toEqual([{ from: 'a.md', to: 'b.md', resolved: 'exact' }]);
  });

  it('treats underscore and dash as the same separator', () => {
    // Le memorie reali contengono entrambe le forme per lo stesso target.
    const topics = [topic('feedback_ui.md'), topic('project_design_system.md')];
    const g = buildMemoryGraph(topics, {
      'feedback_ui.md': 'vedi [[project-design-system]]',
      'project_design_system.md': '',
    });
    expect(g.links).toEqual([
      { from: 'feedback_ui.md', to: 'project_design_system.md', resolved: 'exact' },
    ]);
  });

  it('resolves an abbreviated target when it is the only candidate', () => {
    const topics = [topic('a.md'), topic('feedback_verify_with_live_tests.md')];
    const g = buildMemoryGraph(topics, {
      'a.md': 'come [[verify-with-live-tests]]',
      'feedback_verify_with_live_tests.md': '',
    });
    expect(g.links).toEqual([
      { from: 'a.md', to: 'feedback_verify_with_live_tests.md', resolved: 'fuzzy' },
    ]);
  });

  it('refuses to guess when an abbreviated target has several candidates', () => {
    // Meglio un link mancante che un link inventato fra due memorie diverse.
    const topics = [topic('a.md'), topic('feedback_cache.md'), topic('project_cache.md')];
    const g = buildMemoryGraph(topics, { 'a.md': '[[cache]]' });
    expect(g.links).toEqual([]);
    expect(g.dangling).toEqual([{ from: 'a.md', target: 'cache' }]);
  });

  it('matches the frontmatter name as an alias of the file', () => {
    const topics = [topic('a.md'), topic('b.md', { name: 'feedback-design-principles' })];
    const g = buildMemoryGraph(topics, { 'a.md': '[[feedback_design_principles]]' });
    expect(g.links.map(l => l.to)).toEqual(['b.md']);
  });

  it('reports links that point outside the memory set instead of dropping them', () => {
    const topics = [topic('reference_teams.md')];
    const g = buildMemoryGraph(topics, {
      'reference_teams.md': 'vedi [[subagents-reader]] e [[sessions-registry]]',
    });
    expect(g.links).toEqual([]);
    expect(g.dangling).toEqual([
      { from: 'reference_teams.md', target: 'subagents-reader' },
      { from: 'reference_teams.md', target: 'sessions-registry' },
    ]);
  });

  it('ignores self-links and collapses a target cited twice', () => {
    const topics = [topic('a.md'), topic('b.md')];
    const g = buildMemoryGraph(topics, { 'a.md': '[[a]] [[b]] ancora [[b]]' });
    expect(g.links).toEqual([{ from: 'a.md', to: 'b.md', resolved: 'exact' }]);
  });
});

describe('buildMemoryGraph — degree, clusters and loners', () => {
  const topics = [
    topic('hub.md'),
    topic('x.md'),
    topic('y.md'),
    topic('p.md'),
    topic('q.md'),
    topic('alone.md'),
  ];
  const contents = {
    'hub.md': '',
    'x.md': '[[hub]]',
    'y.md': '[[hub]]',
    'p.md': '[[q]]',
    'q.md': '',
    'alone.md': 'nessun link',
  };

  it('counts in-degree as "how many memories cite this"', () => {
    const g = buildMemoryGraph(topics, contents);
    const hub = g.nodes.find(n => n.filename === 'hub.md')!;
    expect(hub.inDeg).toBe(2);
    expect(hub.outDeg).toBe(0);
    const x = g.nodes.find(n => n.filename === 'x.md')!;
    expect(x.outDeg).toBe(1);
    expect(x.inDeg).toBe(0);
  });

  it('groups connected memories into clusters named after their most cited node', () => {
    const g = buildMemoryGraph(topics, contents);
    expect(g.clusters).toHaveLength(2);
    expect(g.clusters[0].hub).toBe('hub.md');
    expect(g.clusters[0].members).toHaveLength(3);
    expect(g.clusters[0].label).toBe('hub');
    expect(g.clusters[1].members.sort()).toEqual(['p.md', 'q.md']);
  });

  it('splits two dense themes joined by a single bridge link', () => {
    // Il caso che ha rotto la prima versione (componenti connesse) su SARA2.0:
    // due gruppi fitti e UN arco fra loro fondevano tutto in un'isola sola.
    const dense = (prefix: string) => ['a', 'b', 'c', 'd'].map(s => topic(`${prefix}${s}.md`));
    const nodes = [...dense('x'), ...dense('y')];
    const clique = (prefix: string) => ({
      [`${prefix}a.md`]: `[[${prefix}b]] [[${prefix}c]] [[${prefix}d]]`,
      [`${prefix}b.md`]: `[[${prefix}c]] [[${prefix}d]]`,
      [`${prefix}c.md`]: `[[${prefix}d]]`,
      [`${prefix}d.md`]: '',
    });
    const body = { ...clique('x'), ...clique('y') };
    body['xd.md'] = '[[ya]]'; // l'unico ponte fra i due temi
    const g = buildMemoryGraph(nodes, body);
    expect(g.clusters).toHaveLength(2);
    expect(g.clusters.map(c => c.members.length).sort()).toEqual([4, 4]);
    for (const c of g.clusters) {
      const prefixes = new Set(c.members.map(f => f[0]));
      expect(prefixes.size).toBe(1); // nessun gruppo mescola i due temi
    }
  });

  it('keeps a linked memory inside a cluster, never in the unconnected band', () => {
    // Un nodo appeso a un gruppo denso non deve finire fra gli scollegati:
    // da lì i suoi archi attraverserebbero la mappa contraddicendo la fascia.
    const nodes = [topic('a.md'), topic('b.md'), topic('c.md'), topic('tail.md')];
    const g = buildMemoryGraph(nodes, {
      'a.md': '[[b]] [[c]]',
      'b.md': '[[c]]',
      'c.md': '',
      'tail.md': '[[a]]',
    });
    expect(g.loners).toEqual([]);
    expect(g.clusters.flatMap(c => c.members)).toContain('tail.md');
  });

  it('lists memories no link touches instead of hiding them', () => {
    const g = buildMemoryGraph(topics, contents);
    expect(g.loners).toEqual(['alone.md']);
    expect(g.nodes.find(n => n.filename === 'alone.md')!.clusterId).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic: same input, same clusters and same order', () => {
    const a = buildMemoryGraph(topics, contents);
    const b = buildMemoryGraph([...topics], { ...contents });
    expect(JSON.stringify(b.clusters)).toBe(JSON.stringify(a.clusters));
    expect(JSON.stringify(b.links)).toBe(JSON.stringify(a.links));
  });

  it('handles an archive with no links at all', () => {
    const g = buildMemoryGraph([topic('a.md'), topic('b.md')], { 'a.md': '', 'b.md': '' });
    expect(g.links).toEqual([]);
    expect(g.clusters).toEqual([]);
    expect(g.loners).toEqual(['a.md', 'b.md']);
  });
});

describe('buildMemoryGraph — affinities stay separate from declared links', () => {
  it('never emits an affinity for a pair that already has a wikilink', () => {
    const topics = [
      topic('a.md', { description: 'terracotta palette tipografia' }),
      topic('b.md', { description: 'terracotta palette tipografia' }),
    ];
    const g = buildMemoryGraph(topics, { 'a.md': '[[b]]', 'b.md': '' });
    expect(g.links).toHaveLength(1);
    expect(g.affinities).toEqual([]);
  });

  it('suggests a pair that shares distinctive words', () => {
    const topics = [
      topic('a.md', { description: 'quarantena notarizzazione dmg' }),
      topic('b.md', { description: 'notarizzazione quarantena firma' }),
      topic('c.md', { description: 'tutt altro argomento qui' }),
    ];
    const g = buildMemoryGraph(topics, { 'a.md': '', 'b.md': '', 'c.md': '' });
    expect(g.affinities).toHaveLength(1);
    expect(g.affinities[0].shared).toEqual(['notarizzazione', 'quarantena']);
  });

  it('ignores words every memory carries, which would link everything to everything', () => {
    const topics = [
      topic('a.md', { description: 'memoria claude code progetto file' }),
      topic('b.md', { description: 'memoria claude code progetto file' }),
    ];
    const g = buildMemoryGraph(topics, { 'a.md': '', 'b.md': '' });
    expect(g.affinities).toEqual([]);
  });
});

describe('neighborhoodOf', () => {
  const topics = [topic('focus.md'), topic('citer.md'), topic('cited.md'), topic('far.md')];
  const contents = {
    'focus.md': '[[cited]]',
    'citer.md': '[[focus]]',
    'cited.md': '[[far]]',
    'far.md': '',
  };

  it('separates who cites the memory from who it cites', () => {
    const g = buildMemoryGraph(topics, contents);
    const hood = neighborhoodOf(g, 'focus.md');
    expect(hood.ring1).toEqual([
      { filename: 'cited.md', direction: 'out' },
      { filename: 'citer.md', direction: 'in' },
    ]);
  });

  it('puts the second degree on its own ring, never duplicated in the first', () => {
    const g = buildMemoryGraph(topics, contents);
    expect(neighborhoodOf(g, 'focus.md').ring2).toEqual(['far.md']);
  });

  it('marks a mutual citation as both directions', () => {
    const g = buildMemoryGraph([topic('a.md'), topic('b.md')], {
      'a.md': '[[b]]',
      'b.md': '[[a]]',
    });
    expect(neighborhoodOf(g, 'a.md').ring1).toEqual([{ filename: 'b.md', direction: 'both' }]);
  });

  it('returns an empty neighborhood for an unconnected memory', () => {
    const g = buildMemoryGraph([topic('a.md')], { 'a.md': '' });
    expect(neighborhoodOf(g, 'a.md')).toEqual({ ring1: [], ring2: [] });
  });
});

describe('layoutMemoryGraph', () => {
  const many = Array.from({ length: 14 }, (_, i) => topic(`n${i}.md`));
  // Un hub citato da tutti gli altri: l'isola grande che serve i due anelli.
  const contents = Object.fromEntries(many.map((t, i) => [t.filename, i === 0 ? '' : '[[n0]]']));

  it('places every node exactly once', () => {
    const g = buildMemoryGraph(many, contents);
    const l = layoutMemoryGraph(g);
    expect(Object.keys(l.positions).sort()).toEqual(many.map(t => t.filename).sort());
  });

  it('keeps node circles from overlapping inside a large island', () => {
    const g = buildMemoryGraph(many, contents);
    const l = layoutMemoryGraph(g);
    const entries = Object.entries(l.positions);
    for (let i = 0; i < entries.length; i++)
      for (let j = i + 1; j < entries.length; j++) {
        const [fa, pa] = entries[i];
        const [fb, pb] = entries[j];
        const ra = nodeRadius(g.nodes.find(n => n.filename === fa)!.inDeg);
        const rb = nodeRadius(g.nodes.find(n => n.filename === fb)!.inDeg);
        expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeGreaterThan(ra + rb);
      }
  });

  it('keeps every node inside the reported canvas', () => {
    const g = buildMemoryGraph(many, contents);
    const l = layoutMemoryGraph(g);
    for (const p of Object.values(l.positions)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(l.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(l.height);
    }
  });

  it('leaves the unconnected memories off the canvas, for the list below it', () => {
    // Un nodo senza archi su una mappa di relazioni è una posizione che non
    // significa nulla: resta dichiarato, ma come elenco fuori dal disegno.
    const g = buildMemoryGraph([...many, topic('lone.md')], { ...contents, 'lone.md': '' });
    const l = layoutMemoryGraph(g);
    expect(g.loners).toContain('lone.md');
    expect(l.positions['lone.md']).toBeUndefined();
    expect(Object.keys(l.positions).sort()).toEqual(many.map(t => t.filename).sort());
  });

  it('puts the hub at the centre of its own orbit and the satellites on it', () => {
    const g = buildMemoryGraph(many, contents);
    const l = layoutMemoryGraph(g);
    const island = l.islands[0];
    // L'orbita è ciò che si disegna: se il suo centro non fosse l'hub, il
    // cerchio tratteggiato passerebbe accanto ai nodi invece che per loro.
    expect(l.positions[island.hub]).toEqual({ x: island.cx, y: island.cy });
    const onEllipse = (p: { x: number; y: number }, rx: number, ry: number) =>
      Math.abs(((p.x - island.cx) / rx) ** 2 + ((p.y - island.cy) / ry) ** 2 - 1) < 1e-9;
    const satellites = g.clusters[0].members.filter(f => f !== island.hub);
    for (const f of satellites) {
      const p = l.positions[f];
      expect(
        onEllipse(p, island.rx, island.ry) || onEllipse(p, island.innerRx, island.innerRy)
      ).toBe(true);
    }
  });

  it('draws a small group almost round and a crowded one flattened', () => {
    // Lo schiacciamento serve a distribuire etichette larghe lungo il giro: con
    // due satelliti non c'è nulla da distribuire e i due lati restano vuoti.
    const pair = [topic('a.md'), topic('b.md'), topic('c.md')];
    const small = layoutMemoryGraph(
      buildMemoryGraph(pair, { 'a.md': '[[c]]', 'b.md': '[[c]]', 'c.md': '' })
    );
    expect(small.islands[0].ry / small.islands[0].rx).toBeCloseTo(0.8);
    expect(small.islands[0].rx).toBeLessThan(96); // il vecchio minimo fisso

    const crowded = layoutMemoryGraph(buildMemoryGraph(many, contents));
    expect(crowded.islands[0].ry / crowded.islands[0].rx).toBeCloseTo(0.62);
  });

  it('reports a second orbit only when satellites actually sit on it', () => {
    // 13 satelliti: due anelli. Una coppia: uno solo — disegnare comunque un
    // anello interno affermerebbe una struttura che i dati non hanno.
    const crowded = layoutMemoryGraph(buildMemoryGraph(many, contents));
    expect(crowded.islands[0].twoRings).toBe(true);
    const pair = [topic('a.md'), topic('b.md')];
    const small = layoutMemoryGraph(buildMemoryGraph(pair, { 'a.md': '[[b]]', 'b.md': '' }));
    expect(small.islands[0].twoRings).toBe(false);
  });

  it('wraps islands onto a new shelf instead of overflowing the width', () => {
    // Sei coppie indipendenti: non ci stanno su una riga sola.
    const pairs = Array.from({ length: 6 }, (_, i) => [
      topic(`a${i}.md`),
      topic(`b${i}.md`),
    ]).flat();
    const c = Object.fromEntries(
      pairs.map(t => [t.filename, t.filename.startsWith('a') ? `[[b${t.filename[1]}]]` : ''])
    );
    const l = layoutMemoryGraph(buildMemoryGraph(pairs, c), 600);
    expect(l.islands.length).toBe(6);
    for (const box of l.islands) expect(box.x + box.w).toBeLessThanOrEqual(600);
    expect(new Set(l.islands.map(b => b.y)).size).toBeGreaterThan(1);
  });

  it('survives an empty graph', () => {
    const l = layoutMemoryGraph(buildMemoryGraph([], {}));
    expect(l.islands).toEqual([]);
    expect(l.positions).toEqual({});
  });
});

/**
 * La stessa relazione che la mappa disegna come arco, detta a parole: è quello
 * che l'elenco può mostrare, dove non c'è una posizione da leggere.
 */
describe('relationSummary', () => {
  const TOPICS = [
    topic('feedback_hub.md', { name: 'Stage only my own files' }),
    topic('feedback_one.md', { name: 'No assistant attribution' }),
    topic('feedback_two.md', { name: 'Avoid shared branches' }),
    topic('feedback_alone.md', { name: 'Review before merge' }),
  ];
  const CONTENTS = {
    'feedback_hub.md': '',
    'feedback_one.md': 'vedi [[feedback_hub]] e [[feedback_two]]',
    'feedback_two.md': 'vedi [[feedback_hub]]',
    'feedback_alone.md': 'nessun collegamento',
  };
  const graph = buildMemoryGraph(TOPICS, CONTENTS);

  it('counts who cites the memory and names what it cites', () => {
    expect(relationSummary(graph, 'feedback_hub.md')).toMatchObject({
      inDeg: 2,
      outDeg: 0,
      cites: [],
    });
    expect(relationSummary(graph, 'feedback_one.md')).toMatchObject({
      inDeg: 0,
      outDeg: 2,
      // Il titolo con cui ciascuna si presenta nell'elenco — non lo slug della
      // mappa, o citarla non basterebbe a ritrovarla scorrendo la lista — e in
      // ordine canonico, non in quello in cui compaiono nel testo: la riga deve
      // leggersi uguale a ogni apertura.
      cites: ['Avoid shared branches', 'Stage only my own files'],
    });
  });

  it('marks the most cited memory of a group as its hub, and no other', () => {
    expect(relationSummary(graph, 'feedback_hub.md').isHub).toBe(true);
    expect(relationSummary(graph, 'feedback_one.md').isHub).toBe(false);
    expect(relationSummary(graph, 'feedback_hub.md').clusterLabel).toBe('hub');
  });

  it('says nothing rather than something wrong about a memory with no relations', () => {
    expect(relationSummary(graph, 'feedback_alone.md')).toEqual({
      inDeg: 0,
      outDeg: 0,
      isHub: false,
      cites: [],
      clusterLabel: null,
    });
  });

  it('answers for a filename the graph never saw', () => {
    expect(relationSummary(graph, 'nope.md').inDeg).toBe(0);
    expect(relationSummary(graph, 'nope.md').isHub).toBe(false);
  });
});

describe('graphLabel', () => {
  it('drops the type prefix and the extension', () => {
    expect(graphLabel('feedback_ui_language.md')).toBe('ui language');
    expect(graphLabel('project_design_system.md')).toBe('design system');
  });

  it('leaves a filename with no type prefix alone', () => {
    expect(graphLabel('notes.md')).toBe('notes');
  });
});
