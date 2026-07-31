import { isValidElement, memo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import type { Components } from 'react-markdown';
import 'katex/dist/katex.min.css';

// Reads the `language-xxx` class off the <code> child of a fenced block.
// Fences without a language (plain ```) have no such class — fall back to 'text'.
function langFromChild(children: React.ReactNode): string {
  if (isValidElement(children)) {
    const cn = (children.props as { className?: string }).className ?? '';
    const lang = cn.replace('language-', '').trim();
    if (lang && cn.includes('language-')) return lang;
  }
  return 'text';
}

// Fenced code block: rendered at the <pre> level so it catches every fence —
// including plain ``` with no language (which never gets a `language-` class).
// Dark surface + header bar (language label + copy button).
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const lang = langFromChild(children);
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = preRef.current?.textContent ?? '';
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="cl-md-code">
      <div className="cl-md-code-head">
        <span className="cl-md-code-lang">{lang}</span>
        <button type="button" className="cl-md-code-copy" onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre ref={preRef} className="cl-md-code-body">
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  // Link: apre nel browser di sistema tramite shell, non nel renderer Electron
  a({ href, children }) {
    const handleClick = (e: React.MouseEvent) => {
      e.preventDefault();
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        window.open(href, '_blank', 'noopener');
      }
    };
    return (
      <a
        href={href}
        onClick={handleClick}
        className="text-[var(--cl-accent-ink)] hover:text-[var(--cl-accent-ink)] underline underline-offset-2 cursor-pointer"
      >
        {children}
      </a>
    );
  },

  // Heading con ancore visive
  h1({ children }) {
    return (
      <h1 className="text-xl font-bold text-[var(--cl-ink)] mt-5 mb-3 pb-1 border-b border-[var(--cl-line)]">
        {children}
      </h1>
    );
  },
  h2({ children }) {
    return (
      <h2 className="text-lg font-semibold text-[var(--cl-ink)] mt-4 mb-2 pb-1 border-b border-[var(--cl-line-soft)]">
        {children}
      </h2>
    );
  },
  h3({ children }) {
    return <h3 className="text-base font-semibold text-[var(--cl-ink-2)] mt-3 mb-2">{children}</h3>;
  },

  // Blocco codice fenced: il <pre> avvolge sempre il blocco (con o senza
  // linguaggio), quindi gestiamo qui header + copia. Il <code> resta neutro.
  pre({ children }) {
    return <CodeBlock>{children}</CodeBlock>;
  },

  code({ className, children, ...props }) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

interface Props {
  children: string;
  className?: string;
}

// Memoized: parsing markdown and re-highlighting every fenced block (via
// rehype-highlight / highlight.js) is one of the costliest things the renderer
// does per paint, and <Markdown> is mounted in many parents that re-render for
// unrelated reasons (editing a sibling field, hover, density toggles, live
// streams). With string-only props and module-level plugins/components, a
// shallow prop compare lets it skip the whole pipeline whenever `children` is
// unchanged — keeping those re-renders cheap.
function Markdown({ children, className = '' }: Props) {
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
  );
}

export default memo(Markdown);
