# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository

## Commands (run from repo root)

The npm scripts are in `package.json`; `npm run dev` / `build` / `typecheck` /
`lint` / `format` / `test` are the ones you want.

Unit tests (Vitest) live under `test/` and cover the pure parsing modules —
`cost-tracker`, `memory-reader`/`memory-writer`, `session-reader`,
`sessions-registry-reader`, `chat-stream`, `update-checker`, `plans-reader`,
`data-change-scope`, `session-read-cache`, `tasks-reader`, `project-description`,
`thoughts`, `transcript-extras`, `bg-sessions-reader`, `agents-live-status`,
and the chat `utils`.
`session-sdk-read`/`session-sdk-cache` are auth-free **integration** tests against the
real Agent SDK (files on disk, no model turn, no API key): they pin the transcript
read path, the `dir` narrowing hint and its empty-result fallback, the read
cache's invalidation, and the merge of the rows the SDK read does not return
(#245/#246 — a message absorbed mid-turn lands in chronological place and a
slash-command skill gets its `skillPath`, both from one extra pass over the
same file). CI (`.github/workflows/ci.yml`) runs format:check +
typecheck + lint + test + build on every push/PR. **Test order is randomised**
(`sequence.shuffle` in `vitest.config.ts`): every `it` has to be an independent
claim, and three files had quietly stopped being that — one test created the
workflow the next edited, another appended to a transcript a later one measured,
a third left an entry in `cost-tracker`'s append-only parse cache under a path it
then rewrote with different content. Each passed in file order and failed as soon
as two tests swapped places. So a fixture belongs in `beforeEach`, never in the
test that happens to run first, and module-level state (`resetParseCache`,
`resetSessionTails`, `resetSessionReadCache`, …) is reset there too. A red CI run
is reproduced with the seed it prints: `npx vitest run --sequence.seed=<n>`. The style gate is strict:
Prettier formatting is enforced repo-wide and `lint` runs with
`--max-warnings 0`, so a new warning fails the build — fix it or add an inline
`eslint-disable` with a reason. `typecheck` covers three projects: the renderer,
the main process, and `tsconfig.test.json` for `test/` — the suite used to be the
one part of the repo tsc never looked at.

**Renderer tests** run in jsdom against a fake preload bridge
(`test/helpers/fake-electron-api.ts`). `window.electronAPI` is the renderer's
single seam to the main process, so replacing it makes hooks and components run
unmodified with no Electron, no SDK and no `~/.claude` on disk: request/response
methods are `vi.fn()`s returning the `{ data, error }` envelope, `on*` channels
are `Channel`s a test emits on, and `Channel.listenerCount` catches
subscriptions that outlive their component. Opt in per file with a
`// @vitest-environment jsdom` docblock — the global environment stays `node` so
the ~45 main-process test files keep their startup cost. Covered so far:
`use-live-chat` (stream-envelope filtering, turn commit, permission queue,
resume seed, teardown), `use-data-changed-refetch` (debounce window, scope
union, the widen-on-unknown-payload fallback), `telemetry-report-error` (what
reaches `telemetry:trackError` and what the browser-noise filter drops first)
`settings-cli-version` (Settings → General prints `claude --version`, never
the SDK handshake's bundled `claude_code_version`, and says so when the read
fails instead of falling back to it), `project-description-view` (the hero's
description line: an edit goes to the prefs and never to the project's
CLAUDE.md, and clearing it falls back to the derived sentence) `thought-stream` (the running commentary of #236: only calls that arrive after
the view opened are narrated, a sentence holds the line for its own dwell and
the line then empties rather than keeping a stale one, a burst drops its middle
instead of falling behind, narration turned back on starts from the present, and
the deadline is absolute so a session appending in bursts cannot freeze one
sentence on screen) and
`live-monitor-view` (the Live Monitor's own half of #194: a retarget clears the
previous session's events/status/running tool before the new watch starts, LIVE
is shown only for a verified attachment — a `pending` watch reads WAITING — and
a `startWatch` answer belonging to a superseded session changes nothing) and
`message-bubble-markers` (the first test to mount `MessageBubble`: a message
absorbed mid-turn wears the "sent mid-turn" chip and an ordinary one does not,
and a slash command carrying a `skillPath` renders the skill card instead of
the plain command one — the claim the old `isSkill` tests only appeared to
make, since they fed the `isMeta` row the read path stopped returning).
Extend the fake as tests reach further; the one cast lives at its install point.

**Do not launch the app yourself to verify UI changes** (neither `npm run dev`
nor the `run-app` skill / Playwright driver) — it doesn't work reliably in this
setup and wastes time. Verify with `npm run typecheck` + `npm run lint` + `npm
test`, adding a renderer test when the change touches hook or stream state, and
leave running the app to the user, who will check the UI manually. Visual and
layout behavior still has no automated coverage.

**Transcript format drift** — the app reads a format Claude Code keeps extending,
and nothing announces a change: a new row type, `attachment` subtype or content
block just doesn't appear in the app (#245 and #246 both sat unnoticed for
months). Two instruments, answering two different questions, driven by the
`transcript-drift` skill:

- `npm run census` (`scripts/transcript-census.mjs`) — **what we don't read.**
  Streams the whole corpus (~1s for 261 MB) counting four discriminant axes —
  row `type`, `attachment.type`, `message.content[].type`, `system.subtype` —
  plus the key-paths of every row type the manifest does not mark `ignored`
  (covering only the chat rows left a hole where the interest is: a row already
  triaged `candidate` is not drift and its fields went uncollected, so a field
  added to one fired nothing), and diffs them against
  `scripts/transcript-manifest.mjs`. Exit 1 on drift.
- `npm run census:replay` (`test/transcript-drift.test.ts`) — **what we read
  wrong.** The census only sees the file; a field can be present, recognised and
  still dropped, which is what #245/#246 were. Fixtures pin which content blocks
  survive `parseContentArray`, and a corpus sweep fails on any dropped block the
  manifest hasn't triaged. The sweep is opt-in
  (`CLAUDELENS_DRIFT_CORPUS=1`) and `npm test` skips it: it costs ~1.2s and grows
  with the corpus, but the real reason is that its outcome depends on state the
  test did not create — unconditional, it reddens `npm test` on an unrelated
  branch because that machine's transcripts happen to hold something new, which
  is the same failure the randomised order exists to catch. The fixtures stay
  unconditional; they are the regression gate.

The manifest is what keeps this usable past its second run: it records
**decisions**, not observations — every shape is `read` (naming the module),
`ignored` (with the reason) or `candidate` (not read, and it should be), so a
shape with no entry is drift. Without that, every run re-lists the same
twenty-odd known-but-unread shapes and the tool dies of its own noise. The
committed `transcript-baseline.json` plays that role for key-paths, where a hand
table would be a second copy of the format and wrong within a week. Triage into
the manifest, then `npm run census:accept`. Only discriminant values are ever
recorded — the corpus is the user's real work and the baseline is committed. Note
where that nearly broke: a _key_ can be data. `file-history-snapshot` keys by
absolute file path, `cost-state` by model id, `toolUseResult.answers` by the full
text of the question asked, and the first walker recorded all three verbatim.
Data-keyed maps collapse to `{*}`, which keeps the schema under them
(`cost-state.modelUsage.{*}.costUSD`) and drops the keys; three tests hold that
line, one of them asserting the committed baseline itself looks like key-paths
and nothing else.

The first run found 14 row types and 27 attachment subtypes the code never
mentions, and three content blocks the reader drops silently: `image` (57 in the
corpus, each a turn rendered as nothing), `server_tool_use` and
`advisor_tool_result`. All triaged as `candidate` — the backlog is in the
manifest, not in an issue tracker.

`scripts/transcript-exercise.mjs` is the third stage and **opt-in** (`--yes`, and
refuses to start without it): it drives `claude -p` against prompts chosen to
provoke specific shapes, because the corpus only covers what this user happens to
do — a feature nobody exercised writes no rows, so the census can't tell "Claude
Code doesn't do this" from "we never tried". Real model turns, real tokens; never
part of a verify. It works in a throwaway temp dir, which the census skips by
name so synthetic rows never look like real usage. Note the gotcha it was written
around: Claude Code hashes the **resolved** cwd, so a macOS temp dir lands under
`-private-var-folders-…`, not `-var-folders-…`.

`transcript-drift-watch` is the unattended entry point (for `/loop` or
`/schedule`): it runs both instruments, reports only what is new, may write
`ignored`/`candidate` triage, and never touches a reader.

## Release

Before creating a GitHub Release, always run these steps **in order**:

1. `node scripts/prepare-release.js` — detects the locally installed Claude Code version and writes it into `claudeCodeVersion` in `package.json` (displayed in Settings → General → "Claude Code required")
2. Bump the app `version` field in `package.json` (semver, e.g. `2.1.1` → `2.1.2`)
3. Commit both changes together (e.g., `chore: bump to v2.1.2, claude-code 2.1.191`)
4. Create the GitHub Release with a `## Highlights` section at the top

**Binaries are built and attached by CI, not locally**: pushing the `v*` tag
(which `gh release create` does) triggers `.github/workflows/release.yml` — it
packages macOS DMG (x64 + arm64), Windows exe (windows-2022 runner) and Linux
AppImage on native runners (~9 min) and uploads all of them to the existing
Release without overwriting its notes. Don't run `npm run electron:build` or
attach assets by hand; just wait for the workflow and verify the assets landed
(`gh release view vX.Y.Z --json assets`).

**macOS signing is wired but conditional** (`docs/macos-signing.md`). The mac job
signs with a Developer ID certificate and notarizes when the repo has the five
Apple secrets, and falls back to the historical unsigned DMG when it doesn't —
so forks and this repo pre-certificate keep releasing. The build config
(`hardenedRuntime` + `build/entitlements.mac.*.plist`) is inert until an identity
exists; the entitlements are the short list a hardened Electron app needs, and
the app must stay **unsandboxed** (it reads `~/.claude`, drives arbitrary project
dirs and spawns the `claude` CLI through a pty). When a signed build ships,
three pieces of user-facing text about the quarantine workaround go stale —
README, Settings → General (`QUARANTINE_CMD`) and `UpdateBanner.tsx` — and
`electron-updater` becomes possible for the first time.

## Architecture

ClaudeLens is an Electron app that reads Claude Code's local data from `~/.claude/`.

**Main process** (`electron/main.ts`):

- Registers IPC handlers grouped by namespace: `memory:*`, `cost:*`, `claudeMd:*`, `sessions:*` (incl. `sessions:sendMessage`/`sessions:stopMessage`/`sessions:endChat` — chat runs through the **Agent SDK** in **streaming input mode**: one long-lived `ChatSession` per chat view drives a single persistent `query()` whose `prompt` is a push-generator (`modules/chat-runner.ts`), so successive turns ride the same warm session instead of re-resuming each time. `sendMessage` pushes the message into the live session when its id matches (applying `setModel`/`setPermissionMode` first), else resumes the transcript into a fresh session; `startMessage` starts a _new_ session with a **pre-generated `sessionId`** (`crypto.randomUUID`), emitting `sessions:chatStarted` immediately (no race); `stopMessage` is a native `interrupt()` (ends the turn, keeps the session warm); `endChat` disposes the session when the view unmounts. Streams over `sessions:chatChunk` (text deltas) + `sessions:chatToolActivity` (live "using tool" indicator: tool-input generation start + `tool_progress` heartbeats) + `sessions:chatMessage` (each fully-formed assistant/tool-result message as the SDK emits it, so the renderer builds the live turn — tools included — straight from the stream, not from a mid-stream disk re-read) + `chatDone` (per-turn end, carrying the SDK's `ChatTurnSummary` — cost/tokens/model read from the `result`, so the live chat shows running metadata without touching disk) / `chatError`. **Every stream payload is an envelope tagged with the producing `sessionId`** (`Chat*Event` in `electron/shared/chat-types.ts` — the single type definition shared with the renderer, re-exported by `src/types.ts`; permission requests carry the id too), so the renderer's `useLiveChat` drops stale events from a superseded session instead of trusting arrival order. Tool approvals go through the SDK's `canUseTool`: a non-auto-approved tool fires `sessions:permissionRequest` → the renderer's Allow/Always/Deny dialog (requests are **queued** renderer-side — concurrent `canUseTool` calls, e.g. parallel read-only tools, are answered one at a time; `AskUserQuestion` gets a dedicated answer form returning `{ questions, answers }` in the allowed input) → `sessions:permissionResponse` resolves the SDK's pending `PermissionResult` (`pendingPermissions` Map; `stopMessage`/`endChat`/supersede deny all pending). One `ChatSession` in flight at a time; if the live query dies on its own (fatal stream error — not a deliberate dispose) the main emits a final `chatDone` so the composer doesn't stay stuck on "Stop"), `rules:*`, `tasks:*`, `plans:*`, `workflows:*`, `teams:*`, `agents:*`, `skills:*`, `plugins:*` (installed plugins + their skills/agents/commands), `mcp:*`, `projects:*` (duplicate detect/merge + `projects:planPurge`/`projects:purge`, the delete path — see `modules/project-purger.ts` — + `projects:getDescription`, the one-line project description derived from the project's CLAUDE.md, see `modules/project-description.ts`), `live:*` (Live views: `live:getActiveSessions` + `live:getSessions` for the registry and the background-agent roster, `live:getActivity` for the Monitor's per-session tail digest — see `modules/session-tails.ts`), `ai:*`, `export:*`, `markdownFile:*`, `settings:*`, `config:*` (effective config via Agent SDK), `telemetry:*` (anonymous usage telemetry — `telemetry:isEnabled`/`telemetry:setEnabled` opt-out toggle + `telemetry:track` for renderer-fired feature events), `updates:*` (`updates:check` — GitHub-releases update check, see `modules/update-checker.ts`), `clipboard:*` (`clipboard:readText`/`writeText` via Electron's own `clipboard` module — the packaged renderer runs from `file://`, where `navigator.clipboard`'s read path needs a permission the app never grants; used only by the terminal pane's Windows/Linux copy-paste bindings)
- Watches `~/.claude/projects/`, `~/.claude/tasks/`, `~/.claude/plans/`, `~/.claude/teams/`, `~/.claude/workflows/`, each known project's `.claude/workflows/` and `~/.claude/plugins/installed_plugins.json` with chokidar (**depth 5** — depth 3 would stop at `{hash}/{sessionId}/subagents/` and never see the workflow sub-agent transcripts nested one level further, at `subagents/workflows/<runId>/agent-*.jsonl`; team inboxes are `ignored`); emits `data:changed` to renderer on any change, **carrying the namespaces the changed path can affect** (`modules/data-change-scope.ts` — a pure path classifier; `null` = "unknown", which the renderer must read as "invalidate everything"). The renderer unions the scopes across its debounce window and invalidates only those query keys, so a transcript append during a live chat no longer re-reads skills/agents/plugins/MCP (#148). A separate chokidar watch on `~/.claude/sessions/` (the live-session registry, rewritten on session status transitions) pushes the fresh `ActiveSession[]` over its own `live:activeSessions` channel (debounced read) instead of `data:changed`, so registry churn doesn't invalidate every React Query cache. That same registry read also reconciles the **Monitor's tail cursors** (`modules/session-tails.ts`), and the projects watcher above doubles as their event source — a second consumer on the existing `change` handler, so watching what every live session is doing costs no watcher of its own; its digests ride a third channel, `live:sessionActivity`
- Serializes `Map` → plain object before IPC (Maps are not transferable)

**Preload** (`electron/preload.ts`):

- Exposes `window.electronAPI` via `contextBridge` with context isolation
- `onDataChanged(callback)` lets the renderer subscribe to file watcher events

**Backend modules** (`electron/modules/`) — pure functions except `memory-writer.ts`.
One entry per module, with the rationale and the gotchas, lives in
`electron/modules/CLAUDE.md`, which loads when you work under `electron/`.

**Renderer** (`src/`):

- Single page, no routing — `tabs/ProjectOverview.tsx` manages all views with internal navigation state via a `View` discriminated union (`components/project/types.ts`, ~30 cases: `global-home`, `overview`, `sessions`, `chat`, `memory-topic`, `analytics`, global/project `skills`/`agents`/`mcp`/`claudemd`, `*-detail`, `*-create`, `studio`/`studio-create`/`studio-blueprint` (Agent Studio), `tasks`, `plans`, `plan-detail`, `live-monitor`, `agents-live`, `duplicates`, `settings`, `project-config`, …)
- `useIPC.ts` — all React Query hooks + `window.electronAPI` type declarations; `unwrap()` raises on error
- Mutations (`useCreateTopic`, `useUpdateTopic`, `useDeleteTopic`) invalidate `['memory:project', hash]` on success
- `useDataChangedRefetch()` in `App.tsx` invalidates all queries when the watcher fires
- Chat message pre-processing: user messages that are only `tool_result` are absorbed into the preceding assistant message; `tool_use` is matched to `tool_result` by ID to form `ToolGroup[]`

## Brand palette (Claude Code official)

| Token role | HEX       | Notes                                |
| ---------- | --------- | ------------------------------------ |
| Accent     | `#C15F3C` | Terracotta — primary brand accent    |
| Paper      | `#FFFFFF` | Base canvas (light theme)            |
| Paper-2    | `#F4F3EE` | Warm off-white surface / cards       |
| Warm gray  | `#B1ADA1` | Muted ink / dividers (reference hue) |

These are the only brand colors. They're encoded in `src/index.css` as
`--cl-accent`, `--cl-paper`, `--cl-paper-2`, and the warm-gray hue and
lifted to higher lightness in `[data-theme='dark']`. Do not introduce new
hues for accents — extend by varying lightness/chroma on the same hue (40°).
Note: `--cl-ink-4` in the light theme is darkened from the reference `#B1ADA1`
to ~`#7c7669` so meta text/labels meet WCAG AA contrast (~4.6:1) on white.

## Key conventions

**IPC result shape:** every handler returns `{ data: T | null, error: string | null }`. Renderer unwraps with `unwrap()` in `useIPC.ts`.

**Project identity:** data lives in `~/.claude/projects/{hash}/` where `hash` = absolute path with `/` → `-` (e.g. `/Users/foo/bar` → `-Users-foo-bar`). Conversion in `electron/utils.ts`.

**Memory format:** topic files use YAML frontmatter (`name`, `description`, `type`) + markdown body. `MEMORY.md` index lines: `- [filename.md](filename.md) — description`.

**Two tsconfigs:**

- `tsconfig.json` — renderer (ESNext modules, DOM types, JSX)
- `tsconfig.electron.json` — main + preload (CommonJS, no DOM)

**Build outputs:**

- `dist/` — Vite bundle (React SPA)
- `dist-electron/` — tsc output (main.js, preload.js, modules/)
