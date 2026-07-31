interface QueryErrorProps {
  /** The thrown/returned error to surface (Error, string, or anything). */
  error?: unknown;
  /** Optional retry handler — renders a "Retry" button when provided. */
  onRetry?: () => void;
  /** Headline shown above the error message. */
  title?: string;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error) return String(error);
  return 'An unexpected error occurred.';
}

/**
 * Shared "failed to load" panel used both by `ErrorBoundary` (render crashes)
 * and by data-fetching views (React Query `isError`). Theme-aware via `--cl-*`.
 */
export function QueryError({ error, onRetry, title = 'Failed to load' }: QueryErrorProps) {
  return (
    <div className="flex items-center justify-center h-full w-full" style={{ minHeight: 220 }}>
      <div className="text-center" style={{ maxWidth: 420, padding: '0 24px' }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            margin: '0 auto 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--cl-danger-soft)',
            border: '1px solid color-mix(in srgb, var(--cl-danger) 26%, transparent)',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 6v5M10 14h.01"
              stroke="var(--cl-danger)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle cx="10" cy="10" r="8.5" stroke="var(--cl-danger)" strokeWidth="1.3" />
          </svg>
        </div>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--cl-ink)', marginBottom: 6 }}>
          {title}
        </p>
        <p
          style={{
            fontSize: 12,
            color: 'var(--cl-ink-3)',
            fontFamily: 'var(--font-mono, monospace)',
            wordBreak: 'break-word',
          }}
        >
          {messageOf(error)}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            style={{
              marginTop: 20,
              padding: '6px 16px',
              borderRadius: 8,
              border: '1px solid var(--cl-line)',
              background: 'transparent',
              color: 'var(--cl-ink-2)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
