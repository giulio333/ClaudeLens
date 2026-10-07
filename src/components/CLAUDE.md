# components/ — shared components

The components used across views. Each file's header says what it does; these are the rules that
are easy to break.

## `Markdown.tsx` and what it renders

- `Markdown` is memoized for a measured reason: a transcript holds hundreds of them. It consumes
  only stable contexts, so data arriving for one chip never re-renders every bubble.
- **Images by path** (`![x](/abs/file.png)`, `file://`, a relative path inside a
  `VaultLinksProvider`) are read through `images:read` and drawn from the `data:` URI it returns
  (`ImageFigure.tsx`, `image-src.ts`): the renderer runs sandboxed on `file://` under
  `img-src 'self' data:` and cannot load them itself. `urlTransform` keeps `file:` and
  `data:image/`, which react-markdown drops by default. A missing or refused file is a chip that
  says so, never a broken-image glyph. Under a `RemoteOriginContext` (`remote-origin.ts`) a path is
  not read at all: it names a file on the host.
- Obsidian callouts (`rehype-callouts.ts`) take one of the app's existing tones, never a hue of
  their own.

## `[[wikilinks]]` (`VaultLinks.tsx`, `vault-link-engine.ts`, `rehype-wikilinks.ts`)

- A chip has three states: solid (the project has the file), dashed (nothing answers to the name),
  plain (the lookup is in flight or failed — not knowing must not read as "missing"). Resolution is
  in the main process (`electron/modules/vault-index.ts`).
- `VaultLinksProvider` is mounted by `ChatView` and `LiveChatView` and deliberately not higher: the
  memory views carry wikilinks that point at topics, not project files. Outside a provider
  `Markdown` renders `[[…]]` exactly as before.
- `rehype-wikilinks` catches prose and an inline code span that is entirely one link, never
  descends into `<pre>`, and **must run before `rehypeHighlight`**. `lib/wikilinks.ts` strips fences
  for the same reason: the two passes must agree on what a citation is.
- The engine asks once per tick, not per link. Its `dispose` has a `revive` because StrictMode
  runs every effect twice: a one-way dispose left every chip neutral in the real app while the
  tests were green. A name is marked as asked in `flush`, when it is sent, and `request` is not
  gated on `disposed` (effects run child-first).
- A hit is cached forever, a miss for 30 s (`RETRY_MISS_AFTER_MS`), which must not be shorter than
  the main process' `INDEX_TTL_MS`: Claude writes the notes it cites, so a missing name often
  becomes real a minute later.

## `LiveOrb.tsx` + `live-orb.ts`

- The orb means "Claude is working now", never "the process is alive".
- `color` takes only hex or `rgb()`: an `oklch()` token or a `var()` is dropped silently and the
  dots go grey. `ORB_INK` repeats each token in hex per theme, and `test/live-orb.test.ts` fails
  when a copy goes stale.
- The theme is pinned from `ThemeContext`, never the orb's `auto`, which observes the whole
  document. Always `aria-hidden`.

## Banners and toasts

- `UpdateBanner.tsx`: no auto-install, because the app ships without a Developer ID signature. The
  Claude Code notice reads the installed CLI (`useClaudeCodeVersion` → `claude --version`), never
  the SDK handshake's bundled version; an unknown version is never treated as outdated, and
  dismissing it pins the required version, so a raised requirement brings it back.
- `NotificationToaster.tsx` never navigates on its own. `onDismiss` takes the id instead of being
  pre-bound, because it is a dependency of the dismiss timer; hover pauses both the timer and its
  bar.
