// @vitest-environment jsdom
//
// La mappa delle memorie nella forma a orbite (design 3a). Tre affermazioni che
// il riquadro precedente non faceva:
//
//  - il gruppo è un'orbita centrata sull'hub, non una cornice che lo contiene;
//  - il secondo anello si disegna solo se dei satelliti ci stanno sopra — un
//    anello vuoto sarebbe una struttura affermata e non presente nei dati;
//  - le memorie senza relazioni escono dal canvas e diventano un elenco
//    cliccabile: restano dichiarate, ma non occupano più una fascia di grafo in
//    cui non c'è alcun grafo da vedere.

import { StrictMode } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryGraphView } from '../src/components/project/memory/MemoryGraphView';
import { buildMemoryGraph } from '../src/components/project/memory/graph';
import type { MemoryTopic } from '../src/types';

afterEach(cleanup);

const topic = (filename: string, over: Partial<MemoryTopic> = {}): MemoryTopic => ({
  name: filename.replace(/\.md$/, ''),
  description: '',
  type: 'project',
  filename,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

function mount(topics: MemoryTopic[], contents: Record<string, string>) {
  const onOpenTopic = vi.fn();
  const view = render(
    <StrictMode>
      <MemoryGraphView graph={buildMemoryGraph(topics, contents)} onOpenTopic={onOpenTopic} />
    </StrictMode>
  );
  return { ...view, onOpenTopic };
}

/** Un hub citato da due memorie, più una memoria isolata. */
const TOPICS = [
  topic('project_hub.md', { name: 'Hub' }),
  topic('project_one.md', { name: 'One' }),
  topic('project_two.md', { name: 'Two' }),
  topic('project_alone.md', { name: 'Alone' }),
];
const CONTENTS = {
  'project_hub.md': '',
  'project_one.md': 'vedi [[project_hub]]',
  'project_two.md': 'vedi [[project_hub]]',
  'project_alone.md': 'nessun collegamento qui',
};

describe('MemoryGraphView — orbits', () => {
  it('draws one orbit per cluster, centred on the hub, and no island box', () => {
    const { container } = mount(TOPICS, CONTENTS);
    const orbits = [...container.querySelectorAll('.cl-memgraph-orbit')];
    expect(orbits).toHaveLength(1); // un cluster, un anello: i satelliti sono 2
    expect(container.querySelector('.cl-memgraph-island')).toBeNull();

    // Il centro dell'anello è esattamente dove sta l'hub: se non lo fosse, il
    // tratteggio passerebbe accanto ai nodi invece che per loro.
    const hub = container.querySelector('[aria-label^="Hub"] circle:last-of-type')!;
    expect(orbits[0].getAttribute('cx')).toBe(hub.getAttribute('cx'));
    expect(orbits[0].getAttribute('cy')).toBe(hub.getAttribute('cy'));
  });

  it('rings the hub, so "at the centre" is said by something other than size', () => {
    const { container } = mount(TOPICS, CONTENTS);
    const rings = [...container.querySelectorAll('.cl-memgraph-hub-ring')];
    expect(rings).toHaveLength(1);
    expect(container.querySelector('[aria-label^="Hub"]')!.getAttribute('aria-label')).toContain(
      'cluster hub'
    );
  });

  it('draws the nodes hollow, so the orbit passes behind them and not through', () => {
    const { container } = mount(TOPICS, CONTENTS);
    const satellite = [...container.querySelectorAll('.cl-memgraph-node')].find(
      g => !(g.getAttribute('aria-label') ?? '').includes('cluster hub')
    )!;
    const dot = satellite.querySelector<SVGElement>('.cl-memgraph-dot')!;
    // Il tipo sta sul bordo, non sul riempimento: il riempimento è la carta, ed
    // è quello che copre il tratteggio dove il nodo lo incontra.
    expect(dot.style.stroke).toBeTruthy();
    expect(dot.style.fill).toBe('');
    // …e per coprirlo dev'essere disegnato dopo.
    const drawn = [...container.querySelectorAll('.cl-memgraph-orbit, .cl-memgraph-dot')];
    expect(drawn[0].classList.contains('cl-memgraph-orbit')).toBe(true);
    expect(drawn[drawn.length - 1].classList.contains('cl-memgraph-dot')).toBe(true);
  });

  it('turns each label outwards, so none of them is written on the orbit', () => {
    const { container } = mount(TOPICS, CONTENTS);
    const orbitCy = Number(container.querySelector('.cl-memgraph-orbit')!.getAttribute('cy'));
    const satellites = [...container.querySelectorAll('.cl-memgraph-node')].filter(
      g => !(g.getAttribute('aria-label') ?? '').includes('cluster hub')
    );
    expect(satellites).toHaveLength(2);

    const sides = satellites.map(g => {
      const cy = Number(g.querySelector('circle:last-of-type')!.getAttribute('cy'));
      const ty = Number(g.querySelector('text')!.getAttribute('y'));
      // Più lontana dal centro di quanto lo sia il nodo: è questo che la tiene
      // fuori dall'anello, invece che sopra il suo tratteggio.
      expect(Math.abs(ty - orbitCy)).toBeGreaterThan(Math.abs(cy - orbitCy));
      return Math.sign(cy - orbitCy);
    });
    // Uno sopra e uno sotto: senza, la regola non sarebbe stata messa alla prova.
    expect(new Set(sides).size).toBe(2);
  });

  it('lists the unconnected memories outside the canvas, and opens them', () => {
    const { container, onOpenTopic } = mount(TOPICS, CONTENTS);
    const strip = container.querySelector('.cl-memgraph-loners')!;
    expect(strip.textContent).toContain('1 unconnected');
    // Fuori dal disegno, non in fondo ad esso.
    expect(container.querySelector('svg .cl-memgraph-loner')).toBeNull();

    const chip = strip.querySelector('.cl-memgraph-loner')!;
    fireEvent.click(chip);
    expect(onOpenTopic).toHaveBeenCalledTimes(1);
    expect(onOpenTopic.mock.calls[0][0].filename).toBe('project_alone.md');
  });

  it('says so instead of drawing an empty canvas when nothing is linked', () => {
    const { container } = mount([topic('a.md'), topic('b.md')], { 'a.md': '', 'b.md': '' });
    expect(container.querySelector('.cl-memgraph-svg')).toBeNull();
    expect(container.textContent).toContain('nothing to orbit');
    // Le due memorie restano comunque nominate.
    expect(container.querySelectorAll('.cl-memgraph-loner')).toHaveLength(2);
  });
});
