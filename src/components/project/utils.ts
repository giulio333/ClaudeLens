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
  /** Exact share, for the bar's segment width. */
  pct: number;
  /** Rounded share for the legend — whole numbers that sum to exactly 100,
   *  with a share too small to round up printed as "<1" rather than "0". */
  pctLabel: string;
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

// Whole-number shares that still add up to 100 (largest remainder): rounding
// each slice on its own makes the legend read 99% or 101%, which is exactly the
// kind of arithmetic a reader checks. A slice that exists but rounds to nothing
// prints "<1" — "0%" next to a visible segment reads as a bug.
function pctLabels(pcts: number[]): string[] {
  const floors = pcts.map(p => Math.floor(p));
  let left = 100 - floors.reduce((n, v) => n + v, 0);
  const order = pcts
    .map((p, i) => ({ i, rem: p - Math.floor(p) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors.map((v, i) => (v === 0 && pcts[i] > 0 ? '<1' : String(v)));
}

export function buildModelMix(
  sessions: { model?: string; models?: Record<string, number>; totalTokens: number }[]
): ModelMixSlice[] {
  const acc = new Map<ModelMixKey, { tokens: number; sessions: number }>();
  const add = (key: ModelMixKey, tokens: number) => {
    const cur = acc.get(key) ?? { tokens: 0, sessions: 0 };
    cur.tokens += tokens;
    cur.sessions += 1;
    acc.set(key, cur);
  };
  for (const s of sessions) {
    // `models` counts messages per model id, so a session that switched model
    // mid-way (a `/model` call) splits its tokens across the families in
    // proportion to the messages each produced. It is an approximation — the
    // transcript does not bill tokens per family — but attributing every token
    // to the dominant model, as this used to, is a worse one: it hides the
    // switch entirely. `model` stays the fallback for sessions read before
    // `models` existed.
    const perModel = Object.entries(s.models ?? {}).filter(([, n]) => n > 0);
    const totalMsgs = perModel.reduce((n, [, v]) => n + v, 0);
    if (totalMsgs <= 0) {
      add(modelMixKey(s.model), s.totalTokens);
      continue;
    }
    const byFamily = new Map<ModelMixKey, number>();
    for (const [id, count] of perModel) {
      const key = modelMixKey(id);
      byFamily.set(key, (byFamily.get(key) ?? 0) + count);
    }
    for (const [key, count] of byFamily) add(key, (s.totalTokens * count) / totalMsgs);
  }
  const total = [...acc.values()].reduce((n, v) => n + v.tokens, 0);
  if (total <= 0) return [];
  const slices = MODEL_MIX_ORDER.map(({ key, label }) => {
    const v = acc.get(key) ?? { tokens: 0, sessions: 0 };
    return { key, label, tokens: v.tokens, sessions: v.sessions, pct: (v.tokens / total) * 100 };
  }).filter(slice => slice.tokens > 0);
  const labels = pctLabels(slices.map(s => s.pct));
  return slices.map((s, i) => ({ ...s, tokens: Math.round(s.tokens), pctLabel: labels[i] }));
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
