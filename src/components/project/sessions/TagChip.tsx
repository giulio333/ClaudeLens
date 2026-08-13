import { type CSSProperties, type MouseEvent } from 'react';

export type TagChipTone = 'muted' | 'on' | 'soft';
/** `pill` = a bounded chip among other controls (picker rows, detail headers);
 *  `plain` = an inline hashtag in a row's meta; `filter` = one option of a
 *  filter rail, which in this app means no border and no fill — the active one
 *  takes an accent wash (same language as the chat pill's filters). */
export type TagChipVariant = 'pill' | 'plain' | 'filter';

export function TagChip({
  name,
  count,
  tone = 'muted',
  variant = 'pill',
  removable,
  onClick,
  onRemove,
  title,
  style,
}: {
  name: string;
  count?: number;
  tone?: TagChipTone;
  variant?: TagChipVariant;
  removable?: boolean;
  onClick?: (e: MouseEvent) => void;
  onRemove?: (e: MouseEvent) => void;
  title?: string;
  style?: CSSProperties;
}) {
  const interactive = !!onClick;
  const Tag = interactive ? 'button' : 'span';
  return (
    <Tag
      type={interactive ? 'button' : undefined}
      className={`cl-tag cl-tag--${variant} tone-${tone}${interactive ? ' is-interactive' : ''}`}
      onClick={onClick}
      title={title ?? `tag · ${name}`}
      style={style}
    >
      <span className="hash" aria-hidden>
        #
      </span>
      <span className="name">{name}</span>
      {typeof count === 'number' && <span className="count">{count}</span>}
      {removable && (
        <span
          className="remove"
          role="button"
          aria-label={`Remove tag ${name}`}
          onClick={e => {
            e.stopPropagation();
            onRemove?.(e);
          }}
        >
          ×
        </span>
      )}
    </Tag>
  );
}
