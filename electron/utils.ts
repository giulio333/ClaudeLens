export function hashToPath(hash: string): string {
  // Il primo '-' diventa '/', poi tutti gli altri '-' diventano '/'
  // Esempio: -Users-giulio-Desktop → /Users/giulio/Desktop
  return '/' + hash.replace(/^-/, '').replace(/-/g, '/')
}

export function pathToHash(realPath: string): string {
  return realPath.replace(/\//g, '-')
}
