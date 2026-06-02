import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import type { Components } from 'react-markdown'
import 'katex/dist/katex.min.css'

const components: Components = {
  // Link: apre nel browser di sistema tramite shell, non nel renderer Electron
  a({ href, children }) {
    const handleClick = (e: React.MouseEvent) => {
      e.preventDefault()
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        window.open(href, '_blank', 'noopener')
      }
    }
    return (
      <a
        href={href}
        onClick={handleClick}
        className="text-[var(--cl-accent-ink)] hover:text-[var(--cl-accent-ink)] underline underline-offset-2 cursor-pointer"
      >
        {children}
      </a>
    )
  },

  // Heading con ancore visive
  h1({ children }) {
    return <h1 className="text-xl font-bold text-[var(--cl-ink)] mt-5 mb-3 pb-1 border-b border-[var(--cl-line)]">{children}</h1>
  },
  h2({ children }) {
    return <h2 className="text-lg font-semibold text-[var(--cl-ink)] mt-4 mb-2 pb-1 border-b border-[var(--cl-line-soft)]">{children}</h2>
  },
  h3({ children }) {
    return <h3 className="text-base font-semibold text-[var(--cl-ink-2)] mt-3 mb-2">{children}</h3>
  },

  // Blocco codice con label linguaggio
  pre({ children }) {
    return <pre className="relative">{children}</pre>
  },

  code({ className, children, ...props }) {
    const isBlock = className?.startsWith('language-')
    const lang = className?.replace('language-', '') ?? ''

    if (isBlock) {
      return (
        <div className="relative group">
          {lang && (
            <span className="absolute top-2 right-3 text-xs text-[var(--cl-ink-3)] font-mono select-none z-10">
              {lang}
            </span>
          )}
          <code className={className} {...props}>
            {children}
          </code>
        </div>
      )
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    )
  },
}

interface Props {
  children: string
  className?: string
}

export default function Markdown({ children, className = '' }: Props) {
  return (
    <div className={`prose prose-sm prose-lens max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkFrontmatter, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
