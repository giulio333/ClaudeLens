// Renderer-side helper for anonymous feature-usage telemetry. Forwards events to
// the main process (electron/modules/telemetry.ts), which gates them behind the
// opt-out preference and sanitizes props before sending to Aptabase.
//
// PRIVACY RULE: only pass fixed enum-like strings and numbers — never session
// titles, prompts, file paths, project names, or anything derived from user
// content. The main process also sanitizes, but keep call sites clean too.

export function trackEvent(name: string, props?: Record<string, string | number>): void {
  // Fire-and-forget; telemetry must never block or break the UI.
  window.electronAPI?.telemetry?.track(name, props).catch(() => {})
}

// `view_opened` fires on EVERY navigation to a view (no per-run dedup) while the
// user base is small, so we can see real navigation patterns — which sections
// people open and how often, not just which they touched once. Re-introduce
// once-per-run dedup later if volume grows.
export function reportViewOpened(view: string): void {
  trackEvent('view_opened', { view })
}
