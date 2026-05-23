import { useDataChangedRefetch } from './hooks/useIPC'
import ProjectOverview from './tabs/ProjectOverview'
import { ErrorBoundary } from './components/ErrorBoundary'

export default function App() {
  useDataChangedRefetch()

  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: 'var(--cl-paper)', color: 'var(--cl-ink)' }}
    >
      {/* Global SVG filter registry — referenced by liquid-glass surfaces via
          backdrop-filter: url(#cl-liquid-lens). The convex displacement map
          simulates light refraction through a glass droplet. */}
      <svg
        aria-hidden="true"
        style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
      >
        <defs>
          <filter id="cl-liquid-lens" x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
            {/* a soft turbulence acts as the "shape" of the droplet surface */}
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="2" seed="7" result="noise" />
            <feGaussianBlur in="noise" stdDeviation="4" result="softNoise" />
            {/* displace SourceGraphic (the backdrop) using softened noise as a
                vector field — R/G channels drive X/Y offset */}
            <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="22" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      <main className="flex-1 overflow-hidden">
        <ErrorBoundary>
          <ProjectOverview />
        </ErrorBoundary>
      </main>
    </div>
  )
}
