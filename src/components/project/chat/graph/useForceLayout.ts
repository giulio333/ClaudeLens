// Timeline scales & formatters — file kept name-only; content fully rewritten
// for the swimlane layout. Pure functions, no React state.

export type TimeScale = (t: number) => number
export type InverseTimeScale = (px: number) => number

export function createTimeScale(
  domain: { start: number; end: number },
  range: { from: number; to: number },
): { scale: TimeScale; invert: InverseTimeScale } {
  const span = domain.end - domain.start || 1
  // Guard a zero-width pixel range (e.g. an unmeasured/collapsed container):
  // without it `invert` divides by zero and returns NaN. Mirrors `span || 1`.
  const px = range.to - range.from || 1
  const scale: TimeScale = (t) => range.from + ((t - domain.start) / span) * px
  const invert: InverseTimeScale = (p) => domain.start + ((p - range.from) / px) * span
  return { scale, invert }
}

// Choose ~6 readable ticks across the visible time range.
export function timeTicks(domain: { start: number; end: number }, count = 6): number[] {
  const span = domain.end - domain.start
  if (span <= 0) return [domain.start]
  const niceSteps = [
    1_000, 5_000, 10_000, 30_000,
    60_000, 5 * 60_000, 10 * 60_000, 30 * 60_000,
    60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000, 12 * 60 * 60_000,
    24 * 60 * 60_000,
  ]
  const target = span / count
  const step = niceSteps.find(s => s >= target) ?? niceSteps[niceSteps.length - 1]
  const first = Math.ceil(domain.start / step) * step
  const out: number[] = []
  for (let v = first; v <= domain.end; v += step) out.push(v)
  return out
}

// Format short labels for the time axis. Same-day → HH:MM[:SS]; multi-day → DD/MM HH:MM.
export function fmtAxisTime(t: number, domain: { start: number; end: number }): string {
  const span = domain.end - domain.start
  const d = new Date(t)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (span < 5 * 60_000) {
    const ss = String(d.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
  const startDay = new Date(domain.start).toDateString()
  const endDay = new Date(domain.end).toDateString()
  if (startDay !== endDay) {
    const dd = String(d.getDate()).padStart(2, '0')
    const MM = String(d.getMonth() + 1).padStart(2, '0')
    return `${dd}/${MM} ${hh}:${mm}`
  }
  return `${hh}:${mm}`
}

// Friendly duration label (e.g. "12m", "1h 04m", "3d 02h").
export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${(s % 60).toString().padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${(m % 60).toString().padStart(2, '0')}m`
  const d = Math.floor(h / 24)
  return `${d}d ${(h % 24).toString().padStart(2, '0')}h`
}

export function fmtClockTime(t: number): string {
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}
