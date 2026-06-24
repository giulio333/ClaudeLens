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

// `view_opened` fires once per distinct view per app run (not on every
// navigation), so it maps which sections people use without flooding the event
// budget. The Set lives for the lifetime of the renderer (resets on restart).
const reportedViews = new Set<string>()

export function reportViewOpened(view: string): void {
  if (reportedViews.has(view)) return
  reportedViews.add(view)
  trackEvent('view_opened', { view })
}
