// Pure formatters shared by the workflows list and detail views.

/** '7m 14s' / '26s' / '' for a run's wall-clock. */
export function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem ? `${m}m ${rem}s` : `${m}m`
}

export type Tone = 'ok' | 'error' | 'muted'

/** Map a run status (+ degraded flag) to one of three tones — reusing existing
 *  brand tokens only (accent / danger / neutral), no new hues. */
export function statusTone(status: string, degraded: boolean): Tone {
  if (degraded) return 'muted'
  if (status === 'completed') return 'ok'
  if (status === 'error' || status === 'failed' || status === 'aborted') return 'error'
  return 'muted'
}
