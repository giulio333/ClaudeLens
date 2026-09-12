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
- `[[wikilink]]` chips — **only inside a `VaultLinksProvider`** (see below)

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

### VaultLinks.tsx + vault-link-engine.ts + rehype-wikilinks.ts

The `[[wikilink]]` a message cites, drawn as a chip that says whether the file
is there. Claude writes its sources in Obsidian's notation — `Fonte: [[Procedura
Upload Tesi.pdf]]` — and the transcript rendered that as text, so a citation of
a file that is really in the project and one Claude invented looked exactly the
same. **Solid and clickable** = the project has it (click → `vault:openFile` →
`shell.openPath`, because the citations are PDFs as often as notes);
**dashed and inert** = nothing on disk answers to that name; **plain, no border**
= the lookup is still in flight or failed — not knowing is a third thing and
must not read as "missing". Resolution itself is in the main process
(`electron/modules/vault-index.ts`), which is where the reasoning about what may
resolve to what lives.

- **`rehype-wikilinks.ts`** — the pass that emits the chips as
  `<span data-wikilink>`, mapped back to `<WikiLink>` by `Markdown`'s `span`
  component (a data attribute, not a custom tag: react-markdown's `Components`
  map is keyed by intrinsic elements and a custom key needs a cast). It catches
  **two** forms, because both occur in real transcripts: plain prose and inline
  code — Claude writes `` `[[Nota]]` `` about as often — which is why this cannot
  be a remark plugin over text nodes. An `<code>` is rewritten only when its
  ENTIRE content is one link (a code span that merely mentions one is code);
  `<pre>` is never descended into, so a transcript quoting markdown source keeps
  its brackets. **It must run before `rehypeHighlight`**, which rewrites the
  inside of code elements into nested spans — after it, an inline `` `[[x]]` ``
  no longer has the single text child the pass looks for.
- **`lib/wikilinks.ts`** — the grammar (`[[Note#Heading|alias]]` → target +
  label) and `wikiLinkTargets`, the names a message reports. It strips fenced
  blocks for the same reason the rehype pass skips `<pre>`: the two passes have
  to agree on what counts as a citation, or the renderer asks the main process
  about names that can never be drawn.
- **`vault-link-engine.ts`** — contexts, hooks and the batching closure.
  **One call per tick, not per link**: a transcript holds hundreds of messages,
  so the engine collects what every `<Markdown>` reports in a commit and asks
  once. **Two contexts** because `<Markdown>` is memoized for a measured reason
  (see its own note): it consumes only the API context, stable for as long as
  the project is, so answers arriving cannot re-render every bubble — the states
  context is consumed by the chips alone. The mutable bookkeeping is a closure
  created in a `useMemo` keyed on the root, not refs: it belongs to one project
  and is replaced wholesale when the root changes (a reply from the old engine
  is dropped by its `dispose`), and refs mutated during render are a lint error.
  **A hit is cached forever, a miss only for 30s** (`RETRY_MISS_AFTER_MS`, which
  must not be shorter than the main process' `INDEX_TTL_MS` or the re-ask is
  served from the same cached index): Claude writes the notes it cites, so the
  name that was not there when the transcript first mentioned it is exactly the
  one that becomes real a minute later — a permanent "already asked" latch would
  have reintroduced, one layer up, the failure the index TTL exists to avoid,
  and would have pinned a chip to plain text on a single transient IPC error.
  The re-ask rides a `<Markdown>` reporting the name again (a later message, a
  streaming turn); a static transcript nobody adds to never re-asks.
- **`VaultLinks.tsx`** — `VaultLinksProvider` and the chip. The provider is
  mounted by `ChatView` and `LiveChatView` with `project.realPath`, and
  **deliberately not higher**: the memory views carry wikilinks of their own
  that point at topics under `~/.claude`, not at files in the project, so a
  provider above them would mark every one of those as a missing source.
  Outside a provider `Markdown` runs its original plugin list and `[[…]]`
  renders byte-identical to before.

Covered by `test/markdown-wikilinks.test.tsx` (the chip, both forms, the fence,
the failed lookup, the no-provider passthrough) and `test/wikilinks.test.ts`.

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

The file hosts a **second, quieter notice** in the same bottom-left anchor
(`.cl-update-anchor`, now a column stack so both can be on screen without
either knowing about the other): **the installed Claude Code CLI is older than
the `claudeCodeVersion` this build was prepared against**. The installed
version comes from `useClaudeCodeVersion()` (IPC `updates:claudeCodeVersion` →
`readInstalledClaudeVersion` in `claude-cli.ts`, i.e. `claude --version` parsed
by `parseClaudeCliVersion`), compared renderer-side with the shared `compareVersions`
— the same verdict Settings → General already prints as the `outdated` chip,
now surfaced at launch, where a stale CLI actually costs something (ClaudeLens
reads what that CLI writes to `~/.claude`). Settings reads **this same hook**:
it used to print the SDK handshake's `claude_code_version` instead, which is
the CLI bundled in the Agent SDK this build ships and therefore stands still
when the user updates their own — the two surfaces disagreed by whatever the
user had installed since. That switch alone did **not** fix the number: the
handler still passed `resolveClaudeExecutablePath()`, which in a packaged app is
the asar-unpacked _SDK_ binary, so `claude --version` was asked of the same
bundled CLI and answered 2.1.220 to a user on 2.1.232 (invisible in dev, where
the resolver returns undefined and the PATH CLI answers). The read now lives in
`readInstalledClaudeVersion(env)`, whose signature has no executable to pass —
only the PATH `claudeEnv()` builds can answer this question.

Deliberately minimal: **no stripe and no title** — nothing is broken, so it
gets one sentence, the `claude update` command with a Copy button, and a
"Don't remind me". The CLI check is asked to the CLI itself rather than to the
Agent SDK handshake, which is slow and cwd-scoped (an untrusted dir answers
nothing). A failed read (`claude` not in PATH, timeout) throws and the notice
simply never appears — an unknown version is never treated as outdated.
Dismissal pins the **required** version in prefs
(`cl-cli-update-dismissed-version`), so raising the requirement in a later
ClaudeLens brings the notice back; ✕ hides it for this run only. Silent in
`SCREENSHOT_MODE` (the handler returns a null version).

### NotificationToaster.tsx

Transient toasts for session-lifecycle events pushed over `notifications:event`
(`electron/modules/notifications/`), bottom-right, mounted inside
`ProjectOverview` so `onOpenSession` can reach the navigation state. Passive and
suggested only: it never navigates on its own.

Each toast is **one Mission Control feed row** (`.cl-ntf-*`, mirroring
`terminal/MissionRail`'s `FeedRow`: state dot · subject · status tag). A
notification _is_ a session event, and that is the language this app already
uses for events; the previous form was a generic 4px-stripe-on-the-left card, a
library convention in an app that carries state with a dot everywhere else.
Consequences of the row form:

- **The subject line is the project**, not the prose — it is what the eye looks
  for when a corner of the screen moves. The state is the right-hand tag
  (`FINISHED` / `WAITING` / `ERROR`) and the prose becomes the meta line, with
  the session's short id after it.
- The row is composed from `kind` + `cwd` + `body`, **deliberately not from the
  event's `title`**: that full sentence ("Claude finished — your turn") is
  written for the OS notification's conventions, so it stays the row's `title`
  tooltip instead of being re-flowed into a two-line row.
- `needs-attention` is the one kind still blocked on the user, so it is the one
  that pulses — with its own accent keyframes, since `.cl-live-dot`'s halo is
  hardcoded to the green "ok" hue.
- **The card is dressed like the global home**, the surface it floats over:
  `--cl-r-card` radius, 14px sans subject, 10px mono meta, and a bare mono
  `open session →` in place of the boxed uppercase button — the same register as
  the home's `resume →`. It stops short of the home's **tinted** row: there the
  accent wash means "live project you can resume", while a state tint here would
  be the colored-card idiom coming back in a softer coat, and the state is
  already said three times (dot, tag, timer hairline). The action hangs off the
  subject's left rail instead of the card's right edge — unboxed and
  right-aligned in a 340px card, it read as unanchored.
- **The time gutter is gone.** It printed the literal string `now`, always: a
  transient toast has no other time to show, so the column was 30px of nothing.
  The remaining three columns are still the feed anatomy.
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
