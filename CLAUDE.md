# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository

## Commands (run from repo root)

The npm scripts are in `package.json`; `npm run dev` / `build` / `typecheck` /
`lint` / `format` / `test` are the ones you want.

Unit tests (Vitest) live under `test/` and cover the pure parsing modules —
`cost-tracker`, `memory-reader`/`memory-writer`, `session-reader`,
`sessions-registry-reader`, `chat-stream`, `update-checker`, `plans-reader`,
`data-change-scope`, `session-read-cache`, `tasks-reader`, `project-description`,
`thoughts`, `transcript-extras`, `claude-executable` (#289 — the SDK chat's binary: the bundled one while it is there, else the user's `claude` from the same dirs Settings reads its version from, else a message that says what to do), `chat-permissions` (a suppressed "Always allow" is
neither offered nor accepted), `terminal-osc` (what a program in the terminal pane may hand
to this machine: an OSC 52 copy, never a clipboard read or clear, and a click
on an http(s) OSC 8 link), `bg-sessions-reader`, `agents-live-status`,
`vault-index`, `wikilinks`, `artifact`, `session-exchange`, `context-files`, `background-shells`, `plugins-reader` (the `.mcp.json` and
`hooks/hooks.json` parsers), `remote-ssh`, `remote-ssh-windows` and `remote-hosts-store`
(#242 — the connect script is run for real, through every login shell the machine has
and, for a Windows host, through `pwsh` where there is one, against a stub `claude`
under a temp home), `remote-watch` and `remote-transcript` (#294 — the watcher
that reads a remote session's registry entry and transcript is run the same way,
against a temp home holding a registry, a transcript and a live process standing
in for the CLI, and `RemoteLens` is driven end to end over it), and the chat `utils`, `find` and `model-options`
(which version each model alias resolves to, from the SDK handshake's model list).
`session-sdk-read`/`session-sdk-cache` are auth-free **integration** tests against the
real Agent SDK (files on disk, no model turn, no API key): they pin the transcript
read path, the `dir` narrowing hint and its empty-result fallback, the read
cache's invalidation, and the merge of the rows the SDK read does not return
(#245/#246 — a message absorbed mid-turn lands in chronological place and a
slash-command skill gets its `skillPath`, both from one extra pass over the
same file — and the page an `Artifact` publish produced, which lives on the
`toolUseResult` the SDK read never returns at all). CI (`.github/workflows/ci.yml`) runs format:check +
typecheck + lint + test + build on every push/PR, **on Node 22 and 24 both** —
`engines` says `>=22`, so a claim the suite only holds on one of them is a claim
the project does not make. Pinning 22 alone is what hid #258: two assertions were
bounded by the literal `64 * 1024`, which happened to equal Node 22's
`Buffer.poolSize`, and went red on 24 — where that pool is exactly 65536 — while
CI stayed green. A bound that has to describe an allocation belongs to
`Buffer.poolSize`, never to a number that matches it today. **Test order is randomised**
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
(`test/helpers/fake-electron-api.ts`). **Mount them the way `src/main.tsx`
mounts — inside `React.StrictMode`**: Testing Library's `render` does not, and
that gap is not cosmetic. StrictMode runs every effect, its cleanup, and the
effect again to prove a component survives a remount, and the wikilink chips
shipped with a provider whose one-way `dispose` made that rehearsal permanent —
on screen every citation stayed in the neutral "we do not know" state while all
ten of its tests were green. `window.electronAPI` is the renderer's
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
fails instead of falling back to it; and when the bundled CLI is missing and the
chat runs the PATH one, that handshake number is labelled `Chat CLI`, never
`Bundled CLI`), `search-view` (the results page of conversation search: the scan is
submitted and never streamed from keystrokes, the highlight is drawn at the
offsets the scan reported rather than re-found here, opening a hit resolves the
real `SessionSummary` from the project's list and refuses when the session is
gone, and a truncated scan says so), `duplicate-projects-view` (the Duplicates
page is read-only — its folder rows carry no control, since the merge was
removed on purpose — the primary comes first and says so, a path rebuilt from
the folder name says it is estimated, the path head a group shares is printed
once and each folder shows only the part that differs, and a scan still
running or failed is never reported as "no duplicates"), `project-description-view` (the hero's
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
`terminal-pane-osc` (the pane fed raw PTY output, #293: an OSC 52 copy lands on
the clipboard through the main process, a read request is never answered) and
`permission-request-dialog` (the SDK chat's approval dialog, #292: no "Always
allow" when the SDK suppresses the rule, the dialog opens on Deny for a
`defaultToNo` ask, the next queued request starts clean, and an MCP server's
name is printed as text) and
`message-bubble-markers` (the first test to mount `MessageBubble`: a message
absorbed mid-turn wears the "sent mid-turn" chip and an ordinary one does not,
and a slash command carrying a `skillPath` renders the skill card instead of
the plain command one — the claim the old `isSkill` tests only appeared to
make, since they fed the `isMeta` row the read path stopped returning; and an
`advisor` consult is a stream marker of its own in both density modes, stating
the reviewer model, the wall time and the spend, or degrading to the bare label
when the turn holds two consults and the shared `usage` cannot be split; and the
provenance work of #274 — a message from another session is drawn with the
sender on it and its body alone, an agent inside this session is told apart from
an external one, a mid-turn arrival is marked, a long dispatch opens folded and
unfolds on ask across the StrictMode remount, and a harness notice is a one-line
marker rather than a turn; and the sender's half — a `SendMessage` is drawn as
a message, to whom and with its summary, in both densities, never as the tool
card with the result JSON in it, offers the exchange only for a delivery to
another session, and says `SENDING`/`NO DELIVERY`/`FAILED` where the transcript
recorded no delivery; and a short `thinking` block — the update the terminal
prints as a message — is a labelled note inline in both densities, reached by
find and not by highlights, its row a turn in MIN that the shell run after it
folds into, while raw reasoning stays out of MIN and folded in FULL) and
`file-changes-strip` (the files a turn changed, at its foot in MIN density: an
`Edit` is drawn as its diff, open by default and numbered where the result
row's `structuredPatch` says, a live turn without those numbers falls back to
the diff of the two strings, a file rewritten from Bash — which no `Edit` call
ever named — is shown off its `bashEditDiff`, a `Write` that made a new file
says `created`, a read stays an icon chip and never a diff, a file read and
then edited is one row with every call, a capped Bash change says no diff was
recorded rather than drawing nothing, the pill's switch folds every diff and a
click on one reopens it alone until the switch moves again, the same strip
sits under the badge of a folded tool run, and a Bash edit on a tool-only turn
travels onto the turn it is folded into) and
`bash-edit-diff-view` (the diff of what a shell command changed, #265: the hunk
is drawn under the run with added and removed lines apart, a created or deleted
file is marked rather than printed, `unavailable` says so instead of drawing an
empty diff — which would read as "nothing changed" — a long diff folds at 24
lines and unfolds on ask, and a command that edited nothing renders exactly as
before) and
`tool-group-card` (a tool call is open by default and the window tools ARE
their window: a shell run is its terminal with no card header, an `Edit` is an
editor window drawing `old_string → new_string` as a diff with the result's
"updated successfully" folded into the status strip and an error printed under
the attempted change, a `Read` draws the rows with the line numbers Claude Code
printed and an unnumbered result as it is, a `Write` numbers from 1 and reads
`created` off the result, every other tool keeps its header with the body
already showing, and the agent strip MIN keeps on screen is still a chip that
opens on click; the pure half — the line LCS, the `N→` parsing, the short dir,
and the row highlighting, which colours each side of a diff whole so a `"""`
docstring stays a string on every row it spans, over `code-lang`'s
`highlightLines`, the cut of hljs' HTML into one balanced fragment per line —
is `file-view`) and
`exchange-view` (the page an inbound message opens, #280: it asks for the
exchange of the message it was opened on, draws the messages in the reader's
order attributed to their senders with the entry marked, states the pair once
and gives each message a side instead of repeating `sender → receiver` on
every row, wears one face per run of messages from the same party, folds a
long message, says a sender whose
transcript is gone is unresolved rather than dressing it up as a session,
resolves the real `SessionSummary` before opening a turn and refuses one that
is gone — the search-hit rule — and draws the hop chain as the path it is,
repeats included; the bubble's own half, in `message-bubble-markers`, is that
"Show exchange" is offered only for a session message carrying a `msgId`) and
`artifact-card` (the `Artifact` tool: a call that published a page is drawn
as that page — its own title, a real link, the version it produced — while one
that published nothing stays a chip whatever the density, because its answer is
a kilobyte of prose written for the harness; nothing is claimed where the
transcript is silent, so an older publish with no `seq` shows no version and one
with no `audience` says nothing about who can open it; and MIN keeps a published
page as one line beside the agent, skill and plan strips) and
`messages-dock` (Mission Control's own surface for the conversations a session
is having, kept out of the event feed on purpose: one card per counterpart with
what it is and the last thing said, the summary preferred over the text for the
preview, a thread with an id opening the exchange while an agent's locates its
turn, a last message that did not leave saying so instead of being counted, and
no dock at all for a session that talked to nobody — its threading half, which
keys a conversation on the pid the receiver verified rather than on a name the
party can change, is `mission-messages`) and
`context-rail` (the files a session read, on Lens's left edge where the
turn navigator was: dots at rest — one per file, lit for the turn being
read — the names by folder on hover, the lines of the last read on a name's
hover in the transcript's own editor window, kept above the pill by its
measured height, a click opening the file's own window — every read, the
selected one's rows, the lines covered, the jump to its turn — and no rail for
a session that read nothing; its pure half, which reads
`Read` calls and the shell commands that only read — refusing a command that
wrote, a construct it cannot follow and a span through a pipe — is
`context-files`) and
`background-shells-view` (the pill beside RUNNING for the commands Claude
left running in the background: it says the count and the minutes in words and
never the command, draws nothing when no CLI process runs the session, counts
only the shells the live process started — a resumed session's old ones died
with the process that exited — and reports the latest ending, then
lists each outcome, a row opening the shell's window over the session; it states the
command, the clock times, the exit code, how it reached the background, who
stopped it, and nothing the transcript does not hold) and
`exchange-thread` (the pure half of that page: which side a message is on,
where a run of one party's messages starts, the wall time the conversation
covers — and nothing rather than "0s" for a single message) and
`markdown-wikilinks` (the `[[wikilink]]` chips: a citation the project really
has is a button carrying the path it resolved to, one nothing answers to is
dashed and inert, the backticked form Claude writes just as often is caught too,
a fenced block keeps its brackets and asks nothing, a failed lookup does NOT
read as missing, a name that was missing is asked about again once the answer
could have changed while a name that was found never is, and outside a
`VaultLinksProvider` the text renders exactly as before — which is what keeps the memory views' own wikilinks from resolving
against the project tree) and
`chat-images` (a picture in the transcript, drawn twice over where it used to
be nothing: the `image` block of a pasted screenshot or of a `Read` of a
`.png` — a turn that is only a picture survives in both densities, the Read is
the picture in its editor window and never "empty file" — and an image linked
by path, `![seg](/private/tmp/…/seg.png)`, which the sandboxed renderer
resolved against its own origin and drew as a broken glyph: now read through
`images:read`, relative to the project root inside a chat only, and answered
with the picture, "file is gone" or the reason it was refused; the reader's
fences are `local-image`) and
`remote-view` (the Remote page of #242: a destination ssh would read as an
option is never saved, Connect asks for the host, the folder and the Claude Code
version this build requires and never starts a local terminal, the connected
frame says the session runs on the host, and a host the connect script refused —
an outdated CLI, a missing folder, a failed login — is named under a terminal
left uncovered, with the update it offers run on the host and then back to a
session) and
`remote-lens-view` (the Lens and Mission Control of a remote pane, #294: where
the reading stands until there is a transcript, ssh's question for a second
login asked in the Lens and answered there — over a transcript already on
screen too, as after a retry — the host's transcript drawn by the
real `ChatView` and `MissionRail` — and not one read of this machine's project
data meanwhile, since the host's folder is often the same path as a local one —
a path a message names left unread, no export, delete or playbook, and nothing
drawn that was pushed for another pane).
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
  Streams the whole corpus (~1.7s for 261 MB, 329 files — the `.jsonl`
  transcripts plus the `subagents/agent-*.meta.json` sidecars, folded in under a
  synthetic `agent-meta` row type) counting four discriminant axes —
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
- `npm run graph:probe` (`test/memory-graph-real.test.ts`) — the memory graph
  measured on every archive under `~/.claude/projects`, opt-in
  (`CLAUDELENS_MEMORY_CORPUS=1`) for the same reason: its outcome depends on
  what this machine happens to hold, so it is a probe, not a gate.

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
manifest, not in an issue tracker. Two of the three have since been read
(`advisor_tool_result` as the `advisor` marker, `image` as an `image` block and
as `images` on a tool result), and the manifest entry is what moved: a candidate
retired is a `read` verdict with the old finding kept in its comment.

`scripts/transcript-exercise.mjs` is the third stage and **opt-in** (`--yes`, and
refuses to start without it): it drives `claude -p` against prompts chosen to
provoke specific shapes, because the corpus only covers what this user happens to
do — a feature nobody exercised writes no rows, so the census can't tell "Claude
Code doesn't do this" from "we never tried". Real model turns, real tokens; never
part of a verify. It works in a throwaway temp dir, which the census skips by
name so synthetic rows never look like real usage. Note the gotcha it was written
around: Claude Code hashes the **resolved** cwd, so a macOS temp dir lands under
`-private-var-folders-…`, not `-var-folders-…`.

**When to run it:** after every Claude Code upgrade, and whenever a session
renders oddly and the format is a suspect. `npm run census` then
`npm run census:replay`; if the census reports something, write a verdict in the
manifest and `npm run census:accept` — without the verdict the same finding
returns identically every run.

`transcript-drift-watch` is the unattended entry point: it runs both
instruments, reports only what is new, may write `ignored`/`candidate`/`unknown`
triage, and never touches a reader. **Not enabled — deliberately.** Putting it on
`/loop` or `/schedule` is the recommended next step, but it stays a manual call
until someone decides to: it writes to the manifest and the baseline on its own,
and the first run showed why that wants a look before it becomes automatic —
`census:accept` retires a field finding permanently, so an unattended run that
misjudges one destroys the only evidence of it.

## Release

Before creating a GitHub Release, always run these steps **in order**:

1. `node scripts/prepare-release.js` — detects the locally installed Claude Code version and writes it into `claudeCodeVersion` in `package.json` (displayed in Settings → General → "Claude Code required"). It leaves `remoteMinClaudeCodeVersion` alone on purpose: that is the oldest CLI a Remote host may run, raised by hand only when the remote path needs something newer, so a release does not force `claude update` on every host. It also warns (never blocks) when `src/data/whats-new.ts` has no entry newer than the version currently in `package.json` — the reminder to do step 2 below, for a release that has something worth showing
2. If this release has a feature worth telling the user about, add an entry to `src/data/whats-new.ts` **keyed to the version you're about to bump to** (one entry per release with content; skip it for a fix-only release) — this is what the "What's new" popup (`src/components/WhatsNewDialog.tsx`) shows on first launch after the update. The popup also lists, folded, the entries of any release skipped since the one last dismissed (`releasesBetween`), and Settings → General → Updates reopens it on the newest entry with every earlier one below. English, one sentence per highlight (the UI is english-only — see `src/components/project/CLAUDE.md`), one or two highlights max, and the `visual` must be an actual ClaudeLens component (a key into `WhatsNewDialog.tsx`'s `VISUALS` map, e.g. the real `InboundMessage` from `MessageBubble.tsx`) rather than a screenshot, which goes stale the next time that surface's CSS changes
3. Bump the app `version` field in `package.json` (semver, e.g. `2.1.1` → `2.1.2`)
4. Commit both changes together (e.g., `chore: bump to v2.1.2, claude-code 2.1.191`)
5. Create the GitHub Release with a `## Highlights` section at the top

**A dependency bump can break packaging without CI noticing — that is what
`package-smoke` is for.** `npm run build` is tsc + Vite and says nothing about
whether the app can be PACKAGED: Electron 44 landed with electron-builder's
bundled `node-abi` unaware of its ABI, every platform job died on `Could not
detect abi for version 44.3.0`, and v2.2.20 was published with no binaries at
all — because nothing between the dependency PR and the tag ever invoked
electron-builder. The fix is an `overrides` pin on `node-abi` in `package.json`
(electron-builder ships a range that lags new Electron majors), and the guard is
the `package-smoke` job: `electron-builder --dir` resolves the ABI, packs the
asar and runs the entry-point check without spending the minutes an installer
costs. When an Electron major lands and packaging fails on the ABI, bump that
pin rather than reverting Electron.

**Binaries are built and attached by CI, not locally**: pushing the `v*` tag
(which `gh release create` does) triggers `.github/workflows/release.yml` — it
packages macOS DMG (x64 + arm64), Windows exe (windows-2022 runner) and Linux
AppImage on native runners (~9 min) and uploads all of them to the existing
Release without overwriting its notes. Don't run `npm run electron:build` or
attach assets by hand; just wait for the workflow and verify the assets landed
(`gh release view vX.Y.Z --json assets`). The same workflow rebuilds the binaries
of a tag that already has a Release, without touching the tag:
`gh workflow run release.yml -f tag=vX.Y.Z`.

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

- Registers IPC handlers grouped by namespace: `memory:*`, `cost:*`, `claudeMd:*`, `sessions:*` (incl. `sessions:sendMessage`/`sessions:stopMessage`/`sessions:endChat` — chat runs through the **Agent SDK** in **streaming input mode**: one long-lived `ChatSession` per chat view drives a single persistent `query()` whose `prompt` is a push-generator (`modules/chat-runner.ts`), so successive turns ride the same warm session instead of re-resuming each time. `sendMessage` pushes the message into the live session when its id matches (applying `setModel`/`setPermissionMode` first), else resumes the transcript into a fresh session; `startMessage` starts a _new_ session with a **pre-generated `sessionId`** (`crypto.randomUUID`), emitting `sessions:chatStarted` immediately (no race); `stopMessage` is a native `interrupt()` (ends the turn, keeps the session warm); `endChat` disposes the session when the view unmounts. Streams over `sessions:chatChunk` (text deltas) + `sessions:chatToolActivity` (live "using tool" indicator: tool-input generation start + `tool_progress` heartbeats) + `sessions:chatMessage` (each fully-formed assistant/tool-result message as the SDK emits it, so the renderer builds the live turn — tools included — straight from the stream, not from a mid-stream disk re-read) + `chatDone` (per-turn end, carrying the SDK's `ChatTurnSummary` — cost/tokens/model read from the `result`, so the live chat shows running metadata without touching disk) / `chatError`. **Every stream payload is an envelope tagged with the producing `sessionId`** (`Chat*Event` in `electron/shared/chat-types.ts` — the single type definition shared with the renderer, re-exported by `src/types.ts`; permission requests carry the id too), so the renderer's `useLiveChat` drops stale events from a superseded session instead of trusting arrival order. Tool approvals go through the SDK's `canUseTool`: a non-auto-approved tool fires `sessions:permissionRequest` → the renderer's Allow/Always/Deny dialog (requests are **queued** renderer-side — concurrent `canUseTool` calls, e.g. parallel read-only tools, are answered one at a time; `AskUserQuestion` gets a dedicated answer form returning `{ questions, answers }` in the allowed input) → `sessions:permissionResponse` resolves the SDK's pending `PermissionResult` (`pendingPermissions` Map; `stopMessage`/`endChat`/supersede deny all pending). One `ChatSession` in flight at a time; if the live query dies on its own (fatal stream error — not a deliberate dispose) the main emits a final `chatDone` so the composer doesn't stay stuck on "Stop"), `rules:*`, `tasks:*`, `plans:*`, `workflows:*`, `teams:*`, `agents:*`, `skills:*`, `plugins:*` (installed plugins + the skills/agents/commands, MCP servers and hooks each one adds — the Plugins page is an explorer, tree of marketplaces on the left and the selected plugin's index on the right, in `src/components/project/plugins/`), `mcp:*`, `projects:*` (`projects:detectDuplicates` — read-only, the merge was removed, see `modules/CLAUDE.md` — + `projects:planPurge`/`projects:purge`, the delete path — see `modules/project-purger.ts` — + `projects:getDescription`, the one-line project description derived from the project's CLAUDE.md, see `modules/project-description.ts`), `live:*` (Live views: `live:getActiveSessions` + `live:getSessions` for the registry and the background-agent roster, `live:getActivity` for the Monitor's per-session tail digest — see `modules/session-tails.ts`), `ai:*`, `export:*`, `markdownFile:*`, `settings:*`, `config:*` (effective config via Agent SDK), `telemetry:*` (anonymous usage telemetry — `telemetry:isEnabled`/`telemetry:setEnabled` opt-out toggle + `telemetry:track` for renderer-fired feature events), `updates:*` (`updates:check` — GitHub-releases update check, see `modules/update-checker.ts`), `search:*` (`search:conversations` — full-text search over the transcripts, see `modules/session-search.ts`), `exchange:*` (`exchange:get` — the conversation a message received from another session belongs to, both halves of every `SendMessage` between the two sessions joined on `msg_id` across every transcript on disk, see `modules/session-exchange.ts`, #280), `vault:*` (`vault:resolveLinks`/`vault:openFile` — the `[[wikilinks]]` a message cites, resolved against the project's own files so the chat can say whether a source Claude named is really there; the index stays in main and only the handful of names one message cites crosses IPC, see `modules/vault-index.ts`), `clipboard:*` (`clipboard:readText`/`writeText` via Electron's own `clipboard` module — the packaged renderer runs from `file://`, where `navigator.clipboard`'s read path needs a permission the app never grants; used only by the terminal pane's Windows/Linux copy-paste bindings), `remote:*` (`remote:listHosts`/`saveHost`/`deleteHost` — the ssh destinations the terminal pane can run Claude Code on, #242, kept in `~/.claudelens/remote-hosts.json` with no credential in them — plus `terminal:createRemote`, the same PTY and the same `terminal:data`/`write`/`resize`/`kill`/`exit` channels as `terminal:create`, with the system `ssh` as the process and a connect script that refuses a Claude Code older than `claudeCodeVersion` before it `exec`s the CLI; see `modules/remote-ssh.ts` — and `remote:getLensState`/`answerLens`/`retryLens` + the `remote:lensState` push, the Lens and Mission Control of the session a remote pane runs, #294: a second ssh channel riding the pane's `ControlMaster` socket reads the host's registry entry and transcript into memory, see `modules/remote-lens.ts`. **Additive and removable on purpose**: an upstream way to attach to a session on another machine — anthropics/claude-code#87190 — would retire it, so `terminal:create`, `chat-runner` and the readers are not rewired around a host)
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
- Chat message pre-processing: user messages that are only `tool_result` are absorbed into the preceding assistant message; `tool_use` is matched to `tool_result` by ID to form `ToolGroup[]`. An `advisor` consult (the harness's reviewer-model tool) is persisted as two rows of one assistant message — a `server_tool_use` and an `advisor_tool_result` whose payload is encrypted (`advisor_redacted_result`) — so it can never be rendered as content: `session-reader` folds the pair into a single `advisor` block carrying the reviewer model, its token spend (from the `advisor_message` entry of `usage.iterations`, omitted when one message holds two consults, since that usage object is repeated verbatim on every row) and the wall time between the two rows, and the renderer draws it as a slim stream marker rather than a turn

## Prompt Playbook (#282)

`chat/PromptPlaybook.tsx` is shared by the SDK `ChatComposer` and Terminal Mission
Control. Saved templates and dismissed-prompt fingerprints live in
`~/.claudelens/playbook/<projectHash>/playbook.json`, through `playbook:*` IPC
(a dev build — `npm run dev` — keeps every piece of ClaudeLens state under
`~/.claudelens-dev` instead, see `electron/modules/claudelens-dir.ts`).
Mission Control opens it inside the rail via a book icon in the header; the SDK
composer uses a popover. Closing the rail panel preserves activity filters and
scroll, and Escape only closes it while focus is within the panel.
Candidates are computed only when the panel opens (or its own mutations
invalidate it), never by the session watcher. The detector requires the same
whitespace-normalized human prompt in three distinct sessions; it preserves the
original text and excludes technical/agent traffic. `playbook-reader` uses both
transcript parsers so queued human messages count, with explicit partial-scan
reporting and bounded reads. The store serializes atomic mutations and refuses
to overwrite corrupted data.

Use appends to an SDK draft without sending; from Lens it reveals Terminal.
`terminal-prompt.ts` waits for the real xterm bracketed-paste mode before inserting,
rejects unsafe controls, and cancels on timeout, terminal exit, unmount or return
to Lens. `playbook.test.ts`, `prompt-playbook-view.test.tsx`,
`prompt-playbook-terminal.test.tsx` and `terminal-prompt*.test.*` cover the flows.
`CLAUDELENS_PLAYBOOK_CORPUS=1 npx vitest run test/playbook-real.test.ts` is an
opt-in read-only probe that prints aggregate counts only.

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

**Fixtures are synthetic.** The app reads whatever sits in a contributor's own
`~/.claude`, so nothing in the repo is copied from it: a fixture keeps the
_shape_ of a real row — same path depth, same extensions, same odd characters —
with names that stand for nothing, and comments name an archive as "Acme2.0".
The `PreToolUse` hook `.claude/hooks/guard-private-terms.sh` checks what a
commit, push, PR, issue or release adds against a word list kept **outside** the
repo (`~/.config/claudelens/private-terms.regex`, one extended regex per line,
never tracked; without it the hook is a no-op). `removeComments` in
`tsconfig.electron.json` keeps main-process comments out of the packaged asar.

**IPC result shape:** every handler returns `{ data: T | null, error: string | null }`. Renderer unwraps with `unwrap()` in `useIPC.ts`.

**Project identity:** data lives in `~/.claude/projects/{hash}/` where `hash` = absolute path with `/` → `-` (e.g. `/Users/foo/bar` → `-Users-foo-bar`). Conversion in `electron/utils.ts`.

**Memory format:** topic files use YAML frontmatter (`name`, `description`, `type`) + markdown body. `MEMORY.md` index lines: `- [filename.md](filename.md) — description`.

**Two tsconfigs:**

- `tsconfig.json` — renderer (ESNext modules, DOM types, JSX)
- `tsconfig.electron.json` — main + preload (CommonJS, no DOM)

**Build outputs:**

- `dist/` — Vite bundle (React SPA)
- `dist-electron/` — tsc output (main.js, preload.js, modules/)
