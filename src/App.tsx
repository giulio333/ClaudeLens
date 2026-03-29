import { useDataChangedRefetch } from './hooks/useIPC'
import ProjectOverview from './tabs/ProjectOverview'
import { ErrorBoundary } from './components/ErrorBoundary'

export default function App() {
  useDataChangedRefetch()

  return (
    <div className="flex flex-col h-screen bg-[#0d0f14] text-[#e0e2f0]">
      <main className="flex-1 overflow-hidden">
        <ErrorBoundary>
          <ProjectOverview />
        </ErrorBoundary>
      </main>
    </div>
  )
}
