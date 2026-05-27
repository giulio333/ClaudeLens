import { TagChip } from './TagChip'
import type { SessionTag } from '../../../hooks/useSessionTags'

export function TagBar({
  tags,
  counts,
  activeTag,
  totalCount,
  onSelect,
}: {
  tags: SessionTag[]
  counts: Record<string, number>
  activeTag: string | null
  totalCount: number
  onSelect: (tag: string | null) => void
}) {
  if (tags.length === 0) return null
  return (
    <div className="cl-tagbar">
      <button
        type="button"
        className={`cl-tagbar-all${activeTag === null ? ' on' : ''}`}
        onClick={() => onSelect(null)}
      >
        All <span className="ct">{totalCount}</span>
      </button>
      <span className="cl-tagbar-sep" />
      <div className="cl-tagbar-list">
        {tags.map(t => (
          <TagChip
            key={t.name}
            name={t.name}
            count={counts[t.name] ?? 0}
            tone={activeTag === t.name ? 'on' : 'muted'}
            onClick={() => onSelect(activeTag === t.name ? null : t.name)}
          />
        ))}
      </div>
    </div>
  )
}
