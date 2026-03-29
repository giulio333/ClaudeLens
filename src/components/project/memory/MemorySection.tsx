import { useState } from 'react'
import { useMemoryProject, useCreateTopic, useUpdateTopic, useDeleteTopic, MemoryTopic, TopicInput } from '../../../hooks/useIPC'
import { MemoryIndexFile } from './MemoryIndexFile'
import { TopicForm, EMPTY_FORM } from './TopicForm'

export const MEMORY_TYPE_CONFIG: Record<string, {
  label: string
  iconColor: string
  iconBg: string
  accentBorder: string
  accentBg: string
  badgeBg: string
  badgeText: string
  iconPath: string
}> = {
  feedback: {
    label: 'Feedback',
    iconColor: '#fbbf24',
    iconBg: 'bg-amber-950/30 border border-amber-800/30',
    accentBorder: 'border-t-amber-500/50',
    accentBg: 'hover:bg-amber-950/5',
    badgeBg: 'bg-amber-950/20 border border-amber-700/30',
    badgeText: 'text-amber-400',
    iconPath: 'M2 2h8v6H7l-3 2V8H2V2z',
  },
  project: {
    label: 'Project',
    iconColor: '#34d399',
    iconBg: 'bg-emerald-950/30 border border-emerald-800/30',
    accentBorder: 'border-t-emerald-500/50',
    accentBg: 'hover:bg-emerald-950/5',
    badgeBg: 'bg-emerald-950/20 border border-emerald-700/30',
    badgeText: 'text-emerald-400',
    iconPath: 'M1 3.5h4l1 1.5h5v5H1V3.5z',
  },
  reference: {
    label: 'Reference',
    iconColor: '#a78bfa',
    iconBg: 'bg-violet-950/30 border border-violet-800/30',
    accentBorder: 'border-t-violet-500/50',
    accentBg: 'hover:bg-violet-950/5',
    badgeBg: 'bg-violet-950/20 border border-violet-700/30',
    badgeText: 'text-violet-400',
    iconPath: 'M4.5 7.5a3 3 0 104.24-4.24l-.7.7M7.5 4.5a3 3 0 10-4.24 4.24l.7-.7M4.5 7.5l3-3',
  },
  user: {
    label: 'User',
    iconColor: '#60a5fa',
    iconBg: 'bg-blue-950/30 border border-blue-800/30',
    accentBorder: 'border-t-blue-500/50',
    accentBg: 'hover:bg-blue-950/5',
    badgeBg: 'bg-blue-950/20 border border-blue-700/30',
    badgeText: 'text-blue-400',
    iconPath: 'M6 5.5a2 2 0 100-4 2 2 0 000 4zM2 10.5c0-2.2 1.8-4 4-4s4 1.8 4 4',
  },
}

const MEMORY_TYPE_ORDER = ['feedback', 'project', 'reference', 'user']

export function MemorySection({ hash, onOpenTopic }: {
  hash: string
  onOpenTopic: (topic: MemoryTopic, content: string) => void
}) {
  const { data, isLoading } = useMemoryProject(hash)
  const createMut = useCreateTopic(hash)
  const updateMut = useUpdateTopic(hash)
  const deleteMut = useDeleteTopic(hash)

  const [creating, setCreating] = useState(false)
  const [editingFilename, setEditingFilename] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  if (isLoading) return <p className="text-sm text-zinc-400">Loading...</p>
  if (!data) return null

  const handleCreate = (input: TopicInput) => {
    createMut.mutate(input, { onSuccess: () => setCreating(false) })
  }

  const handleUpdate = (filename: string, input: TopicInput) => {
    updateMut.mutate({ filename, input }, { onSuccess: () => setEditingFilename(null) })
  }

  const handleDelete = (filename: string) => {
    deleteMut.mutate(filename, { onSuccess: () => setConfirmDelete(null) })
  }

  const renderTopicRow = (t: MemoryTopic, topicContent: string | null, readOnly: boolean) => {
    const cfg = MEMORY_TYPE_CONFIG[t.type] ?? MEMORY_TYPE_CONFIG.user
    const isEditing = !readOnly && editingFilename === t.filename
    const isConfirming = !readOnly && confirmDelete === t.filename

    if (isEditing && topicContent !== null) {
      const frontmatterContent = topicContent.replace(/^---[\s\S]*?---\n\n?/, '')
      return (
        <TopicForm
          key={t.filename}
          initial={{ name: t.name, description: t.description, type: t.type, content: frontmatterContent }}
          onSave={input => handleUpdate(t.filename, input)}
          onCancel={() => setEditingFilename(null)}
          saving={updateMut.isLoading}
        />
      )
    }

    return (
      <div
        key={t.filename}
        className={`flex items-center gap-3 px-2 py-2 rounded-lg transition-all group ${topicContent ? 'cursor-pointer' : ''} ${isConfirming ? 'bg-red-950/10' : 'hover:bg-[#0f1117]'}`}
        onClick={() => topicContent && !isConfirming && onOpenTopic(t, topicContent)}
      >
        <div className="w-[3px] h-[26px] rounded-full shrink-0 opacity-35" style={{ background: cfg.iconColor }} />

        <p className="text-[12.5px] font-medium text-[#9096b0] group-hover:text-[#c4c8e0] transition-colors w-[38%] shrink-0 truncate">
          {t.name}
        </p>

        <p className="text-[11.5px] text-[#3d4460] flex-1 min-w-0 truncate">
          {t.description ?? ''}
        </p>

        {!isConfirming && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            {!readOnly && (
              <>
                <button
                  onClick={e => { e.stopPropagation(); setEditingFilename(t.filename) }}
                  className="w-6 h-6 flex items-center justify-center rounded text-[#3d4460] hover:text-indigo-400 hover:bg-indigo-950/25 transition-all"
                  title="Edit"
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z"/>
                  </svg>
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setConfirmDelete(t.filename) }}
                  className="w-6 h-6 flex items-center justify-center rounded text-[#3d4460] hover:text-red-400 hover:bg-red-950/25 transition-all"
                  title="Delete"
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 3H10M4 3V2H8V3M3 3l.5 7h5L9 3"/>
                  </svg>
                </button>
              </>
            )}
            {topicContent && (
              <svg className="w-3 h-3 text-[#3d4460] group-hover:text-[#555c75] transition-colors ml-0.5"
                viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <path d="M4.5 2.5L9 6l-4.5 3.5"/>
              </svg>
            )}
          </div>
        )}
        {isConfirming && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-red-400">Delete?</span>
            <button onClick={e => { e.stopPropagation(); handleDelete(t.filename) }} className="text-[10px] font-semibold text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded hover:bg-red-950/20 transition-colors">Yes</button>
            <button onClick={e => { e.stopPropagation(); setConfirmDelete(null) }} className="text-[10px] text-[#555c75] hover:text-[#9096b0] px-1.5 py-0.5 rounded hover:bg-[#161b26] transition-colors">No</button>
          </div>
        )}
      </div>
    )
  }

  const groupedTopics: Record<string, MemoryTopic[]> = {}
  for (const t of data.index) {
    const k = t.type ?? 'user'
    if (!groupedTopics[k]) groupedTopics[k] = []
    groupedTopics[k].push(t)
  }

  const hasProjectLevelMemories = data.projectLevelIndex && data.projectLevelIndex.length > 0

  return (
    <div className="space-y-7">
      {data.memoryMd
        ? <MemoryIndexFile memoryMd={data.memoryMd} />
        : (
          <div className="flex items-center gap-2 px-3 py-2 border border-dashed border-[#2a2f45] rounded-lg text-zinc-400">
            <span className="text-[11px] font-mono">MEMORY.md</span>
            <span className="text-[11px]">— file not found</span>
          </div>
        )
      }

      {hasProjectLevelMemories && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-teal-950/20 border border-teal-700/40 rounded-md">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" className="text-teal-400 shrink-0">
                <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                <line x1="0" y1="6" x2="3.5" y2="6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <line x1="8.5" y1="6" x2="12" y2="6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              <span className="text-[10px] font-semibold text-teal-400 uppercase tracking-wide">Committed to repo</span>
            </div>
            <span className="text-[11px] text-[#3d4460]">shared with team · read-only</span>
          </div>
          <div className="space-y-0.5">
            {data.projectLevelIndex.map((t: MemoryTopic) => {
              const topicContent = data.projectLevelTopics[t.name] ?? null
              return renderTopicRow(t, topicContent, true)
            })}
          </div>
        </div>
      )}

      {MEMORY_TYPE_ORDER.filter(type => groupedTopics[type]?.length).map(type => {
        const cfg = MEMORY_TYPE_CONFIG[type]
        const topics = groupedTopics[type]
        return (
          <div key={type}>
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-[22px] h-[22px] rounded-md flex items-center justify-center shrink-0 ${cfg.iconBg}`}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={cfg.iconColor} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d={cfg.iconPath}/>
                </svg>
              </div>
              <span className="text-[10px] font-bold text-[#3d4460] uppercase tracking-[0.12em]">{cfg.label}</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${cfg.badgeBg} ${cfg.badgeText}`}>{topics.length}</span>
            </div>
            <div className="space-y-0.5">
              {topics.map(t => {
                const topicContent = data.topics[t.name] ?? null
                return renderTopicRow(t, topicContent, false)
              })}
            </div>
          </div>
        )
      })}

      {creating ? (
        <TopicForm
          initial={EMPTY_FORM}
          onSave={handleCreate}
          onCancel={() => setCreating(false)}
          saving={createMut.isLoading}
        />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="w-full flex items-center justify-center gap-1.5 text-[12px] font-medium text-[#3d4460] hover:text-indigo-400 py-2.5 border border-dashed border-[#1e2130] rounded-xl hover:border-indigo-600/50 hover:bg-indigo-950/10 transition-all"
        >
          <span className="text-sm leading-none">+</span> New memory
        </button>
      )}
    </div>
  )
}
