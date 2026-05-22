import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

export function hashToPath(hash: string): string {
  // Fallback ingenuo: Claude Code converte sia '/' sia '.' in '-' nel nome cartella,
  // quindi questa inversione è lossy (es. SARA2.0 → SARA2-0 → SARA2/0).
  // Usa resolveRealPath quando possibile per leggere il cwd autoritativo dai .jsonl.
  return '/' + hash.replace(/^-/, '').replace(/-/g, '/')
}

export function pathToHash(realPath: string): string {
  return realPath.replace(/\//g, '-')
}

// Cache per evitare di rileggere lo stesso jsonl più volte nella stessa sessione.
const cwdCache = new Map<string, string>()

/** Invalida la cache del cwd dopo che il contenuto di una cartella è cambiato (es. merge). */
export function invalidateCwdCache(hash?: string): void {
  if (hash) cwdCache.delete(hash)
  else cwdCache.clear()
}

export function resolveRealPath(projectsDir: string, hash: string): string {
  const cached = cwdCache.get(hash)
  if (cached) return cached

  const projectDir = join(projectsDir, hash)
  try {
    const files = readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const full = join(projectDir, f)
        return { full, mtime: statSync(full).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)

    for (const { full } of files) {
      const cwd = readCwdFromJsonl(full)
      if (cwd) {
        cwdCache.set(hash, cwd)
        return cwd
      }
    }
  } catch {
    // ignore, ricade nel fallback
  }

  return hashToPath(hash)
}

function readCwdFromJsonl(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    for (const line of content.split('\n')) {
      if (!line) continue
      const idx = line.indexOf('"cwd"')
      if (idx === -1) continue
      try {
        const obj = JSON.parse(line)
        if (typeof obj.cwd === 'string' && obj.cwd.startsWith('/')) return obj.cwd
      } catch {
        // riga malformata, continua
      }
    }
  } catch {
    // file illeggibile
  }
  return null
}
