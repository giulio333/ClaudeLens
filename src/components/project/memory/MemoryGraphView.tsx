import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MemoryTopic } from '../../../hooks/useIPC';
import { MEMORY_TYPE_TINT } from '../chat/utils';
import {
  layoutMemoryGraph,
  nodeRadius,
  LABEL_MAX_CHARS,
  MemoryGraph,
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
 * La sezione memoria come **mappa delle relazioni**: un sistema di orbite per
 * cluster, con l'hub (la memoria più citata) al centro e i suoi satelliti
 * sull'anello tratteggiato che gli gira attorno.
 *
 * L'orbita ha preso il posto del riquadro (design 3a): una cornice rettangolare
 * dichiara un confine ma non dice nulla di come il gruppo è fatto, mentre
 * l'anello passa **per** i satelliti e rende leggibile a colpo d'occhio la sola
 * cosa che la disposizione codifica — chi sta al centro e chi gli gira attorno.
 * Il secondo anello si disegna solo quando i satelliti ci stanno davvero sopra:
 * un'orbita vuota sarebbe una struttura affermata e non presente.
 *
 * Gli archi pieni sono i `[[wikilink]]` scritti nelle memorie; quelli
 * tratteggiati sono affinità di parole, un suggerimento che la vista non
 * promuove mai a link — scrivere il wikilink resta un gesto esplicito, fatto
 * nel file. Le memorie che nessun link tocca **escono dal canvas** e sono
 * elencate per nome sotto la mappa: restano dichiarate, come prima, ma non
 * occupano più una fascia di grafo in cui non c'è alcun grafo da vedere.
 *
 * Nessuna freccia qui: su una mappa d'insieme il verso di 28 archi è rumore, e
 * il diametro del pallino già dice quante memorie citano quella. La direzione
 * si legge nell'orbita del dettaglio (`MemoryOrbit`), dove è la domanda vera.
 */
export function MemoryGraphView({
  graph,
  onOpenTopic,
}: {
  graph: MemoryGraph;
  onOpenTopic: (topic: MemoryTopic) => void;
}) {
  const [showAffinity, setShowAffinity] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [peek, setPeek] = useState<PeekAnchor | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const layout = useMemo(() => layoutMemoryGraph(graph), [graph]);
  const nodeBy = useMemo(() => new Map(graph.nodes.map(n => [n.filename, n])), [graph]);
  const hubs = useMemo(() => new Set(graph.clusters.map(c => c.hub)), [graph]);
  const islandBy = useMemo(
    () => new Map(layout.islands.map(i => [i.clusterId, i])),
    [layout.islands]
  );
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
    const isHub = hubs.has(node.filename);
    const tint = MEMORY_TYPE_TINT[node.type];
    // L'etichetta va **verso l'esterno dell'orbita**, non sempre sotto: un
    // satellite nella metà alta si portava dietro un'etichetta che cadeva
    // dentro l'anello, cioè scritta sopra il tratteggio. L'hub sta sul centro
    // e non ha un fuori: la sua resta sotto.
    const above = p.y < (islandBy.get(node.clusterId)?.cy ?? p.y);
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
        aria-label={`${node.name} — ${node.type}, ${cited}${isHub ? ', cluster hub' : ''}`}
      >
        <circle cx={p.x} cy={p.y} r={r + 7} className="cl-memgraph-halo" />
        {/* Il centro di un'orbita porta un anello proprio: il diametro codifica
            già le citazioni, quindi "sta al centro" ha bisogno di un segno che
            non sia di nuovo la dimensione. */}
        {isHub && (
          <circle
            cx={p.x}
            cy={p.y}
            r={r + 5.5}
            className="cl-memgraph-hub-ring"
            style={{ stroke: tint }}
          />
        )}
        {/* Cerchio **vuoto**, non pallino pieno: il fondo paper copre l'orbita
            dove la attraversa, quindi il nodo ci sta sopra come una perla sul
            filo invece di sembrarne infilzato. L'hub lo vela della propria
            tinta. */}
        <circle
          cx={p.x}
          cy={p.y}
          r={r}
          className="cl-memgraph-dot"
          style={{
            stroke: tint,
            fill: isHub ? `color-mix(in oklch, ${tint} 22%, var(--cl-paper))` : undefined,
          }}
        />
        <text
          x={p.x}
          y={above ? p.y - r - 7 : p.y + r + (isHub ? 15 : 11)}
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
  const loners = graph.loners.map(f => nodeBy.get(f)).filter((n): n is MemoryGraphNode => !!n);

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

      {graph.clusters.length === 0 ? (
        <div className="cl-empty">
          No memory declares a [[wikilink]] to another one yet — nothing to orbit.
        </div>
      ) : (
        <svg
          className="cl-memgraph-svg"
          viewBox={`-8 -26 ${layout.width + 16} ${layout.height + 44}`}
          role="img"
          aria-label={`Memory graph: ${graph.nodes.length} topics, ${graph.links.length} links`}
          onMouseLeave={cancelPeek}
        >
          {layout.islands.map(island => (
            <g key={island.clusterId} className="cl-memgraph-orbits">
              <ellipse
                cx={island.cx}
                cy={island.cy}
                rx={island.rx}
                ry={island.ry}
                className="cl-memgraph-orbit"
              />
              {/* Il secondo anello si disegna solo se ci stanno sopra dei
                  satelliti: un'orbita vuota affermerebbe una struttura che i
                  dati non hanno. */}
              {island.twoRings && (
                <ellipse
                  cx={island.cx}
                  cy={island.cy}
                  rx={island.innerRx}
                  ry={island.innerRy}
                  className="cl-memgraph-orbit"
                />
              )}
            </g>
          ))}

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
      )}

      {peek && <MemoryPeekCard anchor={peek} />}

      {loners.length > 0 && (
        <div className="cl-memgraph-loners">
          <span className="lbl">{loners.length} unconnected</span>
          <div className="chips">
            {loners.map(node => (
              <button
                key={node.filename}
                type="button"
                className="cl-memgraph-loner"
                title={node.name}
                onClick={() => onOpenTopic(node.topic)}
              >
                <i className="dot" style={{ background: MEMORY_TYPE_TINT[node.type] }} />
                {node.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="cl-memgraph-legend">
        {(['project', 'reference', 'feedback', 'user'] as const)
          .filter(t => graph.nodes.some(n => n.type === t))
          .map(t => (
            <span key={t} className="sw">
              <i className="dot" style={{ background: MEMORY_TYPE_TINT[t] }} />
              {t}
            </span>
          ))}
        {/* Niente voce per il tratto pieno: una linea fra due nodi di un grafo
            non ha bisogno di essere dichiarata "un legame". Resta ciò che il
            disegno non dice da sé. */}
        {showAffinity && graph.affinities.length > 0 && (
          <span className="sw">
            <i className="ln dash" />
            word affinity
          </span>
        )}
        <span className="sw">size = times cited</span>
        <span className="sw">ringed = cluster hub</span>
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
