export interface Heading {
  level: number
  text: string
}

export function extractHeadings(text: string): Heading[] {
  const headings: Heading[] = []
  const lines = text.split('\n')
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
      })
    }
  }
  return headings
}

export function parseMemoryContent(raw: string): {
  body: string
  wordCount: number
  charCount: number
  linkCount: number
  headings: Heading[]
} {
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
  const wordCount = body.split(/\s+/).filter(Boolean).length
  const charCount = body.length
  const linkCount = (body.match(/\[([^\]]+)\]\(([^)]+)\)/g) ?? []).length
  const headings = extractHeadings(body)

  return { body, wordCount, charCount, linkCount, headings }
}

export function readingTime(wordCount: number): string {
  const minutes = Math.ceil(wordCount / 200)
  return minutes === 1 ? '1 min' : `${minutes} min`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}
