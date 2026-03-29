import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'

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
        className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 cursor-pointer"
      >
        {children}
      </a>
    )
  },

  // Heading con ancore visive
  h1({ children }) {
    return <h1 className="text-xl font-bold text-[#e0e2f0] mt-5 mb-3 pb-1 border-b border-[#252836]">{children}</h1>
  },
  h2({ children }) {
    return <h2 className="text-lg font-semibold text-[#e0e2f0] mt-4 mb-2 pb-1 border-b border-[#1c2030]">{children}</h2>
  },
  h3({ children }) {
    return <h3 className="text-base font-semibold text-[#c4c8e0] mt-3 mb-2">{children}</h3>
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
            <span className="absolute top-2 right-3 text-xs text-zinc-400 font-mono select-none z-10">
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
        remarkPlugins={[remarkGfm, remarkFrontmatter]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
