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
No auto-install by design — the app ships unsigned. It is now the **only** user
of the `.cl-toast` stripe-card anatomy: session notifications moved to the
feed-row form (below), so the two bottom corners no longer share one shape.

### NotificationToaster.tsx

Transient toasts for session-lifecycle events pushed over `notifications:event`
(`electron/modules/notifications/`), bottom-right, mounted inside
`ProjectOverview` so `onOpenSession` can reach the navigation state. Passive and
suggested only: it never navigates on its own.

Each toast is **one Mission Control feed row** (`.cl-ntf-*`, mirroring
`terminal/MissionRail`'s `FeedRow`: time gutter · state dot · subject · status
tag). A notification _is_ a session event, and that is the language this app
already uses for events; the previous form was a generic 4px-stripe-on-the-left
card, a library convention in an app that carries state with a dot everywhere
else. Consequences of the row form:

- **The subject line is the project**, not the prose — it is what the eye looks
  for when a corner of the screen moves. The state is the right-hand tag
  (`FINISHED` / `WAITING` / `ERROR`) and the prose becomes the meta line, with
  the session's short id after it.
- The row is composed from `kind` + `cwd` + `body`, **deliberately not from the
  event's `title`**: that full sentence ("Claude finished — your turn") is
  written for the OS notification's conventions, so it stays the row's `title`
  tooltip instead of being re-flowed into a 30px-gutter layout.
- `needs-attention` is the one kind still blocked on the user, so it is the one
  that pulses — with its own accent keyframes, since `.cl-live-dot`'s halo is
  hardcoded to the green "ok" hue.
- **The auto-dismiss is visible**: a hairline that retracts over
  `AUTO_DISMISS_MS`, whose duration is passed in from the component so the bar
  and the timer cannot drift. Hover pauses **both** — a bar that kept running
  while you read a long error would be lying — via a remaining-time ref, so
  pausing never restarts the clock. `onDismiss` takes the id rather than being
  pre-bound: it is a dependency of that timer, and a fresh closure per parent
  render would restart it on every re-render. Both animations respect
  `prefers-reduced-motion`.

## CSS Classes

Components use Tailwind CSS + a custom `prose-lens` variant defined in `tailwind.config.ts` for semantic markdown rendering.

## When adding components

1. Keep components focused (single responsibility)
2. Use Tailwind for styling — no CSS modules or styled-components
3. Document props and usage in this file
4. Export as default from `index.ts` if it's a shared component
