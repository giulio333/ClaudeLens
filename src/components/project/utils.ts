export function fmt(n: number) { return n.toLocaleString('en-US') }
export function fmtCost(n: number) { return '$' + n.toFixed(4) }
export function fmtDate(d: string) {
  return new Date(d).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })
}

// Converte l'ID modello in nome leggibile: "claude-sonnet-4-6" → "Sonnet 4.6"
export function fmtModel(m: string): string {
  const s = m.replace(/^claude-/, '')
  const ver = s.match(/(\d+[.-]\d+)/)?.[1]?.replace('-', '.') ?? ''
  if (s.includes('haiku'))  return `Haiku ${ver}`.trim()
  if (s.includes('sonnet')) return `Sonnet ${ver}`.trim()
  if (s.includes('opus'))   return `Opus ${ver}`.trim()
  return s
}

// Colore accent per famiglia modello
export function modelColor(m: string): string {
  if (m.includes('haiku'))  return '#0d9488'  // teal-600
  if (m.includes('opus'))   return '#7c3aed'  // violet-600
  return '#4f46e5'                             // indigo-600 (sonnet + default)
}
