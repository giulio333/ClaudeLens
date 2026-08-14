// Turning a thrown value into an Aptabase error report — the pure half.
//
// Error messages and stack traces are the ONE part of ClaudeLens telemetry that
// is not anonymous by construction: `ENOENT: open '/Users/anna/Projects/acme'`
// carries a username and a project name, i.e. exactly what PRIVACY.md promises
// never leaves the machine. So nothing reaches the network before passing
// through `redactPaths`: every absolute path is either rewritten relative to the
// app bundle (`<app>/dist-electron/main.js:42:9` — our own code, the only part
// worth reporting) or replaced wholesale with `<path>`.
//
// Kept free of `electron`/`fs` imports so it can be unit-tested directly
// (`test/error-redact.test.ts`), same rationale as `version-compare.ts`.

export type RedactContext = {
  /** User home directory; its last segment is scrubbed as a username. */
  home?: string;
  /** App bundle root — paths under it keep their (non-sensitive) suffix. */
  appRoot?: string;
};

// Aptabase's documented field limits (docs/error-api-openapi.yaml).
export const ERROR_LIMITS = { type: 100, message: 5000, stack: 10_000 } as const;

// An absolute POSIX or Windows path, stopping at whitespace, quotes, brackets
// and `:` — so the `:12:9` of a stack frame survives the scrub. The lookbehind
// keeps `and/or` and the tail of an already-rewritten path from matching.
const ABS_PATH = /(?<![\w~])(?:[A-Za-z]:\\[^\s'"`()[\],:]*|\/[^\s'"`()[\],:]+)/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace every filesystem path in `text`. Paths inside the app bundle keep
 * their relative suffix (`<app>/…`), everything else — home, projects,
 * `~/.claude` — collapses to `<path>`. The username is scrubbed last, to catch
 * the mentions that are not part of a path (`user anna not found`).
 */
export function redactPaths(text: string, ctx: RedactContext = {}): string {
  const { home, appRoot } = ctx;
  let out = text.replace(ABS_PATH, m => {
    if (appRoot && m.startsWith(appRoot)) return `<app>${m.slice(appRoot.length)}`;
    return '<path>';
  });
  const user = home ? home.split(/[\\/]/).filter(Boolean).pop() : '';
  if (user && user.length > 2) {
    out = out.replace(new RegExp(`\\b${escapeRe(user)}\\b`, 'gi'), '<user>');
  }
  return out;
}

export type DescribedError = {
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
};

function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Normalize an arbitrary thrown value (anything can be thrown) into the three
 * Aptabase fields, capped at the documented limits. Paths are NOT scrubbed here
 * — the caller pipes the result through `redactPaths` with its own context.
 */
export function describeError(value: unknown): DescribedError {
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    const type = typeof code === 'string' && code ? `${value.name}:${code}` : value.name || 'Error';
    return {
      errorType: clamp(type, ERROR_LIMITS.type),
      errorMessage: clamp(value.message || String(value), ERROR_LIMITS.message),
      stackTrace: value.stack ? clamp(value.stack, ERROR_LIMITS.stack) : undefined,
    };
  }
  if (value && typeof value === 'object') {
    const o = value as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof o.message === 'string') {
      return {
        errorType: clamp(
          typeof o.name === 'string' && o.name ? o.name : 'Error',
          ERROR_LIMITS.type
        ),
        errorMessage: clamp(o.message, ERROR_LIMITS.message),
        stackTrace: typeof o.stack === 'string' ? clamp(o.stack, ERROR_LIMITS.stack) : undefined,
      };
    }
  }
  return {
    errorType: 'NonError',
    errorMessage: clamp(String(value), ERROR_LIMITS.message),
  };
}
