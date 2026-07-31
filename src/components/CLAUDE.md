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
import Markdown from './components/Markdown';

export default function MyDoc() {
  return <Markdown className="max-w-2xl">{markdownString}</Markdown>;
}
```

### ErrorBoundary.tsx

React class error boundary that catches render-time errors in its subtree and
renders `<QueryError />` instead of crashing the app.

### QueryError.tsx

Presentational error surface for failed IPC/React Query calls. Accepts an
`error` (Error, string, or unknown) and an optional `onRetry` handler (renders
a "Retry" button when provided).

### UpdateBanner.tsx

Passive "new release available" notice, mounted in `App.tsx`. Shows once per
launch when `useUpdateCheck()` (IPC `updates:check` → GitHub releases API)
reports a version newer than the running build. Bottom-left toast (the session
toaster owns bottom-right) reusing the `.cl-toast` anatomy with an accent
stripe. Actions: "View release" (opens the GitHub release page in the system
browser), "Skip this version" (persisted per-version in prefs as
`cl-update-skipped-version`), ✕ (hides for this run only). On macOS adds a
footnote pointing to the quarantine-clearing command in Settings → General.
No auto-install by design — the app ships unsigned.

## CSS Classes

Components use Tailwind CSS + a custom `prose-lens` variant defined in `tailwind.config.ts` for semantic markdown rendering.

## When adding components

1. Keep components focused (single responsibility)
2. Use Tailwind for styling — no CSS modules or styled-components
3. Document props and usage in this file
4. Export as default from `index.ts` if it's a shared component
