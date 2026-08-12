export function fmt(n: number) {
  return n.toLocaleString('en-US');
}
// Dollar amount with at most 2 decimals and thousands separators ($1,234.56).
// Sub-cent amounts collapse to "<$0.01": rounding them to "$0.00" would read as
// "free", and a third decimal is exactly what made these figures look like
// thousands instead of a fraction of a dollar.
export function fmtCost(n: number) {
  if (!Number.isFinite(n)) return '$0.00';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.005) return `${sign}<$0.01`;
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
export function fmtDate(d: string) {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
}

// Compact token count for metric chips: 1_500 → {value:'2',unit:'k'},
// 2_300_000 → {value:'2.3',unit:'m'}. The caller renders value and unit separately.
export function formatTokens(n: number): { value: string; unit: string } {
  if (n >= 1_000_000_000) return { value: (n / 1_000_000_000).toFixed(1), unit: 'b' };
  if (n >= 1_000_000) return { value: (n / 1_000_000).toFixed(1), unit: 'm' };
  if (n >= 1_000) return { value: Math.round(n / 1_000).toString(), unit: 'k' };
  return { value: String(n), unit: '' };
}

// Restituisce un titolo umano per la sessione, in ordine di priorità:
// 1) customTitle (impostato dall'utente)  2) aiTitle (generato da Claude)
// 3) primo messaggio utente troncato       4) fallback "Untitled session"
export function sessionTitle(
  s: {
    customTitle?: string;
    aiTitle?: string;
    firstUserMessage?: string;
  },
  maxLen = 80
): string {
  const raw = s.customTitle?.trim() || s.aiTitle?.trim() || s.firstUserMessage?.trim();
  if (!raw) return 'Untitled session';
  const firstLine = raw.split('\n')[0].trim() || raw.trim();
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 1).trimEnd() + '…';
}

// Converte l'ID modello in nome leggibile: "claude-sonnet-4-6" → "Sonnet 4.6"
//
// The version comes from the numeric segments of the id, NOT from a
// `\d+[.-]\d+` match: that pattern needs two digit groups, so every
// single-digit release lost its number — `claude-opus-5` printed as a bare
// "Opus". An 8-digit release stamp is dropped so `claude-haiku-4-5-20251001`
// stays "Haiku 4.5" rather than "Haiku 4.5.20251001".
export function fmtModel(m: string): string {
  const s = m.replace(/^claude-/, '');
  const ver = s
    .split('-')
    .filter(part => /^\d+$/.test(part) && part.length !== 8)
    .join('.');
  if (s.includes('haiku')) return `Haiku ${ver}`.trim();
  if (s.includes('sonnet')) return `Sonnet ${ver}`.trim();
  if (s.includes('opus')) return `Opus ${ver}`.trim();
  if (s.includes('fable')) return `Fable ${ver}`.trim();
  if (s.includes('mythos')) return `Mythos ${ver}`.trim();
  return s;
}

// ── Model distribution (project hero band, design 5b) ───────────────────────
// Share of a window's tokens per model family, for the tri-colour bar under the
// project name. Tokens rather than session count: the cell sits next to the
// token figure, and what the bar encodes is where the work went. Families with
// no tokens are dropped so the bar never carries a zero-width segment; a window
// with no usage at all returns [] and the caller shows an empty state.
export type ModelMixSlice = {
  key: ModelMixKey;
  label: string;
  tokens: number;
  sessions: number;
  pct: number;
};

export type ModelMixKey = 'opus' | 'sonnet' | 'haiku' | 'other';

const MODEL_MIX_ORDER: { key: ModelMixKey; label: string }[] = [
  { key: 'opus', label: 'Opus' },
  { key: 'sonnet', label: 'Sonnet' },
  { key: 'haiku', label: 'Haiku' },
  { key: 'other', label: 'Other' },
];

export function modelMixKey(model?: string): ModelMixKey {
  if (!model) return 'other';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  if (model.includes('sonnet')) return 'sonnet';
  return 'other';
}

export function buildModelMix(
  sessions: { model?: string; totalTokens: number }[]
): ModelMixSlice[] {
  const acc = new Map<ModelMixKey, { tokens: number; sessions: number }>();
  for (const s of sessions) {
    const key = modelMixKey(s.model);
    const cur = acc.get(key) ?? { tokens: 0, sessions: 0 };
    cur.tokens += s.totalTokens;
    cur.sessions += 1;
    acc.set(key, cur);
  }
  const total = [...acc.values()].reduce((n, v) => n + v.tokens, 0);
  if (total <= 0) return [];
  return MODEL_MIX_ORDER.map(({ key, label }) => {
    const v = acc.get(key) ?? { tokens: 0, sessions: 0 };
    return { key, label, tokens: v.tokens, sessions: v.sessions, pct: (v.tokens / total) * 100 };
  }).filter(slice => slice.tokens > 0);
}

// Colore accent per famiglia modello.
// Data-encoding colours (which model produced this slice), not brand accents —
// same category as the teammate palette in teams/utils.ts.
export function modelColor(m: string): string {
  if (m.includes('haiku')) return '#0d9488'; // teal-600
  if (m.includes('opus')) return '#7c3aed'; // violet-600
  if (m.includes('fable') || m.includes('mythos')) return '#be185d'; // rose-700
  return '#4f46e5'; // indigo-600 (sonnet + default)
}
