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
  showAll = true,
}: {
  tags: SessionTag[];
  counts: Record<string, number>;
  activeTag: string | null;
  totalCount: number;
  onSelect: (tag: string | null) => void;
  onRename?: (oldName: string, newName: string) => boolean;
  onDelete?: (name: string) => void;
  /** `false` when the caller draws its own "all" — a bar that filters on more
   *  than tags (the memory list also filters by type) has one "all" for both. */
  showAll?: boolean;
}) {
  if (tags.length === 0) return null;
  const manageable = !!(onRename || onDelete);
  return (
    <div className="cl-tagbar">
      {/* "all" and every tag are one radio group, so they are one species with
          no divider between them — the active wash says which one is on. */}
      {showAll && (
        <button
          type="button"
          className={`cl-tagbar-all${activeTag === null ? ' on' : ''}`}
          onClick={() => onSelect(null)}
        >
          all <span className="ct">{totalCount}</span>
        </button>
      )}
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
              variant="filter"
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
              variant="filter"
              onClick={() => onSelect(activeTag === t.name ? null : t.name)}
            />
          )
        )}
      </div>
    </div>
  );
}
