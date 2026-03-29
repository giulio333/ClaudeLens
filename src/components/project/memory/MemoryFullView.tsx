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
    <div className="h-full bg-[#0d0f14] flex flex-col">
      <div className="shrink-0 bg-[#0f1117] border-b border-[#1e2130] px-6 py-3 flex items-center gap-2">
        <BackButton label="Overview" onClick={onBack} />
        <span className="text-[#252836] mx-0.5">/</span>
        <span className="text-[12px] text-[#555c75] truncate">{projectName}</span>
        <span className="text-[#252836] mx-0.5">/</span>
        <span className="text-[12px] font-semibold text-[#9096b0]">Memory</span>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <MemorySection hash={project.hash} onOpenTopic={onOpenTopic} />
      </div>
    </div>
  )
}
