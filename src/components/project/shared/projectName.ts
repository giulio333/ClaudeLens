// Deriva il nome visualizzato di un progetto dal suo path assoluto.
// Funziona sia con separatori POSIX (`/`, macOS/Linux) sia Windows (`\`):
// uno split solo su `/` lascerebbe l'intero path `C:\Users\foo\bar` come unico
// segmento, mostrando il path completo invece del nome cartella.
export function projectDisplayName(realPath: string): string {
  const segments = realPath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? realPath;
}

/**
 * Prefisso comune (per segmenti) di un insieme di path — la parte che non
 * distingue. Le cartelle di un gruppo di duplicati condividono il basename (è
 * ciò che le rende candidate), quindi ciò che le separa sta nel mezzo del path:
 * smorzare la testa condivisa porta l'occhio direttamente lì.
 *
 * L'ultimo segmento non viene mai consumato (un path deve restare leggibile).
 * Il separatore è dedotto dal primo path, come `projectDisplayName` accetta
 * entrambi; con separatori misti il risultato non è un prefisso letterale e il
 * chiamante ricade sul path intero.
 */
export function sharedPathPrefix(paths: string[]): string {
  if (paths.length < 2) return '';
  const sep = !paths[0].includes('/') && paths[0].includes('\\') ? '\\' : '/';
  const parts = paths.map(p => p.split(sep));
  const first = parts[0];
  let i = 0;
  while (i < first.length - 1 && parts.every(p => i < p.length - 1 && p[i] === first[i])) i++;
  const prefix = i === 0 ? '' : first.slice(0, i).join(sep) + sep;
  // absolute paths that diverge immediately share only the root separator:
  // there is nothing worth muting there
  return prefix === sep ? '' : prefix;
}
