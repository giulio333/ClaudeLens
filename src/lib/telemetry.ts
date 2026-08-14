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
 * Browser-generated `window.onerror` messages that are noise, not defects.
 *
 * `ResizeObserver loop completed with undelivered notifications` (and its older
 * Chromium/Firefox wording) is not an exception: the browser fires it when a
 * resize callback dirties layout again, so the remaining notifications need one
 * more frame to settle. That is the normal case in this app, not a bug — the
 * windowed transcript re-measures every row through a ResizeObserver (which
 * changes the sizer height) and the terminal pane refits xterm from another —
 * and it is likelier on Windows, where scrollbars take space instead of
 * overlaying. It also arrives with no `error` object, hence no stack, so the
 * report is unactionable by construction: it names no frame to look at. Letting
 * it through would spend the monthly error quota (capped, and latched off for
 * the run on a 403) on the one message we already know we would not act on,
 * displacing the real crashes the endpoint exists for.
 */
const BENIGN_MESSAGES = [
  'ResizeObserver loop completed with undelivered notifications',
  'ResizeObserver loop limit exceeded',
];

/** Whether a message is browser noise that must never reach the error endpoint. */
export function isBenignBrowserNoise(message: string): boolean {
  return BENIGN_MESSAGES.some(noise => message.includes(noise));
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
  if (!message || isBenignBrowserNoise(message)) return;
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
