import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MemoryTopic } from '../../../hooks/useIPC';
import { MEMORY_TYPE_TINT } from '../chat/utils';
import {
  buildMemoryGraph,
  layoutMemoryGraph,
  nodeRadius,
  LABEL_MAX_CHARS,
  MemoryGraphNode,
} from './graph';
import { MemoryPeekCard, PeekAnchor } from './MemoryPeekCard';

/**
 * Quanto bisogna sostare su un nodo prima che compaia la card.
 *
 * Il punto è distinguere "sto attraversando la mappa" da "voglio sapere cosa
 * c'è qui": i nodi sono fitti e senza attesa la card lampeggerebbe a ogni
 * spostamento del cursore. 420ms sta nella finestra dei tooltip di sistema
 * (400–500ms), abbastanza da non scattare di passaggio e non tanto da dover
 * aspettare quando ci si ferma davvero.
 */
const PEEK_DELAY_MS = 420;

/**
 * La sezione memoria come **mappa delle relazioni**: un'isola per cluster, con
 * l'hub (la memoria più citata) al centro e il suo nome sopra il gruppo.
 *
 * Gli archi pieni sono i `[[wikilink]]` scritti nelle memorie; quelli
 * tratteggiati sono affinità di parole, un suggerimento che la vista non
 * promuove mai a link — scrivere il wikilink resta un gesto esplicito, fatto
 * nel file. Le memorie che nessun link tocca stanno in fondo, dichiarate.
 *
 * Nessuna freccia qui: su una mappa d'insieme il verso di 28 archi è rumore, e
 * il diametro del pallino già dice quante memorie citano quella. La direzione
 * si legge nell'orbita del dettaglio (`MemoryOrbit`), dove è la domanda vera.
 */
export function MemoryGraphView({
  topics,
  contents,
  onOpenTopic,
}: {
  topics: MemoryTopic[];
  contents: Record<string, string>;
  onOpenTopic: (topic: MemoryTopic) => void;
}) {
  const [showAffinity, setShowAffinity] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [peek, setPeek] = useState<PeekAnchor | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const graph = useMemo(() => buildMemoryGraph(topics, contents), [topics, contents]);
  const layout = useMemo(() => layoutMemoryGraph(graph), [graph]);
  const nodeBy = useMemo(() => new Map(graph.nodes.map(n => [n.filename, n])), [graph]);
  const clusterLabelOf = useMemo(() => {
    const byId = new Map(graph.clusters.map(c => [c.id, c.label]));
    return (node: MemoryGraphNode) => byId.get(node.clusterId) ?? null;
  }, [graph]);

  const cancelPeek = useCallback(() => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = null;
    setPeek(null);
  }, []);

  /** `immediate` per il focus da tastiera: lì l'intenzione è già dichiarata. */
  const schedulePeek = useCallback(
    (node: MemoryGraphNode, target: SVGGElement, immediate = false) => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
      const open = () =>
        setPeek({
          node,
          rect: target.getBoundingClientRect(),
          clusterLabel: clusterLabelOf(node),
        });
      if (immediate) {
        peekTimer.current = null;
        open();
        return;
      }
      peekTimer.current = setTimeout(open, PEEK_DELAY_MS);
    },
    [clusterLabelOf]
  );

  // Timer pendente allo smontaggio, e la card ancorata a coordinate di viewport:
  // uno scroll la lascerebbe ferma mentre il nodo scorre via, quindi si chiude.
  useEffect(() => {
    if (!peek) return;
    const close = () => cancelPeek();
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [peek, cancelPeek]);

  useEffect(
    () => () => {
      if (peekTimer.current) clearTimeout(peekTimer.current);
    },
    []
  );

  const clip = (s: string) =>
    s.length > LABEL_MAX_CHARS ? `${s.slice(0, LABEL_MAX_CHARS - 1)}…` : s;

  const curve = (a: string, b: string) => {
    const p = layout.positions[a];
    const q = layout.positions[b];
    if (!p || !q) return null;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    // Arco leggermente bombato: due relazioni fra gli stessi vicini non si
    // sovrappongono e una linea retta attraverso l'hub si distinguerebbe male.
    const cx = (p.x + q.x) / 2 - (dy / d) * d * 0.12;
    const cy = (p.y + q.y) / 2 + (dx / d) * d * 0.12;
    return `M${p.x} ${p.y} Q${cx} ${cy} ${q.x} ${q.y}`;
  };

  const touches = (a: string, b: string) => hover === a || hover === b;

  const renderNode = (node: MemoryGraphNode) => {
    const p = layout.positions[node.filename];
    if (!p) return null;
    const r = nodeRadius(node.inDeg);
    const isHub = node.inDeg >= 3;
    const active = hover === node.filename;
    const cited = node.inDeg === 1 ? '1 memory cites this' : `${node.inDeg} memories cite this`;
    return (
      <g
        key={node.filename}
        className={`cl-memgraph-node${active ? ' is-hover' : ''}`}
        onMouseEnter={e => {
          setHover(node.filename);
          schedulePeek(node, e.currentTarget);
        }}
        onMouseLeave={() => {
          setHover(h => (h === node.filename ? null : h));
          cancelPeek();
        }}
        onFocus={e => {
          setHover(node.filename);
          schedulePeek(node, e.currentTarget, true);
        }}
        onBlur={() => {
          setHover(h => (h === node.filename ? null : h));
          cancelPeek();
        }}
        onClick={() => {
          cancelPeek();
          onOpenTopic(node.topic);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            cancelPeek();
            onOpenTopic(node.topic);
          }
          if (e.key === 'Escape') cancelPeek();
        }}
        role="button"
        tabIndex={0}
        aria-label={`${node.name} — ${node.type}, ${cited}`}
      >
        <circle cx={p.x} cy={p.y} r={r + 5} className="cl-memgraph-halo" />
        <circle cx={p.x} cy={p.y} r={r} fill={MEMORY_TYPE_TINT[node.type]} />
        <text
          x={p.x}
          y={p.y + r + 11}
          textAnchor="middle"
          className={`cl-memgraph-label${isHub ? ' is-hub' : ''}`}
        >
          {clip(node.label)}
        </text>
      </g>
    );
  };

  if (!graph.nodes.length) return <div className="cl-empty">No memory topics yet.</div>;

  const linkedCount = graph.nodes.length - graph.loners.length;

  return (
    <div className="cl-memgraph">
      <div className="cl-memgraph-bar">
        <span className="cl-memgraph-stats">
          <b>{graph.links.length}</b> links · <b>{graph.clusters.length}</b> clusters ·{' '}
          <b>{linkedCount}</b>/{graph.nodes.length} connected
        </span>
        <button
          type="button"
          className={`cl-tagbar-all${showAffinity ? ' on' : ''}`}
          onClick={() => setShowAffinity(v => !v)}
          title="Word affinity between memories — a suggestion, not a declared link"
        >
          Affinity <span className="ct">{graph.affinities.length}</span>
        </button>
      </div>

      <svg
        className="cl-memgraph-svg"
        viewBox={`-8 -26 ${layout.width + 16} ${layout.height + 44}`}
        role="img"
        aria-label={`Memory graph: ${graph.nodes.length} topics, ${graph.links.length} links`}
        onMouseLeave={cancelPeek}
      >
        {layout.islands.map(box => (
          <g key={box.clusterId}>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={13}
              className="cl-memgraph-island"
            />
            <text x={box.x + 13} y={box.y - 9} className="cl-memgraph-island-title">
              {clip(box.label).toUpperCase()}
            </text>
            <text
              x={box.x + box.w - 13}
              y={box.y - 9}
              textAnchor="end"
              className="cl-memgraph-island-meta"
            >
              {box.size} memories
            </text>
          </g>
        ))}

        {layout.lonersBand && (
          <text x={2} y={layout.lonersBand.y + 12} className="cl-memgraph-band-title">
            NO RELATIONS YET · {graph.loners.length}
          </text>
        )}

        {showAffinity &&
          graph.affinities.map(edge => {
            const d = curve(edge.a, edge.b);
            if (!d) return null;
            return (
              <path
                key={`aff-${edge.a}-${edge.b}`}
                d={d}
                className={`cl-memgraph-affinity${touches(edge.a, edge.b) ? ' is-lit' : ''}`}
              >
                <title>{`Suggested by shared words: ${edge.shared.join(', ')}`}</title>
              </path>
            );
          })}

        {graph.links.map(link => {
          const d = curve(link.from, link.to);
          if (!d) return null;
          // Un arco fra due gruppi attraversa la mappa e, a parità di peso
          // visivo, coprirebbe la struttura che i gruppi dichiarano: resta
          // leggibile ma arretra, e si accende all'hover come gli altri.
          const crosses = nodeBy.get(link.from)?.clusterId !== nodeBy.get(link.to)?.clusterId;
          return (
            <path
              key={`lnk-${link.from}-${link.to}`}
              d={d}
              className={`cl-memgraph-link${crosses ? ' is-cross' : ''}${
                touches(link.from, link.to) ? ' is-lit' : ''
              }`}
            >
              <title>{`${nodeBy.get(link.from)?.name ?? link.from} → ${
                nodeBy.get(link.to)?.name ?? link.to
              }`}</title>
            </path>
          );
        })}

        {graph.nodes.map(renderNode)}
      </svg>

      {peek && <MemoryPeekCard anchor={peek} />}

      <div className="cl-memgraph-legend">
        {(['project', 'reference', 'feedback', 'user'] as const)
          .filter(t => graph.nodes.some(n => n.type === t))
          .map(t => (
            <span key={t} className="sw">
              <i className="dot" style={{ background: MEMORY_TYPE_TINT[t] }} />
              {t}
            </span>
          ))}
        <span className="sw">
          <i className="ln" />
          declared link
        </span>
        <span className="sw">
          <i className="ln dash" />
          word affinity
        </span>
        <span className="sw">size = times cited</span>
        {graph.dangling.length > 0 && (
          <span
            className="sw muted"
            title={graph.dangling.map(d => `${d.from} → [[${d.target}]]`).join('\n')}
          >
            {graph.dangling.length} link{graph.dangling.length === 1 ? '' : 's'} point outside
            memory
          </span>
        )}
      </div>
    </div>
  );
}
