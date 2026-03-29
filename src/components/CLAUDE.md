# components/ — React Components

Reusable UI components for the ClaudeLens renderer.

## Components

### Markdown.tsx
Renders markdown with syntax highlighting and styled headings.

**Features:**
- Syntax highlighting via `rehype-highlight`
- GitHub-flavored markdown (GFM)
- Frontmatter support (YAML)
- Custom styled links, headings, and code blocks
- External links open in system browser (safe from Electron context)

**Props:**
- `children: string` — markdown source
- `className?: string` — optional wrapper CSS classes

**Usage:**
```tsx
import Markdown from './components/Markdown'

export default function MyDoc() {
  return <Markdown className="max-w-2xl">{markdownString}</Markdown>
}
```

## CSS Classes

Components use Tailwind CSS + a custom `prose-lens` variant defined in `tailwind.config.ts` for semantic markdown rendering.

## When adding components

1. Keep components focused (single responsibility)
2. Use Tailwind for styling — no CSS modules or styled-components
3. Document props and usage in this file
4. Export as default from `index.ts` if it's a shared component
