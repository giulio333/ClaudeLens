import {
  useGlobalClaudeMd,
  useWriteGlobalClaudeMd,
  useWriteClaudeMdFile,
  useDeleteClaudeMdFile,
} from '../../../hooks/useIPC'
import { EntityDetailView, EntityConfig } from '../shared/EntityDetailView'

function claudeMdConfig(args: {
  scopeLabel: string
  path: string
  eyebrow: string
  content: string
}): EntityConfig {
  const body = args.content
  const lines = body ? body.split('\n').length : 0
  const words = body.trim() ? body.trim().split(/\s+/).length : 0
  return {
    kind: 'claudemd',
    name: 'CLAUDE',
    titleGlyph: '.md',
    scopeLabel: args.scopeLabel,
    path: args.path,
    eyebrow: args.eyebrow,
    kindLabel: 'memory',
    backLabel: 'CLAUDE.md',
    crumbs: [{ label: `${args.scopeLabel} · CLAUDE.md`, accent: true }],
    neutralTint: true,
    initial: 'C',
    tape: [
      { label: 'Scope', value: args.scopeLabel },
      { label: 'Format', value: 'Markdown' },
      { label: 'Lines', value: String(lines), mono: true },
      { label: 'Words', value: String(words), mono: true },
    ],
    bodyLabel: 'CLAUDE.md · markdown',
    optionDefs: [],
    initialOptions: {},
    body: args.content,
    hasDescriptionField: false,
    serialize: ({ body }) => body,
    editable: true,
    deletable: true,
    duplicable: false,
    runnable: false,
    emptyMessage: 'No CLAUDE.md yet. Switch to Edit to create one.',
  }
}

export function GlobalClaudeMdView({ onBack }: { onBack: () => void }) {
  const { data: content } = useGlobalClaudeMd()
  const write = useWriteGlobalClaudeMd()
  const del = useDeleteClaudeMdFile()

  const config = claudeMdConfig({
    scopeLabel: 'Global',
    path: '~/.claude/CLAUDE.md',
    eyebrow: 'Global · ~/.claude/CLAUDE.md · applies to every project',
    content: content ?? '',
  })

  return (
    <EntityDetailView
      config={config}
      onBack={onBack}
      onSave={async next => { await write.mutateAsync(next) }}
      onDelete={async () => { await del.mutateAsync(null) }}
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
  const del = useDeleteClaudeMdFile()

  const config = claudeMdConfig({
    scopeLabel: layer.scope,
    path: layer.filePath,
    eyebrow: `${layer.scope} · ${layer.filePath}`,
    content: layer.content,
  })

  return (
    <EntityDetailView
      config={config}
      onBack={onBack}
      onSave={async next => { await write.mutateAsync({ filePath: layer.filePath, content: next }) }}
      onDelete={async () => { await del.mutateAsync(layer.filePath) }}
    />
  )
}
