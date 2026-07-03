import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PulsingBorder } from '@paper-design/shaders-react';
import { useTheme } from '../../../hooks/useTheme';

// ─── LivePulseBorder ───────────────────────────────────────────────────────────
// Decorative WebGL "breathing border" overlay (Paper Shaders' PulsingBorder) for
// surfaces bound to a live Claude session: luminous color spots orbiting the
// element's perimeter. Purely presentational — absolutely positioned over the
// parent (which must be position:relative), pointer-events:none, aria-hidden.
//
// Colors accept any CSS color the app uses, including `var(--cl-*)` tokens and
// oklch(): the shader lib only parses hex/rgb/hsl, so values are resolved
// against the live theme via a 1×1 2D-canvas probe (and re-resolved when the
// theme flips). Honors prefers-reduced-motion by not rendering at all — the
// border is decoration, not information (surfaces keep their LED/tag cues).

// Each mounted instance holds a WebGL context (Chromium caps ~16 per page, LRU
// evicted). Live surfaces are inherently few (one per running terminal
// session), but don't attach this to unbounded lists.

/** Lazily-created 1×1 canvas used to normalize CSS colors to sRGB. */
let colorProbe: CanvasRenderingContext2D | null | undefined;
function getColorProbe(): CanvasRenderingContext2D | null {
  if (colorProbe === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    colorProbe = canvas.getContext('2d', { willReadFrequently: true });
  }
  return colorProbe;
}

/**
 * Resolve any CSS color — including `var(--token)` and oklch() — to an
 * `rgba()` string the shader parser understands. Returns null when the value
 * can't be resolved (missing token, no 2D context).
 */
function resolveCssColor(color: string): string | null {
  const ctx = getColorProbe();
  if (!ctx) return null;
  let value = color.trim();
  if (value.startsWith('var(')) {
    const token = value.slice(4, -1).trim();
    value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    if (!value) return null;
  }
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (a === 0) return null; // fully transparent = unparseable or pointless
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Swallow render errors: a decorative overlay must never take the row down. */
class SilentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function LivePulseBorder({
  colors = ['var(--cl-ok)', 'var(--cl-accent)'],
  speed = 0.6,
  thickness = 0.03,
  intensity = 0.12,
  roundness = 0.35,
  spots = 3,
  spotSize = 0.4,
  smoke = 0,
  zIndex,
}: {
  /** CSS colors; `var(--cl-*)` tokens and oklch() are resolved at runtime. */
  colors?: string[];
  speed?: number;
  /** Border base width, 0–1 relative to the canvas short side. */
  thickness?: number;
  /** Thickness of the individual orbiting color spots, 0–1. */
  intensity?: number;
  /** Corner roundness of the drawn border, 0–1 (not a CSS px radius). */
  roundness?: number;
  /** Orbiting spots per color, 1–20. */
  spots?: number;
  /** Angular size of each spot, 0–1. */
  spotSize?: number;
  /** Noisy glow extending past the border, 0–1. */
  smoke?: number;
  zIndex?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const { resolved: theme } = useTheme();

  // Re-resolve theme tokens when the resolved theme flips (the --cl-* values
  // change under the same token names).
  const key = colors.join('|');
  const shaderColors = useMemo(
    () => colors.map(resolveCssColor).filter((c): c is string => c !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands in for `colors` (fresh array each render)
    [key, theme]
  );

  if (reducedMotion || shaderColors.length === 0) return null;

  return (
    <SilentBoundary>
      <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex }}>
        <PulsingBorder
          style={{ width: '100%', height: '100%' }}
          colorBack="rgba(0, 0, 0, 0)"
          colors={shaderColors}
          scale={1}
          roundness={roundness}
          thickness={thickness}
          softness={0.9}
          intensity={intensity}
          bloom={0.4}
          spots={spots}
          spotSize={spotSize}
          pulse={0.3}
          smoke={smoke}
          smokeSize={smoke > 0 ? 0.4 : 0}
          speed={speed}
        />
      </div>
    </SilentBoundary>
  );
}
