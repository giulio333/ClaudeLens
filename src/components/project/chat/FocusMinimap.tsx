import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { MinimapItem, TurnDescriptor, TurnVariant } from './utils';

/** Turn navigator capsule (design "Lens variants · nastro") — a vertical pill
 *  floating at the LEFT edge of the reading column. Top-to-bottom: a rotated
 *  "TURNS" label, one tick bar per message turn (width/colour encode the turn
 *  kind: wide ink for prompts, slim for Claude, tinted for agents/skills/…),
 *  the active turn as a numbered accent circle (the scroll-spy cursor), and the
 *  total turn count at the foot. Labels surface on hover only; click jumps.
 *
 *  Adaptive ruler: ticks are positioned proportionally inside a track whose
 *  height grows with the turn count but is capped by the available viewport
 *  height — a long session compresses into a fine ruler instead of overflowing. */

/** Tick width per turn kind — prompts are landmarks, Claude turns are the grain. */
function tickWidth(variant: TurnVariant): number {
  if (variant === 'user') return 14;
  if (variant === 'claude') return 9;
  if (variant === 'notification') return 10;
  return 12; // agent / skill / command / question / plan
}

/** Tick colour: regular conversation turns stay muted (the design's grey grain);
 *  special turns (agent, skill, plan, …) keep their identity tint. */
function tickColor(it: MinimapItem): string {
  return it.variant === 'user' || it.variant === 'claude' ? 'var(--cl-ink-4)' : it.color;
}

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
  const railRef = useRef<HTMLElement | null>(null);
  const [railH, setRailH] = useState(0);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setRailH(entries[0].contentRect.height));
    ro.observe(el);
    setRailH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  if (items.length === 0) return null;

  // Capsule chrome (label + count + paddings/gaps) ≈ 96px; the track takes the
  // rest. Preferred spacing is 12px per turn (the design's airy few-turn look),
  // compressed down to whatever fits when the session is long.
  const availableTrack = Math.max(60, railH - 96);
  const trackH = Math.min(availableTrack, Math.max(48, (items.length - 1) * 12));

  return (
    <nav className="cl-focus-rail" aria-label="Turn index" ref={railRef}>
      <div className="cl-turns-capsule">
        <span className="cl-turns-cap-label" aria-hidden>
          TURNS
        </span>
        <div className="cl-focus-rail-track" style={{ height: trackH }}>
          {items.map((it, i) => {
            const top = items.length <= 1 ? 50 : (i / (items.length - 1)) * 100;
            const isActive = active === it.n;
            const style = {
              top: `${top}%`,
              '--c': isActive ? undefined : tickColor(it),
              '--w': isActive ? undefined : `${tickWidth(it.variant)}px`,
            } as CSSProperties;
            return (
              <button
                key={it.n}
                type="button"
                className={isActive ? 'cl-focus-current' : 'cl-focus-tick'}
                style={style}
                data-accent={
                  (!isActive && it.variant !== 'user' && it.variant !== 'claude') || undefined
                }
                data-dim={!matches(it) || undefined}
                onClick={() => onJump(it.n)}
                title={`${String(it.n).padStart(2, '0')} · ${it.label} · ${it.time}`}
                aria-label={`Jump to turn ${it.n}, ${it.label}`}
                aria-current={isActive ? 'true' : undefined}
              >
                {isActive && it.n}
                <span className="lbl">
                  {String(it.n).padStart(2, '0')} {it.label}
                </span>
              </button>
            );
          })}
        </div>
        <span className="cl-turns-total" aria-label={`${items.length} turns`}>
          {items.length}
        </span>
      </div>
    </nav>
  );
}
