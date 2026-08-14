import { createPortal } from 'react-dom';
import { MEMORY_TYPE_TINT } from '../chat/utils';
import type { MemoryGraphNode } from './graph';

/** Larghezza fissa: rende il clamp orizzontale deterministico. */
const CARD_W = 288;
/** Stima d'ingombro verticale, usata solo per scegliere sopra/sotto. */
const CARD_H_GUESS = 158;

export interface PeekAnchor {
  node: MemoryGraphNode;
  rect: DOMRect;
  clusterLabel: string | null;
}

/**
 * La card che appare sostando su un nodo del grafo.
 *
 * Esiste perché sulla mappa l'etichetta di un nodo è **troncata a 24 caratteri**
 * e il resto della memoria (di che parla, quanto è citata) non è a schermo. Il
 * `<title>` SVG che c'era prima lo diceva, ma come rettangolo grigio dell'OS:
 * arriva un secondo dopo, non si può impaginare e non somiglia a niente
 * nell'app — la stessa ragione per cui le vitals di Mission Control hanno le
 * loro card al posto dei `title` nativi.
 *
 * `pointer-events: none` come quelle: non contiene controlli, quindi catturare
 * il cursore la terrebbe aperta dopo che il puntatore ha lasciato il nodo — e
 * qui, dove i nodi sono fitti, impedirebbe di passare al nodo accanto.
 */
export function MemoryPeekCard({ anchor }: { anchor: PeekAnchor }) {
  const { node, rect, clusterLabel } = anchor;
  const topic = node.topic;

  // Sopra il nodo se c'è spazio, altrimenti sotto: la card non deve mai uscire
  // dalla finestra, e sopra è la posizione che copre meno grafo sotto il cursore.
  const above = rect.top > CARD_H_GUESS + 12;
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - CARD_W / 2),
    Math.max(8, window.innerWidth - CARD_W - 8)
  );

  const cited =
    node.inDeg === 0
      ? 'not cited yet'
      : `cited by ${node.inDeg} ${node.inDeg === 1 ? 'memory' : 'memories'}`;

  return createPortal(
    <div
      role="tooltip"
      className="cl-mempeek"
      style={{
        left,
        width: CARD_W,
        ...(above
          ? { top: rect.top - 10, transform: 'translateY(-100%)' }
          : { top: rect.bottom + 10 }),
      }}
    >
      <div className="cl-mempeek-head">
        <span className="type" style={{ color: MEMORY_TYPE_TINT[node.type] }}>
          <i className="dot" style={{ background: MEMORY_TYPE_TINT[node.type] }} />
          {node.type}
        </span>
        {topic.isProjectLevel && <span className="scope">repo</span>}
      </div>

      <div className="cl-mempeek-name">{topic.name}</div>

      {topic.description ? (
        <p className="cl-mempeek-desc">{topic.description}</p>
      ) : (
        <p className="cl-mempeek-desc is-empty">No description.</p>
      )}

      <div className="cl-mempeek-foot">
        <span>{cited}</span>
        <span className="sep">·</span>
        <span>cites {node.outDeg}</span>
        {clusterLabel && (
          <>
            <span className="sep">·</span>
            <span className="cl-mempeek-cluster" title={`Cluster: ${clusterLabel}`}>
              {clusterLabel}
            </span>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
