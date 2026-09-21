import type { HTMLAttributes, ReactNode } from 'react';
import type { AgentColor } from '../../../types';
import { SessionColorDot } from './SessionColorDot';

export function SessionColorFrame({
  color,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { color?: AgentColor; children: ReactNode }) {
  const auraClass = color ? `cl-session-aura ${color}` : '';
  return (
    <div className={[className, auraClass].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  );
}

export function SessionColorIdentity({ color, title }: { color?: AgentColor; title: string }) {
  if (!color) return title;
  return (
    <span className="flex items-center min-w-0" style={{ gap: 7 }}>
      <SessionColorDot color={color} />
      <span className={`cl-session-identity ${color} truncate min-w-0`}>{title}</span>
    </span>
  );
}

export function SessionBottomGlow({
  color,
  active = false,
}: {
  color?: AgentColor;
  active?: boolean;
}) {
  if (!color) return null;
  return (
    <span className={`cl-session-bottom-glow${active ? ' is-active' : ''}`} aria-hidden="true" />
  );
}
