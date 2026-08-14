// Renderer-side helper for anonymous feature-usage telemetry. Forwards events to
// the main process (electron/modules/telemetry.ts), which gates them behind the
// opt-out preference and sanitizes props before sending to Aptabase.
//
// PRIVACY RULE: only pass fixed enum-like strings and numbers — never session
// titles, prompts, file paths, project names, or anything derived from user
// content. The main process also sanitizes, but keep call sites clean too.

export function trackEvent(name: string, props?: Record<string, string | number>): void {
  // Fire-and-forget; telemetry must never block or break the UI.
  window.electronAPI?.telemetry?.track(name, props).catch(() => {});
}

/**
 * Report a renderer error. Only the three fields Aptabase stores are forwarded;
 * the main process scrubs paths, usernames and project names out of them before
 * anything is sent (`electron/shared/error-redact.ts`), and the same opt-out
 * toggle gates it. Fire-and-forget.
 */
export function reportError(value: unknown, kind: 'unhandled' | 'handled' = 'handled'): void {
  const e = value instanceof Error ? value : null;
  const message = e ? e.message : String(value);
  if (!message) return;
  window.electronAPI?.telemetry
    ?.trackError({ name: e?.name ?? 'Error', message, stack: e?.stack }, kind, 'error')
    .catch(() => {});
}

/**
 * Catch what React's error boundary can't see: errors thrown outside render
 * (event handlers, timers, IPC callbacks) and rejected promises nobody awaited.
 * Passive — the default browser logging still happens.
 */
export function installErrorReporting(): void {
  window.addEventListener('error', event => reportError(event.error ?? event.message, 'unhandled'));
  window.addEventListener('unhandledrejection', event => reportError(event.reason, 'unhandled'));
}

// `view_opened` fires on EVERY navigation to a view (no per-run dedup) while the
// user base is small, so we can see real navigation patterns — which sections
// people open and how often, not just which they touched once. Re-introduce
// once-per-run dedup later if volume grows.
export function reportViewOpened(view: string): void {
  trackEvent('view_opened', { view });
}
