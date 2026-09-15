import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MemoryGraph, MemoryGraphNode } from './graph';
import type { PeekAnchor, PeekPlacement } from './MemoryPeekCard';

/**
 * Quanto bisogna sostare su un nodo prima che compaia la card.
 *
 * Il punto è distinguere "sto attraversando il disegno" da "voglio sapere cosa
 * c'è qui": i nodi sono fitti e senza attesa la card lampeggerebbe a ogni
 * spostamento del cursore. 420ms sta nella finestra dei tooltip di sistema
 * (400–500ms), abbastanza da non scattare di passaggio e non tanto da dover
 * aspettare quando ci si ferma davvero.
 */
const PEEK_DELAY_MS = 420;

/**
 * Lo stato della card di hover, condiviso dalla mappa, dall'orbita del
 * dettaglio e dall'elenco: stessa attesa, stessa chiusura su scroll e resize,
 * stesso "subito" per il focus da tastiera. Un lettore che sosta su una memoria
 * deve ottenere la stessa risposta in ogni vista — e la seconda l'aveva persa
 * per strada.
 */
export function useMemoryPeek(graph: MemoryGraph, placement?: PeekPlacement) {
  const [peek, setPeek] = useState<PeekAnchor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clusterLabelOf = useMemo(() => {
    const byId = new Map(graph.clusters.map(c => [c.id, c.label]));
    return (node: MemoryGraphNode) => byId.get(node.clusterId) ?? null;
  }, [graph]);

  const cancelPeek = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPeek(null);
  }, []);

  /** `immediate` per il focus da tastiera: lì l'intenzione è già dichiarata.
   *  `target` è ciò a cui la card si ancora: il `<g>` di un nodo sulla mappa e
   *  nell'orbita, il titolo di una riga nell'elenco. */
  const schedulePeek = useCallback(
    (node: MemoryGraphNode, target: Element, immediate = false) => {
      if (timer.current) clearTimeout(timer.current);
      const open = () =>
        setPeek({
          node,
          rect: target.getBoundingClientRect(),
          clusterLabel: clusterLabelOf(node),
          placement,
        });
      if (immediate) {
        timer.current = null;
        open();
        return;
      }
      timer.current = setTimeout(open, PEEK_DELAY_MS);
    },
    [clusterLabelOf, placement]
  );

  // La card è ancorata a coordinate di viewport: uno scroll la lascerebbe
  // ferma mentre il nodo scorre via, quindi si chiude.
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

  // Timer pendente allo smontaggio.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return { peek, schedulePeek, cancelPeek };
}
