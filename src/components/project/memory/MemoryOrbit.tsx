import { useMemo } from 'react';
import { MemoryTopic } from '../../../hooks/useIPC';
import { MEMORY_TYPE_TINT } from '../chat/utils';
import {
  buildMemoryGraph,
  neighborhoodOf,
  nodeRadius,
  LABEL_MAX_CHARS,
  MemoryGraph,
} from './graph';

/**
 * Il vicinato della memoria aperta: al centro lei, sull'orbita interna le
 * memorie in relazione diretta, su quella esterna il secondo grado.
 *
 * Qui — a differenza della mappa d'insieme — **le frecce ci sono**: davanti a
 * una singola memoria la domanda è "questa cita quelle o è citata da quelle?",
 * cioè se stai leggendo una fonte o una conseguenza. Su pochi archi il verso si
 * legge; su tutta la mappa sarebbe rumore.
 */
export function MemoryOrbit({
  topic,
  topics,
  contents,
  onOpenTopic,
}: {
  topic: MemoryTopic;
  topics: MemoryTopic[];
  contents: Record<string, string>;
  onOpenTopic: (topic: MemoryTopic) => void;
}) {
  const graph: MemoryGraph = useMemo(() => buildMemoryGraph(topics, contents), [topics, contents]);
  const hood = useMemo(() => neighborhoodOf(graph, topic.filename), [graph, topic.filename]);
  const nodeBy = useMemo(() => new Map(graph.nodes.map(n => [n.filename, n])), [graph]);

  const ring1 = hood.ring1.filter(r => nodeBy.has(r.filename));
  const ring2 = hood.ring2.filter(f => nodeBy.has(f));
  if (!ring1.length) return null;

  const W = 620;
  const RX1 = 132;
  const RY1 = 88;
  const RX2 = 258;
  const RY2 = 158;
  const H = ring2.length ? 400 : 268;
  const cx = W / 2;
  const cy = H / 2;

  const pos = new Map<string, { x: number; y: number }>([[topic.filename, { x: cx, y: cy }]]);
  ring1.forEach((r, i) => {
    const a = (i / ring1.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(r.filename, { x: cx + Math.cos(a) * RX1, y: cy + Math.sin(a) * RY1 });
  });
  ring2.forEach((f, i) => {
    // Sfasata di mezzo passo: un satellite esterno allineato al suo interno
    // sovrapporrebbe le etichette.
    const a = (i / ring2.length) * Math.PI * 2 - Math.PI / 2 + Math.PI / Math.max(ring2.length, 1);
    pos.set(f, { x: cx + Math.cos(a) * RX2, y: cy + Math.sin(a) * RY2 });
  });

  const clip = (s: string) =>
    s.length > LABEL_MAX_CHARS ? `${s.slice(0, LABEL_MAX_CHARS - 1)}…` : s;

  const visible = graph.links.filter(l => pos.has(l.from) && pos.has(l.to));
  const inCount = ring1.filter(r => r.direction !== 'out').length;
  const outCount = ring1.filter(r => r.direction !== 'in').length;

  return (
    <div className="cl-entity-v2-opts">
      <h3>
        <span>Related memories</span>
        <b>
          {inCount} in · {outCount} out
          {ring2.length ? ` · ${ring2.length} second degree` : ''}
        </b>
      </h3>
      <div className="cl-memorbit">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Related memories">
          <defs>
            <marker
              id="cl-memorbit-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="5.5"
              markerHeight="5.5"
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8 z" className="cl-memorbit-arrowhead" />
            </marker>
          </defs>

          <ellipse cx={cx} cy={cy} rx={RX1} ry={RY1} className="cl-memorbit-ring" />
          {ring2.length > 0 && (
            <ellipse cx={cx} cy={cy} rx={RX2} ry={RY2} className="cl-memorbit-ring" />
          )}

          {visible.map(l => {
            const p = pos.get(l.from)!;
            const q = pos.get(l.to)!;
            const target = nodeBy.get(l.to)!;
            const ux = q.x - p.x;
            const uy = q.y - p.y;
            const d = Math.hypot(ux, uy) || 1;
            // La punta si ferma sul bordo del pallino, non al suo centro.
            const back = (l.to === topic.filename ? 17 : nodeRadius(target.inDeg)) + 6;
            return (
              <line
                key={`${l.from}-${l.to}`}
                x1={p.x}
                y1={p.y}
                x2={q.x - (ux / d) * back}
                y2={q.y - (uy / d) * back}
                className="cl-memorbit-link"
                markerEnd="url(#cl-memorbit-arrow)"
              />
            );
          })}

          {[...pos.entries()].map(([filename, p]) => {
            const node = nodeBy.get(filename);
            if (!node) return null;
            const isFocus = filename === topic.filename;
            const r = isFocus ? 15 : nodeRadius(node.inDeg);
            return (
              <g
                key={filename}
                className={`cl-memorbit-node${isFocus ? ' is-focus' : ''}`}
                role={isFocus ? undefined : 'button'}
                tabIndex={isFocus ? undefined : 0}
                onClick={isFocus ? undefined : () => onOpenTopic(node.topic)}
                onKeyDown={
                  isFocus
                    ? undefined
                    : e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenTopic(node.topic);
                        }
                      }
                }
                aria-label={isFocus ? undefined : `Open ${node.name}`}
              >
                <title>{`${node.name}${
                  node.topic.description ? `\n\n${node.topic.description}` : ''
                }`}</title>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r}
                  fill={MEMORY_TYPE_TINT[node.type]}
                  className="cl-memorbit-dot"
                />
                <text
                  x={p.x}
                  y={p.y + r + 12}
                  textAnchor="middle"
                  className={`cl-memgraph-label${isFocus ? ' is-hub' : ''}`}
                >
                  {clip(node.label)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
