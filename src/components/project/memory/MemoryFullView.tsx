import { MemoryTopic } from '../../../hooks/useIPC'
import { BackButton } from '../shared/BackButton'
import { MemorySection } from './MemorySection'

export function MemoryFullView({
  project,
  onBack,
  onOpenTopic,
}: {
  project: { hash: string; realPath: string }
  onBack: () => void
  onOpenTopic: (topic: MemoryTopic, content: string) => void
}) {
  const projectName = project.realPath.split('/').pop() ?? project.realPath
  return (
    <div className="h-full bg-[var(--cl-paper-3)] flex flex-col">
      <div className="shrink-0 bg-[var(--cl-paper)] border-b border-[var(--cl-line-soft)] px-6 py-3 flex items-center gap-2">
        <BackButton label="Overview" onClick={onBack} />
        <span className="text-[var(--cl-line)] mx-0.5">/</span>
        <span className="text-[12px] text-[var(--cl-ink-4)] truncate">{projectName}</span>
        <span className="text-[var(--cl-line)] mx-0.5">/</span>
        <span className="text-[12px] font-semibold text-[var(--cl-ink-3)]">Memory</span>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <MemorySection hash={project.hash} onOpenTopic={onOpenTopic} />
      </div>
    </div>
  )
}
