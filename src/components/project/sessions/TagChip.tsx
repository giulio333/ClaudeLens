import { type CSSProperties, type MouseEvent } from 'react';

export type TagChipTone = 'muted' | 'on' | 'soft';
export type TagChipVariant = 'pill' | 'plain';

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
