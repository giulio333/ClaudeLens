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
      <main className="flex-1 overflow-hidden">
        <ErrorBoundary>
          <ProjectOverview />
        </ErrorBoundary>
      </main>
    </div>
  )
}
