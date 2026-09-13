// @vitest-environment jsdom
//
// Il vicinato di una memoria aperta, nella rail del suo dettaglio. Porta gli
// stessi segni della mappa (nodo vuoto col bordo del tipo, anello sul centro,
// etichetta verso l'esterno dell'orbita, secondo anello solo se abitato) e
// aggiunge il suo: le frecce, perché davanti a una sola memoria la domanda è
// "fonte o conseguenza?". E deve starci in una colonna da 320px, dove il
// canvas di prima si rendeva a meno di metà scala.

import { StrictMode } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryOrbit } from '../src/components/project/memory/MemoryOrbit';
import { parseMemoryContent } from '../src/components/project/memory/utils';
import type { MemoryTopic } from '../src/types';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const topic = (filename: string, over: Partial<MemoryTopic> = {}): MemoryTopic => ({
  name: filename.replace(/\.md$/, ''),
  description: '',
  type: 'project',
  filename,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

function mount(focus: string, topics: MemoryTopic[], contents: Record<string, string>) {
  const onOpenTopic = vi.fn();
  const view = render(
    <StrictMode>
      <MemoryOrbit
        topic={topics.find(t => t.filename === focus)!}
        topics={topics}
        contents={contents}
        onOpenTopic={onOpenTopic}
      />
    </StrictMode>
  );
  return { ...view, onOpenTopic };
}

/** La memoria aperta cita `source` ed è citata da `reader`; `far` cita `reader`. */
const TOPICS = [
  topic('project_focus.md', { name: 'Focus' }),
  topic('project_source.md', { name: 'Source', type: 'reference' }),
  topic('project_reader.md', { name: 'Reader' }),
  topic('project_far.md', { name: 'Far' }),
];
const CONTENTS = {
  'project_focus.md': 'vedi [[project_source]]',
  'project_source.md': '',
  'project_reader.md': 'vedi [[project_focus]]',
  'project_far.md': 'vedi [[project_reader]]',
};

const numAttr = (el: Element | null, name: string) => Number(el?.getAttribute(name));
const satellitesOf = (container: HTMLElement) =>
  [...container.querySelectorAll('.cl-memgraph-node')].filter(
    g => !g.classList.contains('is-focus')
  );

describe('MemoryOrbit — the map’s encoding, in the rail', () => {
  it('centres the open memory on the orbit and rings it, like the map rings a hub', () => {
    const { container } = mount('project_focus.md', TOPICS, CONTENTS);
    const orbits = container.querySelectorAll('.cl-memgraph-orbit');
    const ring = container.querySelector('.cl-memgraph-hub-ring')!;
    expect(container.querySelectorAll('.cl-memgraph-hub-ring')).toHaveLength(1);
    expect(numAttr(ring, 'cx')).toBe(numAttr(orbits[0], 'cx'));
    expect(numAttr(ring, 'cy')).toBe(numAttr(orbits[0], 'cy'));
    // Il fuoco è la pagina che si sta leggendo: non è un bottone e non ha
    // etichetta — il suo nome è il titolo, e sotto il centro passano i
    // satelliti della metà bassa.
    const focus = container.querySelector('.cl-memgraph-node.is-focus')!;
    expect(focus.getAttribute('role')).toBeNull();
    expect(focus.querySelector('text')).toBeNull();
    expect(container.textContent).toContain('1 in · 1 out · 1 second degree');
  });

  it('draws the nodes hollow, after the orbit, so the ring passes behind them', () => {
    const { container } = mount('project_focus.md', TOPICS, CONTENTS);
    const dot = satellitesOf(container)[0].querySelector<SVGElement>('.cl-memgraph-dot')!;
    expect(dot.style.stroke).toBeTruthy();
    expect(dot.style.fill).toBe('');
    const drawn = [
      ...container.querySelectorAll('.cl-memgraph-orbit, .cl-memorbit-link, .cl-memgraph-dot'),
    ];
    expect(drawn[0].classList.contains('cl-memgraph-orbit')).toBe(true);
    expect(drawn[drawn.length - 1].classList.contains('cl-memgraph-dot')).toBe(true);
  });

  it('turns each satellite label outwards, so none is written on the orbit', () => {
    const { container } = mount('project_focus.md', TOPICS, CONTENTS);
    const cy = numAttr(container.querySelector('.cl-memgraph-orbit'), 'cy');
    const sides = satellitesOf(container).map(g => {
      const ny = numAttr(g.querySelector('.cl-memgraph-dot'), 'cy');
      const ty = numAttr(g.querySelector('text'), 'y');
      expect(Math.abs(ty - cy)).toBeGreaterThan(Math.abs(ny - cy));
      return Math.sign(ny - cy);
    });
    // Sopra e sotto entrambi presenti, o la regola non sarebbe stata provata.
    expect(new Set(sides).size).toBe(2);
  });

  it('draws an arrow per link, pointing at the cited memory', () => {
    const { container } = mount('project_focus.md', TOPICS, CONTENTS);
    const lines = [...container.querySelectorAll<SVGLineElement>('.cl-memorbit-link')];
    expect(lines).toHaveLength(3); // focus→source, reader→focus, far→reader
    for (const l of lines) expect(l.getAttribute('marker-end')).toMatch(/cl-memorbit-arrow/);

    const focus = container.querySelector('.cl-memgraph-node.is-focus .cl-memgraph-dot')!;
    const fx = numAttr(focus, 'cx');
    const fy = numAttr(focus, 'cy');
    const toFocus = lines.find(l => l.querySelector('title')!.textContent === 'Reader → Focus')!;
    // La punta (x2,y2) sta dal lato del fuoco, la coda dal lato di chi cita.
    const tip = Math.hypot(numAttr(toFocus, 'x2') - fx, numAttr(toFocus, 'y2') - fy);
    const tail = Math.hypot(numAttr(toFocus, 'x1') - fx, numAttr(toFocus, 'y1') - fy);
    expect(tip).toBeLessThan(tail);
    // …e si ferma fuori dall'anello del fuoco, non al suo centro.
    expect(tip).toBeGreaterThan(numAttr(container.querySelector('.cl-memgraph-hub-ring'), 'r'));
  });

  it('draws the second orbit only when a second degree sits on it', () => {
    const { container: withFar } = mount('project_focus.md', TOPICS, CONTENTS);
    expect(withFar.querySelectorAll('.cl-memgraph-orbit')).toHaveLength(2);

    const near = TOPICS.filter(t => t.filename !== 'project_far.md');
    const { container: without } = mount('project_focus.md', near, CONTENTS);
    expect(without.querySelectorAll('.cl-memgraph-orbit')).toHaveLength(1);
    expect(without.textContent).not.toContain('second degree');
  });

  it('keeps every label inside the canvas, however long the name at the edge', () => {
    const long = 'A memory whose name runs well past the label budget';
    const topics = [
      topic('project_focus.md', { name: 'Focus' }),
      ...['n', 'e', 's', 'w'].map(k => topic(`project_${k}.md`, { name: `${long} ${k}` })),
    ];
    const contents = Object.fromEntries(
      topics.map(t => [t.filename, t.filename === 'project_focus.md' ? '' : '[[project_focus]]'])
    );
    const { container } = mount('project_focus.md', topics, contents);
    const svg = container.querySelector('svg')!;
    const width = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
    const labels = [...container.querySelectorAll<SVGTextElement>('.cl-memgraph-label')];
    expect(labels).toHaveLength(4);
    for (const t of labels) {
      expect(t.textContent!.length).toBeLessThanOrEqual(18);
      const half = (t.textContent!.length * 6.2) / 2;
      const x = numAttr(t, 'x');
      expect(x - half).toBeGreaterThanOrEqual(0);
      expect(x + half).toBeLessThanOrEqual(width);
    }
    // Quattro satelliti: uno a destra e uno a sinistra, che è dove il vecchio
    // canvas sbordava. Il viewBox è tarato sulla rail, non su una finestra.
    expect(width).toBeLessThanOrEqual(320);
  });

  it('keeps the second orbit outside the first when both hit the width cap', () => {
    // Sette vicini diretti chiedono un giro più largo della rail; otto di
    // secondo grado pure. Senza un tetto proprio per la prima orbita le due si
    // schiacciavano sullo stesso semiasse e si toccavano ai lati.
    const topics = [topic('project_focus.md', { name: 'Focus' })];
    const contents: Record<string, string> = { 'project_focus.md': '' };
    for (let i = 0; i < 7; i++) {
      topics.push(topic(`project_near_${i}.md`));
      contents[`project_near_${i}.md`] = '[[project_focus]]';
    }
    for (let i = 0; i < 8; i++) {
      topics.push(topic(`project_far_${i}.md`));
      contents[`project_far_${i}.md`] = `[[project_near_${i % 7}]]`;
    }
    const { container } = mount('project_focus.md', topics, contents);
    const [inner, outer] = [...container.querySelectorAll('.cl-memgraph-orbit')];
    const width = Number(container.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);
    expect(numAttr(outer, 'rx') - numAttr(inner, 'rx')).toBeGreaterThanOrEqual(30);
    expect(numAttr(outer, 'ry') - numAttr(inner, 'ry')).toBeGreaterThanOrEqual(30);
    expect(numAttr(outer, 'cx') + numAttr(outer, 'rx')).toBeLessThanOrEqual(width);
  });

  it('opens a satellite on click, never the open memory itself', () => {
    const { container, onOpenTopic } = mount('project_focus.md', TOPICS, CONTENTS);
    fireEvent.click(container.querySelector('.cl-memgraph-node.is-focus')!);
    expect(onOpenTopic).not.toHaveBeenCalled();
    const source = satellitesOf(container).find(g =>
      g.getAttribute('aria-label')!.startsWith('Source')
    )!;
    fireEvent.click(source);
    expect(onOpenTopic).toHaveBeenCalledTimes(1);
    expect(onOpenTopic.mock.calls[0][0].filename).toBe('project_source.md');
  });

  it('says so when the memory is unconnected, instead of vanishing', () => {
    const { container } = mount('project_far.md', TOPICS, {
      ...CONTENTS,
      'project_far.md': 'nessun link qui',
    });
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('Related memories');
    expect(container.textContent).toContain('0 in · 0 out');
    expect(container.textContent).toContain('Unconnected');
  });

  it('names the links that point outside memory instead of saying it cites none', () => {
    const { container } = mount('project_far.md', TOPICS, {
      ...CONTENTS,
      'project_far.md': 'vedi [[electron/modules/session-reader]]',
    });
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('0 in · 0 out');
    expect(container.textContent).toContain('[[electron/modules/session-reader]]');
    expect(container.textContent).not.toContain('cites none');
  });

  it('shows the same hover card as the map, after the same dwell', () => {
    vi.useFakeTimers();
    const topics = TOPICS.map(t =>
      t.filename === 'project_source.md'
        ? { ...t, name: 'A source whose title outruns the label', description: 'Cosa ricorda.' }
        : t
    );
    const { container } = mount('project_focus.md', topics, CONTENTS);
    const source = satellitesOf(container).find(g =>
      g.getAttribute('aria-label')!.startsWith('A source')
    )!;
    const card = () => document.querySelector('.cl-mempeek');

    fireEvent.mouseEnter(source);
    act(() => void vi.advanceTimersByTime(300));
    expect(card()).toBeNull(); // di passaggio
    act(() => void vi.advanceTimersByTime(200));
    expect(card()!.textContent).toContain('A source whose title outruns the label');
    expect(card()!.textContent).toContain('Cosa ricorda.');

    fireEvent.mouseLeave(source);
    expect(card()).toBeNull();

    // Anche il fuoco: la card dice il gruppo e i conteggi, che la pagina non ha.
    fireEvent.mouseEnter(container.querySelector('.cl-memgraph-node.is-focus')!);
    act(() => void vi.advanceTimersByTime(500));
    expect(card()!.textContent).toContain('cited by 1 memory');
  });

  it('renders nothing while the graph does not know the memory yet', () => {
    const { container } = mount('project_focus.md', TOPICS, CONTENTS);
    const stranger = render(
      <StrictMode>
        <MemoryOrbit
          topic={topic('elsewhere.md')}
          topics={[]}
          contents={{}}
          onOpenTopic={vi.fn()}
        />
      </StrictMode>
    );
    expect(stranger.container.innerHTML).toBe('');
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('parseMemoryContent — the tape counts the links the orbit draws', () => {
  it('counts [[wikilinks]] alongside markdown links', () => {
    const { linkCount } = parseMemoryContent(
      '---\nname: x\n---\nVedi [[alpha]] e [[beta|Beta]], più [docs](https://x.y).'
    );
    expect(linkCount).toBe(3);
  });
});
