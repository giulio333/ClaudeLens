# CLAUDE.md

Guidance for Claude Code in this repository. The nested files load with their directory:
`src/CLAUDE.md`, `src/components/CLAUDE.md`, `src/components/project/CLAUDE.md`,
`electron/modules/CLAUDE.md`.

**Editing these files.** They are loaded into every session that touches their directory, so
every line has a cost. Keep a line only if an agent would make a concrete mistake without it: a
command, a rule, a gotcha. They are not a changelog and not a feature catalogue — the story of a
fix goes in its commit message, the reason behind a non-obvious line of code in a comment beside
it, and what a test proves in the test itself.

## Commands

`npm run dev` / `build` / `typecheck` / `lint` / `format` / `test` (all in `package.json`).

- `typecheck` covers three projects: renderer (`tsconfig.json`), main + preload
  (`tsconfig.electron.json`) and tests (`tsconfig.test.json`).
- The style gate is strict: Prettier is enforced repo-wide, Markdown included, and `lint` runs
  with `--max-warnings 0` — fix a new warning or add an inline `eslint-disable` with a reason.
- **Do not launch the app to verify a change** (neither `npm run dev` nor the `run-app` skill):
  it is unreliable in this setup. Verify with `typecheck` + `lint` + `test`, add a renderer test
  when a hook or stream state changes, and leave the visual check to the user.

## Tests

Vitest, under `test/`. CI (`.github/workflows/ci.yml`) runs format:check + typecheck + lint +
test + build on every push and PR.

- **Node 22 and 24 both**, because `engines` says `>=22`. A bound that describes an allocation is
  `Buffer.poolSize`, never a literal that happens to match it on one version (#258).
- **Test order is randomised** (`sequence.shuffle`): every `it` is an independent claim. Fixtures
  go in `beforeEach`, never in the test that happens to run first, and module-level state
  (`resetParseCache`, `resetSessionTails`, `resetSessionReadCache`, …) is reset there too.
  Reproduce a red run with the seed it prints: `npx vitest run --sequence.seed=<n>`.
- Prefer integration to mocks. `session-sdk-*` and `subagents-fork` run the real Agent SDK over
  files on disk (no model turn, no API key); the `remote-*` tests run the real connect script
  through every login shell the machine has, against a stub `claude` under a temp home.
- **Renderer tests** run in jsdom — opt in per file with a `// @vitest-environment jsdom`
  docblock; the default stays `node` — against the fake preload bridge
  `test/helpers/fake-electron-api.ts`: request methods are `vi.fn()`s returning the
  `{ data, error }` envelope, `on*` channels are `Channel`s a test emits on, and
  `Channel.listenerCount` catches a subscription that outlives its component. Extend the fake as
  tests reach further.
- **Mount inside `React.StrictMode`**, as `src/main.tsx` does. Testing Library's `render` does
  not, and a provider that broke on StrictMode's remount once shipped with all its tests green.
- Probes whose outcome depends on this machine's `~/.claude` are opt-in and never part of
  `npm test`: `npm run census:replay`, `npm run graph:probe`, and
  `CLAUDELENS_PLAYBOOK_CORPUS=1 npx vitest run test/playbook-real.test.ts`.

## Transcript format drift

Claude Code extends the transcript format without notice, and a new row type or content block
simply never shows up in the app (#245 and #246 sat unnoticed for months). Use the
`transcript-drift` skill **after every Claude Code upgrade** and whenever a session renders
oddly; it holds the procedure.

- `npm run census` — what we don't read: diffs the corpus's row types, subtypes, content blocks
  and key-paths against `scripts/transcript-manifest.mjs` and `scripts/transcript-baseline.json`.
  Exit 1 on drift.
- `npm run census:replay` — what we read wrong: a sweep for content blocks that
  `parseContentArray` drops.
- The manifest records **decisions**: every shape is `read` (naming the module), `ignored` (with
  the reason) or `candidate` (not read, and it should be). Write the verdict, then
  `npm run census:accept`. Without a verdict the finding returns on every run; with
  `census:accept` a field finding is retired for good.
- Only discriminant values are ever recorded — the corpus is the user's real work. A map keyed by
  data (file paths, model ids, question text) collapses to `{*}`.
- `scripts/transcript-exercise.mjs --yes` spends real model turns to provoke shapes; it is never
  part of a verify.
- The `transcript-drift-watch` agent is deliberately not scheduled: it writes the manifest and
  the baseline on its own, and `census:accept` destroys the evidence of a misjudged finding.

## Release

Before creating a GitHub Release, in order:

1. `node scripts/prepare-release.js` — writes the locally installed Claude Code version into
   `claudeCodeVersion` in `package.json`. It leaves `remoteMinClaudeCodeVersion` alone: that one
   is raised by hand, only when the Remote path needs a newer CLI. It warns when
   `src/data/whats-new.ts` has no entry newer than the current version.
2. If the release has a feature worth telling the user about, add one entry to
   `src/data/whats-new.ts` keyed to the version you are bumping to (skip it for a fix-only
   release): English, one or two highlights of one sentence each, and a `visual` that is a real
   ClaudeLens component — a key of `VISUALS` in `src/components/WhatsNewDialog.tsx` — never a
   screenshot.
3. Bump `version` in `package.json` (semver).
4. Commit both together, e.g. `chore: bump to v2.1.2, claude-code 2.1.191`.
5. Create the GitHub Release with a `## Highlights` section at the top.

- **Binaries are built by CI**: pushing the `v*` tag (which `gh release create` does) runs
  `.github/workflows/release.yml` — macOS x64 + arm64, Windows, Linux, about 9 minutes — and
  uploads them to the existing Release without touching its notes. Don't run
  `npm run electron:build` or attach assets by hand; check with
  `gh release view vX.Y.Z --json assets`. Rebuild an existing tag with
  `gh workflow run release.yml -f tag=vX.Y.Z`.
- **`package-smoke`** in CI (`electron-builder --dir`) is the only check that the app still
  packages. When a new Electron major breaks packaging on the ABI, bump the `node-abi` pin in
  `overrides` instead of reverting Electron.
- **macOS signing** (`docs/macos-signing.md`): Developer ID + notarization when the repo has the
  five Apple secrets, otherwise an **ad-hoc** signature under `com.claudelens.app` — never
  unsigned, because macOS files Local Network and the other privacy grants under the signing
  identifier. The app stays **unsandboxed**: it reads `~/.claude`, drives arbitrary project dirs
  and spawns `claude` through a pty. When a signed build ships, the quarantine workaround goes
  stale in README, `QUARANTINE_CMD` in Settings → General and `UpdateBanner.tsx`.

## Architecture

An Electron app that reads Claude Code's local data from `~/.claude/`.

**Main process** (`electron/main.ts`) registers the IPC handlers by namespace: `memory`, `cost`,
`claudeMd`, `sessions`, `rules`, `tasks`, `plans`, `workflows`, `teams`, `agents`, `skills`,
`plugins`, `mcp`, `projects`, `live`, `ai`, `export`, `markdownFile`, `settings`, `config`,
`prefs`, `telemetry`, `updates`, `search`, `exchange`, `files`, `images`, `vault`, `clipboard`,
`notifications`, `studio`, `playbook`, `terminal`, `remote`. The backend modules are described in
`electron/modules/CLAUDE.md`.

- **The chat runs on the Agent SDK in streaming input mode** (`modules/chat-runner.ts`): one
  long-lived `ChatSession` per chat view drives one `query()` fed by a push-generator, so turns
  ride the same warm session. `startMessage` pre-generates the session id, `stopMessage` is an
  `interrupt()` that keeps the session, `endChat` disposes it. One `ChatSession` is in flight at a
  time; if its query dies on its own, main still emits a final `chatDone` so the composer is not
  stuck on Stop.
- **Every chat stream payload is an envelope tagged with its `sessionId`** (`Chat*Event` in
  `electron/shared/chat-types.ts`, the one definition shared with the renderer): `useLiveChat`
  drops events from a superseded session instead of trusting arrival order.
- Tool approvals go through the SDK's `canUseTool` to a renderer dialog that queues concurrent
  requests and answers them one at a time; stop, end and supersede deny everything pending.
- `/btw` (`sessions:sideQuestion`) is answered by the live query only, and refused when the chat
  has no live session: a second process cannot read its prompt cache.
- **Watchers** (chokidar): `~/.claude/projects/` and the other data dirs are watched at
  **depth 5**, because workflow sub-agent transcripts sit at
  `{hash}/{sessionId}/subagents/workflows/<runId>/`. A change emits `data:changed` carrying the
  namespaces it can affect (`modules/data-change-scope.ts`; `null` means unknown and must
  invalidate everything). The live-session registry `~/.claude/sessions/` has its own channel,
  `live:activeSessions`, so its churn does not invalidate every query.
- **Remote** (`remote:*`, `terminal:createRemote`, #242/#294) is additive and removable on
  purpose: an upstream way to attach to a session on another machine would retire it, so
  `terminal:create`, `chat-runner` and the readers are not rewired around a host.
- `Map` is not transferable over IPC: serialize it to a plain object first.

**Preload** (`electron/preload.ts`) exposes `window.electronAPI` through `contextBridge` with
context isolation — the renderer's only seam to the main process.

**Renderer** (`src/`, see `src/CLAUDE.md`): one page, no router — `tabs/ProjectOverview.tsx`
switches on the `View` union in `components/project/types.ts`. Every React Query hook lives in
`hooks/useIPC.ts` (`unwrap()` throws on error), and `useDataChangedRefetch()` in `App.tsx`
invalidates only the namespaces a `data:changed` names.

## Conventions

- **IPC result shape**: every handler returns `{ data: T | null, error: string | null }`; the
  renderer unwraps it with `unwrap()`.
- **Project identity**: data lives in `~/.claude/projects/{hash}/`, where `hash` is the absolute
  path with every non-alphanumeric character → `-` (`/Users/foo/my.app` → `-Users-foo-my-app`;
  `encodeProjectHash` in `electron/utils.ts`). The inverse is a guess: read the real cwd with
  `resolveRealPath`. Claude Code hashes the _resolved_ path, so a macOS temp dir lands under
  `-private-var-folders-…`.
- **ClaudeLens's own state** (preferences, playbook, remote hosts) lives in `~/.claudelens/`,
  apart from `~/.claude` — `~/.claudelens-dev` in a dev build (`modules/claudelens-dir.ts`).
- **Memory format**: topic files are YAML frontmatter (`name`, `description`, `type`) plus a
  markdown body; `MEMORY.md` index lines are `- [file.md](file.md) — description`.
- **Fixtures are synthetic.** The app reads the contributor's own `~/.claude`, so nothing in the
  repo is copied from it: a fixture keeps a real row's shape (path depth, extensions, odd
  characters) with names that stand for nothing. The `PreToolUse` hook
  `.claude/hooks/guard-private-terms.sh` checks what a commit, push, PR, issue or release adds
  against a word list kept outside the repo (`~/.config/claudelens/private-terms.regex`; without
  it the hook is a no-op). `removeComments` in `tsconfig.electron.json` keeps main-process
  comments out of the packaged app.
- **Clipboard reads go through `clipboard:readText`**: the packaged renderer runs from `file://`,
  where `navigator.clipboard` can write but its read path needs a permission the app never grants.
- **The UI is English only.**
- **Build outputs**: `dist/` (Vite) and `dist-electron/` (tsc).

## Brand palette

| Role      | HEX       | Notes                                |
| --------- | --------- | ------------------------------------ |
| Accent    | `#C15F3C` | Terracotta — primary brand accent    |
| Paper     | `#FFFFFF` | Base canvas (light theme)            |
| Paper-2   | `#F4F3EE` | Warm off-white surface / cards       |
| Warm gray | `#B1ADA1` | Muted ink / dividers (reference hue) |

The only brand colours, encoded in `src/index.css` as `--cl-accent`, `--cl-paper`,
`--cl-paper-2` and the warm-gray hue, lifted in `[data-theme='dark']`. No new accent hues: vary
lightness and chroma on the same hue (40°). `--cl-ink-4` is darkened to ~`#7c7669` in the light
theme so meta text meets WCAG AA on white.
