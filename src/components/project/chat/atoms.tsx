import { useMemo } from 'react'
import hljs from 'highlight.js/lib/common'
import { ParsedMemory, MEMORY_TYPE_STYLE } from './utils'

// File extension (or bare language name) → highlight.js language id. Limited to
// the languages bundled in highlight.js' "common" build; anything not listed
// falls back to plain (no tokenization) so an unknown extension never throws.
const EXT_TO_LANG: Record<string, string> = {
  py: 'python', pyw: 'python', pyi: 'python',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  rb: 'ruby', php: 'php', swift: 'swift', lua: 'lua',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  sh: 'bash', bash: 'bash', zsh: 'bash', shell: 'bash',
  json: 'json', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini',
  xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml', vue: 'xml',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  sql: 'sql', md: 'markdown', mdx: 'markdown', markdown: 'markdown',
}

/** Resolves an extension/language hint to a registered highlight.js language,
 *  or null when we can't (so the block renders as plain monospace). */
function resolveLang(hint?: string): string | null {
  if (!hint) return null
  const key = hint.toLowerCase().replace(/^\./, '')
  const lang = EXT_TO_LANG[key] ?? key
  return hljs.getLanguage(lang) ? lang : null
}

/** TopBar badge shown when the session is currently live in a terminal
 *  (per the sessions registry). Shared by ChatView and LiveChatView. */
export function LiveInTerminalBadge() {
  return (
    <span
      title="This session is running in your terminal right now"
      className="flex items-center gap-1.5 font-mono uppercase"
      style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--cl-ok)' }}
    >
      <span
        aria-hidden
        style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cl-ok)' }}
      />
      Live in terminal
    </span>
  )
}

export function PathChip({ path }: { path: string }) {
  const parts = path.split('/')
  const file = parts.pop() ?? path
  const dir = parts.join('/') || '/'
  return (
    <div className="flex items-center gap-1.5 bg-[var(--cl-paper-3)] border border-[var(--cl-line)] px-3 py-2 text-[12px] font-mono min-w-0 overflow-hidden" style={{ borderRadius: '2px' }}>
      <span className="text-[var(--cl-ink-3)] truncate shrink-1 min-w-0">{dir}/</span>
      <span className="text-[var(--cl-ink-2)] font-semibold shrink-0">{file}</span>
    </div>
  )
}

export function SectionLabel({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[10px] font-bold text-[var(--cl-ink-3)] uppercase tracking-widest">{label}</span>
      {meta && <span className="text-[10px] text-[var(--cl-ink-2)]">{meta}</span>}
    </div>
  )
}

export function CodeBlock({ code, lang, className = '' }: { code: string; lang?: string; className?: string }) {
  const lines = code.split('\n').length
  const language = resolveLang(lang)
  // Tokenize with highlight.js when we know the language; memoized so large
  // files aren't re-highlighted on every render. Output is HTML-escaped by
  // highlight.js, so dangerouslySetInnerHTML is safe here.
  const highlighted = useMemo(() => {
    if (!language) return null
    try {
      return hljs.highlight(code, { language }).value
    } catch {
      return null
    }
  }, [code, language])

  return (
    <div className={`overflow-hidden border border-[var(--cl-line)] ${className}`} style={{ borderRadius: '2px' }}>
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] bg-[var(--cl-paper-3)] text-[var(--cl-ink-3)]">
        <span>{lines} {lines === 1 ? 'line' : 'lines'}</span>
        {language && <span className="font-mono uppercase tracking-wider">{language}</span>}
      </div>
      <pre className="cl-code-pre m-0 px-4 py-3 text-[12px] font-mono leading-relaxed overflow-x-auto">
        {highlighted ? (
          <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code className="hljs">{code}</code>
        )}
      </pre>
    </div>
  )
}

export function MemoryPreviewCard({ parsed }: { parsed: ParsedMemory }) {
  const style = MEMORY_TYPE_STYLE[parsed.type] ?? MEMORY_TYPE_STYLE.user
  return (
    <div className="border border-[var(--cl-violet)] bg-[var(--cl-paper-3)] overflow-hidden" style={{ borderRadius: '2px' }}>
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[var(--cl-violet)]/60 bg-[var(--cl-paper-2)]/90">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-[var(--cl-ink-2)]">{parsed.name || '—'}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 uppercase tracking-wide ${style.badge}`} style={{ borderRadius: '2px' }}>
              {style.label}
            </span>
          </div>
          {parsed.description && (
            <p className="text-[11px] text-[var(--cl-ink-3)] mt-0.5">{parsed.description}</p>
          )}
        </div>
        <span className="text-base shrink-0">🧠</span>
      </div>
      {parsed.body && (
        <div className="px-4 py-3">
          <pre className="text-[12px] text-[var(--cl-ink-3)] whitespace-pre-wrap break-words font-sans leading-relaxed">
            {parsed.body}
          </pre>
        </div>
      )}
    </div>
  )
}
