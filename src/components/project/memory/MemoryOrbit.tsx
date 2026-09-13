import { useMemo, useState } from 'react';
import { MemoryTopic } from '../../../hooks/useIPC';
import { MEMORY_TYPE_TINT } from '../chat/utils';
import { buildMemoryGraph, neighborhoodOf, nodeRadius, MemoryGraph } from './graph';
import { MemoryPeekCard } from './MemoryPeekCard';
import { useMemoryPeek } from './useMemoryPeek';

/**
 * Larghezza di disegno. L'orbita vive nella rail del dettaglio, che è fissa a
 * 320px: tolti bordo e padding al canvas ne restano ~270, e il CSS gli vieta
 * di crescere oltre (`max-width`), così un'unità del viewBox disegna circa un
 * pixel. Prima era 620 — la larghezza di una mappa — e la rail la scalava a
 * 0,43: le etichette da 10px si rendevano a 4, i nodi a 3, e l'orbita si
 * indovinava invece di leggersi. Stessa taratura che la mappa ha dovuto rifare
 * quando il nodo è diventato un cerchio vuoto, con il vincolo all'inverso.
 */
const W = 280;
/** Caratteri di etichetta: 26 sulla mappa, che ha una finestra intera; qui 18. */
const LABEL_MAX_CHARS = 18;
/** Larghezza di un carattere di mono a 10px. */
const CHAR_W = 6.2;
const LABEL_W = LABEL_MAX_CHARS * CHAR_W;
/**
 * Quasi tondo (0.8, come i gruppi piccoli della mappa): lo schiacciamento
 * serve a distribuire etichette larghe lungo il giro, e in una colonna la
 * larghezza è proprio ciò che manca.
 */
const RING_RATIO = 0.8;
/** Fattore perimetro di un'ellisse con questo rapporto: 2π·√((1+ratio²)/2). */
const PERIMETER_K = 2 * Math.PI * Math.sqrt((1 + RING_RATIO * RING_RATIO) / 2);
/** Quanto la seconda orbita deve stare fuori dalle etichette della prima. */
const RING_GAP = 58;
/**
 * Quanto la seconda orbita deve restare fuori dalla prima **ai lati**, dove
 * il tetto di larghezza le schiaccerebbe sullo stesso semiasse: con sette
 * vicini diretti la prima orbita toccava già il bordo, la seconda anche, e le
 * due si sfioravano a destra e a sinistra — l'esterna smetteva di essere fuori.
 */
const SIDE_GAP = 40;
/** L'anello del fuoco, oltre il suo raggio: lo stesso dell'hub sulla mappa. */
const FOCUS_RING = 5.5;

/**
 * Semiassi di un'orbita che tiene separate le etichette di `m` satelliti.
 * `ideal` è il raggio che ci vorrebbe; `rx` è quello che la larghezza concede.
 */
function ringGeometry(
  m: number,
  minRx: number,
  cap: number
): { ideal: number; rx: number; ry: number } {
  const ideal = Math.max(minRx, (LABEL_W * m) / PERIMETER_K);
  // Il canvas è largo quanto la rail e non un pixel di più: se il giro ideale
  // non ci sta, l'anello si allunga in verticale — la colonna scorre, la
  // larghezza no — e le etichette, che sono testo orizzontale, si separano
  // meglio in altezza comunque.
  return { ideal, rx: Math.min(ideal, cap), ry: ideal * RING_RATIO };
}

/**
 * Il vicinato della memoria aperta: al centro lei, sull'orbita interna le
 * memorie in relazione diretta, su quella esterna il secondo grado.
 *
 * Stessa codifica della mappa (`MemoryGraphView`): il nodo è un cerchio vuoto
 * col bordo del tipo, il diametro dice quante memorie lo citano, chi sta al
 * centro porta un anello proprio, l'etichetta va verso l'esterno dell'orbita.
 * Un lettore che passa dalla mappa al dettaglio deve trovare gli stessi segni
 * con lo stesso significato.
 *
 * Qui — a differenza della mappa — **le frecce ci sono**: davanti a una
 * singola memoria la domanda è "questa cita quelle o è citata da quelle?",
 * cioè se stai leggendo una fonte o una conseguenza. Su pochi archi il verso
 * si legge; su tutta la mappa sarebbe rumore.
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
  const [hover, setHover] = useState<string | null>(null);
  const graph: MemoryGraph = useMemo(() => buildMemoryGraph(topics, contents), [topics, contents]);
  // La stessa card della mappa, con la stessa attesa: qui l'etichetta è ancora
  // più corta (18 caratteri) e la descrizione non è a schermo.
  const { peek, schedulePeek, cancelPeek } = useMemoryPeek(graph);
  const hood = useMemo(() => neighborhoodOf(graph, topic.filename), [graph, topic.filename]);
  const nodeBy = useMemo(() => new Map(graph.nodes.map(n => [n.filename, n])), [graph]);

  const focus = nodeBy.get(topic.filename);
  // Il grafo non conosce ancora questa memoria (l'elenco non è arrivato):
  // meglio niente che un "non collegata" che poi cambia idea.
  if (!focus) return null;

  const ring1 = hood.ring1.filter(r => nodeBy.has(r.filename));
  const ring2 = hood.ring2.filter(f => nodeBy.has(f));
  const inCount = ring1.filter(r => r.direction !== 'out').length;
  const outCount = ring1.filter(r => r.direction !== 'in').length;

  const head = (
    <h3>
      <span>Related memories</span>
      <b>
        {inCount} in · {outCount} out
        {ring2.length ? ` · ${ring2.length} second degree` : ''}
      </b>
    </h3>
  );

  // Una memoria senza relazioni resta dichiarata, come i "non collegati"
  // sotto la mappa: un pannello che sparisce non dice se la memoria è isolata
  // o se il vicinato non è stato letto. E se i suoi wikilink ci sono ma non
  // arrivano a una memoria (di solito: a un modulo di codice), lo dice — la
  // tape lì accanto li conta, e "it cites none" la smentirebbe.
  if (!ring1.length) {
    const outside = graph.dangling.filter(d => d.from === topic.filename).map(d => d.target);
    return (
      <div className="cl-entity-v2-opts">
        {head}
        <div className="cl-empty cl-memorbit-none">
          {outside.length ? (
            <>
              No memory cites this one, and its {outside.length === 1 ? 'link' : 'links'} point
              outside memory: {outside.map(t => `[[${t}]]`).join(', ')}.
            </>
          ) : (
            <>
              Unconnected — no memory cites this one, and it cites none. A [[wikilink]] in the body
              would draw the first arc.
            </>
          )}
        </div>
      </div>
    );
  }

  const radiusOf = (f: string) => nodeRadius(nodeBy.get(f)!.inDeg);
  const focusR = radiusOf(topic.filename);
  const maxR1 = Math.max(...ring1.map(r => radiusOf(r.filename)));
  const maxR2 = ring2.length ? Math.max(...ring2.map(radiusOf)) : 0;
  // Il fuoco col suo anello, un arco che si legga, il satellite più vicino: è
  // il vincolo vero del raggio minimo, non il caso peggiore di etichette.
  const minRx1 = Math.max(60, (focusR + maxR1 + 30) / RING_RATIO);
  const cap1 = W / 2 - 6 - maxR1 - (ring2.length ? SIDE_GAP : 0);
  const g1 = ringGeometry(ring1.length, minRx1, cap1);
  // Dal raggio ideale, non da quello concesso: è l'altezza della prima orbita
  // che la seconda deve superare, e quella non è stata schiacciata.
  const g2 = ring2.length
    ? ringGeometry(ring2.length, g1.ideal + RING_GAP, W / 2 - 6 - maxR2)
    : null;
  const outer = g2 ?? g1;
  const cx = W / 2;
  const cy = outer.ry + (g2 ? maxR2 : maxR1) + 24;
  const H = cy * 2;

  const pos = new Map<string, { x: number; y: number }>([[topic.filename, { x: cx, y: cy }]]);
  ring1.forEach((r, i) => {
    const a = (i / ring1.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(r.filename, { x: cx + Math.cos(a) * g1.rx, y: cy + Math.sin(a) * g1.ry });
  });
  if (g2) {
    ring2.forEach((f, i) => {
      // Sfasata di mezzo passo: un satellite esterno allineato al suo interno
      // sovrapporrebbe le etichette.
      const a = (i / ring2.length) * Math.PI * 2 - Math.PI / 2 + Math.PI / ring2.length;
      pos.set(f, { x: cx + Math.cos(a) * g2.rx, y: cy + Math.sin(a) * g2.ry });
    });
  }

  const clip = (s: string) =>
    s.length > LABEL_MAX_CHARS ? `${s.slice(0, LABEL_MAX_CHARS - 1)}…` : s;
  // L'etichetta resta dentro il canvas: un satellite sul bordo destro la
  // porterebbe fuori dalla card, quindi scivola verso l'interno quanto basta.
  const labelX = (x: number, text: string) => {
    const half = (text.length * CHAR_W) / 2;
    return Math.min(Math.max(x, half + 2), W - half - 2);
  };

  const visible = graph.links.filter(l => pos.has(l.from) && pos.has(l.to));
  const touches = (a: string, b: string) => hover === a || hover === b;
  const nameOf = (f: string) => nodeBy.get(f)?.name ?? f;

  const renderNode = (filename: string, p: { x: number; y: number }) => {
    const node = nodeBy.get(filename)!;
    const isFocus = filename === topic.filename;
    const r = nodeRadius(node.inDeg);
    const tint = MEMORY_TYPE_TINT[node.type];
    // Verso l'esterno dell'orbita: nella metà alta l'etichetta va sopra, o
    // finirebbe scritta sul tratteggio.
    const above = p.y < cy;
    const label = clip(node.label);
    const cited = node.inDeg === 1 ? '1 memory cites this' : `${node.inDeg} memories cite this`;
    return (
      <g
        key={filename}
        className={`cl-memgraph-node${isFocus ? ' is-focus' : ''}${
          hover === filename ? ' is-hover' : ''
        }`}
        role={isFocus ? undefined : 'button'}
        tabIndex={isFocus ? undefined : 0}
        onMouseEnter={e => {
          setHover(filename);
          schedulePeek(node, e.currentTarget);
        }}
        onMouseLeave={() => {
          setHover(h => (h === filename ? null : h));
          cancelPeek();
        }}
        onFocus={e => {
          setHover(filename);
          schedulePeek(node, e.currentTarget, true);
        }}
        onBlur={() => {
          setHover(h => (h === filename ? null : h));
          cancelPeek();
        }}
        onClick={
          isFocus
            ? undefined
            : () => {
                cancelPeek();
                onOpenTopic(node.topic);
              }
        }
        onKeyDown={
          isFocus
            ? undefined
            : e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  cancelPeek();
                  onOpenTopic(node.topic);
                }
                if (e.key === 'Escape') cancelPeek();
              }
        }
        aria-label={isFocus ? undefined : `${node.name} — ${node.type}, ${cited}`}
      >
        {!isFocus && <circle cx={p.x} cy={p.y} r={r + 7} className="cl-memgraph-halo" />}
        {/* Il centro dell'orbita porta l'anello dell'hub: "sta al centro" è
            detto dallo stesso segno che lo dice sulla mappa. */}
        {isFocus && (
          <circle
            cx={p.x}
            cy={p.y}
            r={r + FOCUS_RING}
            className="cl-memgraph-hub-ring"
            style={{ stroke: tint }}
          />
        )}
        {/* Cerchio vuoto: il fondo della card copre l'orbita e l'arco dove li
            attraversa, quindi il nodo ci sta sopra come una perla sul filo. */}
        <circle
          cx={p.x}
          cy={p.y}
          r={r}
          className="cl-memgraph-dot"
          style={{
            stroke: tint,
            fill: isFocus ? `color-mix(in oklch, ${tint} 22%, var(--cl-paper-2))` : undefined,
          }}
        />
        {/* Il fuoco non ha etichetta: il suo nome è il titolo della pagina, e
            sotto il centro, alla larghezza di una colonna, passano i satelliti
            della metà bassa — con tre vicini due stanno proprio a quell'altezza,
            e un nome lungo ci finiva sopra. */}
        {!isFocus && (
          <text
            x={labelX(p.x, label)}
            y={above ? p.y - r - 7 : p.y + r + 11}
            textAnchor="middle"
            className="cl-memgraph-label"
          >
            {label}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="cl-entity-v2-opts">
      {head}
      <div className="cl-memorbit">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Related memories"
          onMouseLeave={cancelPeek}
        >
          <defs>
            {/* Due punte, una per stato: il marker è condiviso fra gli archi e
                non eredita la classe della linea che lo porta. */}
            {(['', ' is-lit'] as const).map(lit => (
              <marker
                key={lit || 'plain'}
                id={`cl-memorbit-arrow${lit ? '-lit' : ''}`}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="5.5"
                markerHeight="5.5"
                orient="auto"
              >
                <path d="M0 0 L8 4 L0 8 z" className={`cl-memorbit-arrowhead${lit}`} />
              </marker>
            ))}
          </defs>

          <ellipse cx={cx} cy={cy} rx={g1.rx} ry={g1.ry} className="cl-memgraph-orbit" />
          {/* Il secondo anello solo se dei satelliti ci stanno sopra: un'orbita
              vuota affermerebbe una struttura che i dati non hanno. */}
          {g2 && <ellipse cx={cx} cy={cy} rx={g2.rx} ry={g2.ry} className="cl-memgraph-orbit" />}

          {visible.map(l => {
            const p = pos.get(l.from)!;
            const q = pos.get(l.to)!;
            const ux = q.x - p.x;
            const uy = q.y - p.y;
            const d = Math.hypot(ux, uy) || 1;
            // La punta si ferma sul bordo del nodo — o del suo anello, per il
            // fuoco — non al suo centro.
            const back = radiusOf(l.to) + (l.to === topic.filename ? FOCUS_RING : 0) + 4;
            const lit = touches(l.from, l.to);
            return (
              <line
                key={`${l.from}-${l.to}`}
                x1={p.x}
                y1={p.y}
                x2={q.x - (ux / d) * back}
                y2={q.y - (uy / d) * back}
                className={`cl-memorbit-link${lit ? ' is-lit' : ''}`}
                markerEnd={`url(#cl-memorbit-arrow${lit ? '-lit' : ''})`}
              >
                <title>{`${nameOf(l.from)} → ${nameOf(l.to)}`}</title>
              </line>
            );
          })}

          {[...pos.entries()].map(([filename, p]) => renderNode(filename, p))}
        </svg>
      </div>
      {peek && <MemoryPeekCard anchor={peek} />}
    </div>
  );
}
