import { useState } from 'react'
import { MemoryTopic, TopicInput } from '../../../hooks/useIPC'
import { useUpdateTopic, useDeleteTopic } from '../../../hooks/useIPC'
import { MarkdownDocView } from '../shared/MarkdownDocView'
import { parseMemoryContent, readingTime, formatDate } from './utils'

const TYPE_LABEL: Record<string, string> = {
  user: 'User',
  feedback: 'Feedback',
  project: 'Project',
  reference: 'Reference',
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 3.5h9M5.5 3.5V2.3h3v1.2M3.4 3.5l.5 8h6.2l.5-8M6 6v3.4M8 6v3.4" />
    </svg>
  )
}

/**
 * Controllo delete a due fasi: bottone ghost con icona → si espande in-place
 * in una pill di pericolo con messaggio e azioni Keep / Delete distinte.
 */
function DeleteControl({
  open,
  busy,
  onArm,
  onCancel,
  onConfirm,
}: {
  open: boolean
  busy: boolean
  onArm: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onArm}
        className="cl-del-trigger"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 32,
          padding: '0 12px',
          borderRadius: 4,
          border: '1px solid transparent',
          background: 'transparent',
          color: 'var(--cl-ink-4)',
          fontSize: 12.5,
          cursor: 'pointer',
          transition: 'color 120ms ease, background 120ms ease, border-color 120ms ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.color = 'var(--cl-danger)'
          e.currentTarget.style.background = 'var(--cl-danger-soft)'
          e.currentTarget.style.borderColor = 'var(--cl-danger)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.color = 'var(--cl-ink-4)'
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.borderColor = 'transparent'
        }}
      >
        <TrashIcon />
        Delete
      </button>
    )
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        height: 32,
        padding: '0 6px 0 12px',
        borderRadius: 4,
        border: '1px solid var(--cl-danger)',
        background: 'var(--cl-danger-soft)',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--cl-danger)' }}>
        <TrashIcon />
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>Delete permanently?</span>
      </span>
      <span style={{ display: 'inline-flex', gap: 4 }}>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            height: 24,
            padding: '0 10px',
            borderRadius: 3,
            border: 'none',
            background: 'transparent',
            color: 'var(--cl-ink-3)',
            fontSize: 11.5,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          Keep
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          style={{
            height: 24,
            padding: '0 12px',
            borderRadius: 3,
            border: 'none',
            background: 'var(--cl-danger)',
            color: 'var(--cl-on-accent)',
            fontSize: 11.5,
            fontWeight: 600,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </span>
    </span>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2.5">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--cl-ink-3)' }}>
        {label}
      </div>
      <div className="mt-1 text-[13px]" style={{ color: 'var(--cl-ink-2)' }}>{value}</div>
    </div>
  )
}

/** Estrae name/description/type/body dal markdown grezzo con frontmatter YAML. */
function parseTopicInput(raw: string, fallback: MemoryTopic): TopicInput {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  let name = fallback.name
  let description = fallback.description
  let type: TopicInput['type'] = fallback.type
  let body = raw

  if (m) {
    const fm = m[1]
    const get = (k: string) =>
      fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '')
    name = get('name') ?? name
    description = get('description') ?? description
    const t = get('type')
    if (t === 'user' || t === 'feedback' || t === 'project' || t === 'reference') type = t
    body = raw.slice(m[0].length)
  }

  return { name, description, type, content: body }
}

export function MemoryTopicView({
  topic,
  content,
  hash,
  onBack,
}: {
  topic: MemoryTopic
  content: string
  hash: string
  onBack: () => void
}) {
  const { wordCount, charCount, linkCount } = parseMemoryContent(content)
  const updateMut = useUpdateTopic(hash)
  const deleteMut = useDeleteTopic(hash)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const createdAt = topic.createdAt ?? null
  const updatedAt = topic.updatedAt ?? null
  const sameDate = createdAt && updatedAt ? createdAt.slice(0, 10) === updatedAt.slice(0, 10) : true

  const readOnly = topic.isProjectLevel

  const handleDelete = () => {
    deleteMut.mutate(topic.filename, { onSuccess: onBack })
  }

  const sidebar = (
    <div className="flex flex-col" style={{ minHeight: '100%' }}>
      <div className="pb-3" style={{ borderBottom: '1px solid var(--cl-line)' }}>
        <span className="text-[10px] font-mono font-bold tracking-[0.18em] uppercase" style={{ color: 'var(--cl-ink-3)' }}>
          Topic
        </span>
      </div>

      <div className="flex-1">
        <StatRow label="Type" value={TYPE_LABEL[topic.type] ?? topic.type} />
        {createdAt && <StatRow label="Created" value={formatDate(createdAt)} />}
        {updatedAt && !sameDate && <StatRow label="Updated" value={formatDate(updatedAt)} />}
        <div style={{ borderTop: '1px solid var(--cl-line)' }} />
        <StatRow label="Reading" value={readingTime(wordCount)} />
        <StatRow label="Words" value={String(wordCount)} />
        <StatRow label="Characters" value={String(charCount)} />
        <StatRow label="Links" value={String(linkCount)} />
      </div>

      <div className="pt-3" style={{ borderTop: '1px solid var(--cl-line)' }}>
        <p className="text-[10px] font-mono leading-snug break-all" style={{ color: 'var(--cl-ink-3)' }}>
          {topic.filename}
        </p>
        {readOnly && (
          <p className="mt-2 text-[10px] leading-snug" style={{ color: 'var(--cl-ink-3)' }}>
            Committed to repo · read-only
          </p>
        )}
      </div>
    </div>
  )

  const extraActions = !readOnly && (
    <DeleteControl
      open={confirmDelete}
      busy={deleteMut.isPending}
      onArm={() => setConfirmDelete(true)}
      onCancel={() => setConfirmDelete(false)}
      onConfirm={handleDelete}
    />
  )

  return (
    <MarkdownDocView
      onBack={onBack}
      backLabel="Memory"
      crumb={`${topic.type} · ${topic.name}`}
      eyebrow={<>{topic.type} · memory/{topic.filename}</>}
      titleLabel={topic.name}
      titleGlyph=".md"
      lead={topic.description || undefined}
      content={content}
      sidebar={sidebar}
      extraActions={extraActions}
      onSave={readOnly ? undefined : async next => {
        await updateMut.mutateAsync({ filename: topic.filename, input: parseTopicInput(next, topic) })
      }}
    />
  )
}
