import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { MinimapItem, TurnDescriptor } from './utils';

/** Right-edge timeline minimap (Focus layout). A hairline vertical track with
 *  one proportionally-placed dot per message turn — accent-coloured & larger for
 *  Claude/agent turns, muted & small for user turns. Labels surface on hover only
 *  so the chrome stays out of the way; click jumps, active dot is emphasised.
 *
 *  Adaptive ruler: the track height is measured live, so when a session has many
 *  turns the per-dot spacing shrinks. Dot diameters and accent/active rings scale
 *  with that spacing (one dot per turn is always kept) — at high density the rail
 *  reads as a fine, evenly-gapped ruler instead of a crowded blob; at low density
 *  the dots stay full-size. */
export function FocusMinimap({
  items,
  active,
  matches,
  onJump,
}: {
  items: MinimapItem[];
  active: number | null;
  matches: (d: TurnDescriptor) => boolean;
  onJump: (n: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackH, setTrackH] = useState(0);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setTrackH(entries[0].contentRect.height));
    ro.observe(el);
    setTrackH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  if (items.length === 0) return null;

  // Density factor t: 0 = cramped, 1 = roomy. The threshold is the *effective*
  // dot width including its ring — a full accent dot is 9px + 3px ring/side = 15px,
  // so we only reach full size once the gap clears ~18px; below that, dots and
  // rings shrink so a visible gap always remains. Until the track is measured we
  // assume roomy so dots never flash tiny on first paint.
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const spacing = trackH > 0 && items.length > 1 ? trackH / (items.length - 1) : Infinity;
  const t = clamp01((spacing - 3) / (18 - 3));
  const lerp = (a: number, b: number, f = t) => +(a + (b - a) * f).toFixed(2);
  // Rings are the main source of the "solid blob": only fade them in once the
  // track is genuinely roomy (t > 0.5), so dense views stay ring-free dots.
  const tr = clamp01((t - 0.5) * 2);
  const railVars = {
    '--dot': `${lerp(2, 7)}px`,
    '--dot-accent': `${lerp(2.5, 9)}px`,
    '--dot-active': `${lerp(7, 11)}px`, // floored at 7px so the cursor stays legible
    '--ring': `${lerp(0, 3, tr)}px`,
    '--ring-active': `${lerp(1, 3, tr)}px`,
  } as CSSProperties;

  return (
    <nav className="cl-focus-rail" aria-label="Turn index">
      <div ref={trackRef} className="cl-focus-rail-track" style={railVars}>
        {items.map((it, i) => {
          const top = items.length <= 1 ? 50 : (i / (items.length - 1)) * 100;
          return (
            <button
              key={it.n}
              type="button"
              className="cl-focus-dot"
              style={{ top: `${top}%`, '--c': it.color } as CSSProperties}
              data-accent={it.variant !== 'user' || undefined}
              data-active={active === it.n || undefined}
              data-dim={!matches(it) || undefined}
              onClick={() => onJump(it.n)}
              title={`${String(it.n).padStart(2, '0')} · ${it.label} · ${it.time}`}
              aria-label={`Jump to turn ${it.n}, ${it.label}`}
            >
              <span className="lbl">
                {String(it.n).padStart(2, '0')} {it.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
