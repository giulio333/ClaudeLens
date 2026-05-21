import {
  useGlobalClaudeMd,
  useWriteGlobalClaudeMd,
  useWriteClaudeMdFile,
} from '../../../hooks/useIPC'
import { MarkdownDocView } from '../shared/MarkdownDocView'

export function GlobalClaudeMdView({ onBack }: { onBack: () => void }) {
  const { data: content, isLoading } = useGlobalClaudeMd()
  const write = useWriteGlobalClaudeMd()

  return (
    <MarkdownDocView
      onBack={onBack}
      crumb="Global · CLAUDE.md"
      eyebrow="Global · ~/.claude/CLAUDE.md · applies to every project"
      titleLabel="CLAUDE"
      titleGlyph=".md"
      content={content ?? ''}
      isLoading={isLoading}
      emptyMessage="No global CLAUDE.md yet. Switch to Edit to create one."
      onSave={async next => { await write.mutateAsync(next) }}
    />
  )
}

export function ProjectClaudeMdView({
  layer,
  onBack,
}: {
  layer: { filePath: string; content: string; scope: string }
  onBack: () => void
}) {
  const write = useWriteClaudeMdFile()

  return (
    <MarkdownDocView
      onBack={onBack}
      crumb={`${layer.scope} · CLAUDE.md`}
      eyebrow={`${layer.scope} · ${layer.filePath}`}
      titleLabel="CLAUDE"
      titleGlyph=".md"
      content={layer.content}
      onSave={async next => { await write.mutateAsync({ filePath: layer.filePath, content: next }) }}
    />
  )
}
