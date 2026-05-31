// Deriva il nome visualizzato di un progetto dal suo path assoluto.
// Funziona sia con separatori POSIX (`/`, macOS/Linux) sia Windows (`\`):
// uno split solo su `/` lascerebbe l'intero path `C:\Users\foo\bar` come unico
// segmento, mostrando il path completo invece del nome cartella.
export function projectDisplayName(realPath: string): string {
  const segments = realPath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? realPath;
}
