// @vitest-environment jsdom
//
// La hover card del grafo delle memorie. La regola che vale la pena difendere
// è il ritardo: i nodi sono fitti, e una card che compare al primo passaggio
// del cursore lampeggerebbe a ogni movimento invece di rispondere a "voglio
// sapere cosa c'è qui".

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryGraphView } from '../src/components/project/memory/MemoryGraphView';
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

const TOPICS = [
  topic('project_alpha.md', {
    name: 'A memory whose full title is far too long for the graph label',
    description: 'Quello che questa memoria ricorda, in una frase.',
  }),
  topic('project_beta.md', { name: 'Beta' }),
  topic('project_gamma.md', { name: 'Gamma' }),
];
const CONTENTS = {
  'project_alpha.md': '',
  'project_beta.md': '[[project_alpha]]',
  'project_gamma.md': '[[project_alpha]]',
};

function renderGraph() {
  const onOpenTopic = vi.fn();
  const view = render(
    <MemoryGraphView topics={TOPICS} contents={CONTENTS} onOpenTopic={onOpenTopic} />
  );
  const nodes = [...view.container.querySelectorAll('.cl-memgraph-node')];
  const alpha = nodes.find(n => (n.getAttribute('aria-label') ?? '').startsWith('A memory'))!;
  return { ...view, onOpenTopic, alpha, nodes };
}

const card = () => document.querySelector('.cl-mempeek');

describe('MemoryGraphView — hover peek card', () => {
  it('stays hidden while the cursor is only passing over a node', () => {
    vi.useFakeTimers();
    const { alpha } = renderGraph();

    fireEvent.mouseEnter(alpha);
    act(() => void vi.advanceTimersByTime(300)); // meno dell'attesa
    expect(card()).toBeNull();

    fireEvent.mouseLeave(alpha);
    act(() => void vi.advanceTimersByTime(5000));
    expect(card()).toBeNull(); // uscire annulla l'apertura in sospeso
  });

  it('opens once the pointer has dwelled on the node', () => {
    vi.useFakeTimers();
    const { alpha } = renderGraph();

    fireEvent.mouseEnter(alpha);
    act(() => void vi.advanceTimersByTime(500));

    expect(card()).not.toBeNull();
    // Il titolo intero, che sulla mappa è troncato a 24 caratteri.
    expect(
      screen.getByText('A memory whose full title is far too long for the graph label')
    ).toBeTruthy();
    expect(screen.getByText('Quello che questa memoria ricorda, in una frase.')).toBeTruthy();
    // Alpha è citata da beta e gamma.
    expect(screen.getByText('cited by 2 memories')).toBeTruthy();
  });

  it('moves to the node the pointer switched to, without leaving two cards up', () => {
    vi.useFakeTimers();
    const { alpha, nodes } = renderGraph();
    const other = nodes.find(n => n !== alpha)!;

    fireEvent.mouseEnter(alpha);
    act(() => void vi.advanceTimersByTime(500));
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);

    fireEvent.mouseLeave(alpha);
    fireEvent.mouseEnter(other);
    act(() => void vi.advanceTimersByTime(500));

    const open = screen.getAllByRole('tooltip');
    expect(open).toHaveLength(1);
    expect(open[0].textContent).not.toContain('A memory whose full title');
  });

  it('closes when the node is clicked, so the card never outlives the view', () => {
    vi.useFakeTimers();
    const { alpha, onOpenTopic } = renderGraph();

    fireEvent.mouseEnter(alpha);
    act(() => void vi.advanceTimersByTime(500));
    expect(card()).not.toBeNull();

    fireEvent.click(alpha);
    expect(onOpenTopic).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
  });

  it('shows immediately on keyboard focus — the intent is already explicit', () => {
    vi.useFakeTimers();
    const { alpha } = renderGraph();

    fireEvent.focus(alpha);
    expect(card()).not.toBeNull(); // nessuna attesa

    fireEvent.blur(alpha);
    expect(card()).toBeNull();
  });

  it('closes on scroll, where a viewport-anchored card would drift off its node', () => {
    vi.useFakeTimers();
    const { alpha } = renderGraph();

    fireEvent.mouseEnter(alpha);
    act(() => void vi.advanceTimersByTime(500));
    expect(card()).not.toBeNull();

    act(() => void window.dispatchEvent(new Event('scroll')));
    expect(card()).toBeNull();
  });

  it('leaves no card behind when the graph unmounts mid-dwell', () => {
    vi.useFakeTimers();
    const { alpha, unmount } = renderGraph();

    fireEvent.mouseEnter(alpha);
    unmount();
    act(() => void vi.advanceTimersByTime(5000));

    expect(card()).toBeNull();
  });

  it('does not render a native SVG title, which would double the card', () => {
    const { container } = renderGraph();
    expect(container.querySelector('.cl-memgraph-node title')).toBeNull();
  });
});
