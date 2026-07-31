import { ManagedTagChip } from './ManagedTagChip';
import { TagChip } from './TagChip';
import type { SessionTag } from '../../../hooks/useSessionTags';

export function TagBar({
  tags,
  counts,
  activeTag,
  totalCount,
  onSelect,
  onRename,
  onDelete,
}: {
  tags: SessionTag[];
  counts: Record<string, number>;
  activeTag: string | null;
  totalCount: number;
  onSelect: (tag: string | null) => void;
  onRename?: (oldName: string, newName: string) => boolean;
  onDelete?: (name: string) => void;
}) {
  if (tags.length === 0) return null;
  const manageable = !!(onRename || onDelete);
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
        {tags.map(t =>
          manageable ? (
            // Clicking the chip opens the shared actions menu; filtering is its
            // first action. Same gesture/menu as the topic & session sidebars.
            <ManagedTagChip
              key={t.name}
              name={t.name}
              count={counts[t.name] ?? 0}
              active={activeTag === t.name}
              onFilter={() => onSelect(activeTag === t.name ? null : t.name)}
              onRename={onRename}
              onDelete={onDelete ? () => onDelete(t.name) : undefined}
            />
          ) : (
            <TagChip
              key={t.name}
              name={t.name}
              count={counts[t.name] ?? 0}
              tone={activeTag === t.name ? 'on' : 'muted'}
              onClick={() => onSelect(activeTag === t.name ? null : t.name)}
            />
          )
        )}
      </div>
    </div>
  );
}
