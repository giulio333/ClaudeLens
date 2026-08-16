import { Fragment, ReactNode } from 'react';

/** A crumb with `onClick` is a step you can walk back to: it renders as a button
 *  and the bar becomes the one place a nested view is dismissed from, instead of
 *  each panel growing a "Back" of its own under the bar's own one. */
export type Crumb = { label: ReactNode; accent?: boolean; onClick?: () => void; title?: string };

/**
 * Editorial top bar shared by every full-screen "deep" view.
 *
 * Fixed 52px height with an 88px left gutter that clears the macOS
 * traffic-light buttons, and a `-webkit-app-region: drag` surface so the
 * window can be moved by the bar. Interactive elements opt back out with
 * `no-drag`. Keeping this in one place guarantees every page lines up.
 */
export function TopBar({
  onBack,
  backLabel = 'Back',
  crumbs = [],
  right,
}: {
  onBack: () => void;
  backLabel?: string;
  crumbs?: Crumb[];
  right?: ReactNode;
}) {
  const crumbStyle = (accent?: boolean): React.CSSProperties => ({
    fontSize: 12,
    letterSpacing: '0.01em',
    color: accent ? 'var(--cl-ink)' : 'var(--cl-ink-3)',
    lineHeight: 1,
  });

  return (
    <div
      className="cl-topbar shrink-0 flex items-center gap-3"
      style={
        {
          WebkitAppRegion: 'drag',
          height: 52,
          padding: '0 28px 0 88px',
        } as React.CSSProperties
      }
    >
      <button
        onClick={onBack}
        className="flex items-center gap-2 font-mono transition-colors hover:text-[var(--cl-accent)] shrink-0"
        style={{ WebkitAppRegion: 'no-drag', ...crumbStyle() } as React.CSSProperties}
      >
        <span>←</span>
        {backLabel}
      </button>

      {crumbs.map((c, i) => (
        <Fragment key={i}>
          <span
            className="shrink-0"
            style={{ color: 'var(--cl-ink-4)', fontSize: 12, lineHeight: 1, opacity: 0.5 }}
          >
            /
          </span>
          {c.onClick ? (
            <button
              type="button"
              onClick={c.onClick}
              title={c.title}
              className="font-mono truncate min-w-0 transition-colors hover:text-[var(--cl-accent)]"
              style={{ WebkitAppRegion: 'no-drag', ...crumbStyle(c.accent) } as React.CSSProperties}
            >
              {c.label}
            </button>
          ) : (
            <span className="font-mono truncate min-w-0" style={crumbStyle(c.accent)}>
              {c.label}
            </span>
          )}
        </Fragment>
      ))}

      {right && (
        <div
          className="flex items-center gap-2.5 shrink-0"
          style={{ marginLeft: 'auto', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {right}
        </div>
      )}
    </div>
  );
}
