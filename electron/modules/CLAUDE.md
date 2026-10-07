# electron/modules/ — main-process modules

Pure functions, except the writers (`memory-writer`, `agents-writer`, `skills-writer`,
`studio-writer`) and the stores. What each module does is in its code, its comments and its test
under `test/`; this file keeps the rules that span modules and the traps a reader would not guess.

## Reading Claude Code's files

- The format is undocumented and changes without notice. Read every field defensively: a missing or
  malformed key costs a zero or an empty value, never a throw or a `NaN` on screen. See "Transcript
  format drift" in the root `CLAUDE.md`.
- **Main-process I/O is async**, through `safe-fs.ts` (`readTextFile`). A sync read of a project
  path froze the whole app on an iCloud dataless file.
- **One enumerator of a project's transcripts**: `listProjectSessionFiles` in `session-files.ts`,
  which knows both layouts (`<hash>/sessions/*.jsonl` when present, else `<hash>/*.jsonl`) and is
  non-recursive. Never `**/*.jsonl`, which also matches the `subagents/` sidecars (#95).
- **The project folder name is lossy.** Claude Code folds every non-alphanumeric character to `-`
  (`encodeProjectHash` in `electron/utils.ts`), so `hashToPath` is a guess. The real cwd comes from
  `resolveRealPath`, which reads the transcript cwd that encodes back to the hash. A transcript is
  found by globbing its session id, never by deriving a folder from a cwd.
- **The Agent SDK read is not the file.**
  - Its `dir` hint must be the real cwd, not `~/.claude/projects/<hash>`: a wrong `dir` answers an
    empty array, so a scoped read that comes back empty retries unscoped (`canTrustEmptyScoped`
    skips that only on observed evidence).
  - `getSessionMessages` returns one `parentUuid` chain: a fork resolved the wrong way, or the
    history before a `/compact`, is missing. `withRowsTheSdkChainMissed` puts the rows back from
    the file.
  - It returns only the `message` of chat rows. Row fields (`effort`, `origin`), `toolUseResult`
    (`bashEditDiff`, `structuredPatch`, an `Artifact` publish, a `SendMessage` `msg_id`), `isMeta`
    rows (skill expansions, #246) and non-chat rows (`queue-operation` removes, #245) come from the
    second pass of `transcript-extras.ts` over the same file.
- **One parse decides what a message is**: `parseChatSessionText` + `parseTranscriptExtras`, shared
  by the transcript view, conversation search and the remote Lens. Two readers with different rules
  disagree in front of the user.
- Messages from other sessions (`origin`, #274): draw `origin.body`, never the row's `content`,
  which wraps the message in a preamble written for Claude. A `peer` sent by an agent of this
  session (`senderTaskId`) is not another session (`from: uds:…` + `verifiedPeerPid`): mixing them
  misstates the trust boundary. A `name` is a label; identity is the pid or the `msg_id`.
- **The live-session registry** (`~/.claude/sessions/<pid>.json`): `updatedAt` is not a heartbeat —
  the CLI rewrites the file on status transitions only. Stale entries are dropped by a pid probe
  plus a `ps` pid-reuse check, and `isClaudeCliCommand` judges the executable, never the word
  "claude" in a command line. `process-scanner` is the fallback only when the directory holds no
  files at all.
- `live-monitor` (#194): given a session id it attaches to that transcript or reports `pending`,
  never another session's file. Compare basenames: chokidar reports resolved paths (`/private/var`).
- Background jobs (`~/.claude/jobs`): `state` is an outcome name and latches; what a job is doing
  is `tempo`. The verdict lives in `src/components/project/agents-live/status.ts`.
- Teams: `teams/<name>/config.json` only enriches; the truth is the teammate transcripts and their
  `.meta.json`. `inboxes/` are transient queues, excluded from the watcher.

## Caches and tails

- The incremental caches (`cost-tracker`, `plans-reader`) key on mtime+size, read only the appended
  tail, keep a partial last line as a `Buffer`, and are keyed dir → file so each scan prunes what
  vanished. `StampCache` (`session-read-cache.ts`) fronts the SDK readers the same way; a `null`
  stamp disables caching for that call instead of guessing.
- `transcript-tail.ts`: bytes are assembled before decoding, a partial last line stays unconsumed,
  a file that shrank is re-read from 0. Claude Code repeats an assistant message's envelope —
  usage included — on every content-block line, so usage is deduped on `message.id`+`requestId`
  (#56). Sidechain lines never count toward the parent.
- The Monitor's digest (`session-tails.ts`) rides the projects watcher (no watcher of its own) and
  pushes a debounced digest, never an event stream. Context is a level, spend a total, and each
  turn is priced with its own model and timestamp. The spend seed also places the cursor: seed and
  offset are two halves of one statement. Context window sizes are a per-model list from Claude
  Code's catalog (`electron/shared/context-window.ts`), never a per-family rule.
- No full-text index, by design (`session-search`, `session-exchange`): a raw substring reject skips
  most files without parsing, and it must never produce a false negative (`prefilterNeedle`). Tool
  input and output are not searched.

## Pricing (`cost-tracker.ts`)

- Rates are copied from the official pricing page, never derived (cache reads are not always 0.1x
  input), and stamped in `PRICING_LAST_UPDATED`. The `new-claude-model` skill holds the procedure.
- The family fallback anchors on the current generation: an anchor on a retired model billed every
  Opus 4.5+ session 3x. `opus` stays on Opus 5 on purpose — the alias target and the dearer model,
  as the comment on `getPricing` says. A dated price change goes in `SCHEDULED` and is re-verified
  before its date: Sonnet 5's announced rise was called off.
- Cache writes: 1-hour writes at 2x input, read from the usage's `cache_creation` breakdown; a row
  with no breakdown falls back to the 5-minute rate (1.25x).

## Paths, writes and deletes

- **A path the renderer sends is checked against the projects registry**
  (`assertKnownProjectPath` / `createProjectRootGuard`, #256) before any containment check — never
  against `$HOME`, which refused projects under `/opt`, `/srv`, `/mnt` and a relocated
  `CLAUDE_CONFIG_DIR`. Containment is asserted after canonicalization (`containedPath`), so `..`
  or a symlink planted in the tree cannot reach outside.
- **A path read from a transcript is untrusted**: a `planFilePath` is confined to `~/.claude/plans`
  before it is even probed, and must be a regular file.
- A module that ships bytes to the renderer is fenced (`local-image.ts`): canonical path under known
  bases, type from the magic number and never the extension, SVG refused, size cap checked on the
  stat. `missing` and `refused` are different answers.
- Deletes verify each path after the attempt and report per path; only a verified outcome is
  success (`session-deleter`, `project-purger`).
- **Project purge is delegated to `claude project purge`**: never enumerate or rewrite
  `history.jsonl`/`.claude.json` here. Its unit is a path subtree, so `refusePurge` declines a plan
  with more than one `dir: …/projects/<hash>` row (never counted from `config:`) or one it cannot
  parse. The renderer passes a hash, never a path. On timeout the CLI is detached, not killed — a
  kill is a partial deletion — and the result is read from disk.
- **Duplicate projects are read-only, for good.** The merge (`projects:planMerge`/`executeMerge`)
  was removed: the match is a guess, and a wrong merge destroys real history. Do not bring it back.
- Our own stores (`remote-hosts-store`, `playbook-store`) write atomically and refuse a file that
  exists but does not parse rather than overwrite it.

## The chat and the CLI

- `chat-runner.ts`: the SDK's types come from the dynamic `import()` — no top-level `import type`,
  which the CommonJS build cannot resolve. Sub-agent traffic (`parent_tool_use_id`) is dropped from
  the live stream. A `<synthetic>` local-command output (`/context`, `/usage`) is never persisted,
  so the live chat keeps it in memory.
- Approvals (`chat-permissions.ts`, #292): with `suppressAlwaysAllowRule` the suggestions are not
  forwarded and an `always` answer is downgraded to once — the lock does not depend on the dialog.
- The installed CLI's version is `readInstalledClaudeVersion(env)`, which takes no executable on
  purpose: in a packaged app the resolver points at the bundled SDK binary. Unknown stays unknown.
- `claude-executable.ts` (#289) leaves a healthy SDK install alone and falls back to the user's
  `claude` (`claudeExtraDirs()` then PATH, the order `claudeEnv()` uses; on Windows `claude.exe`
  only).
- MCP servers: `claude mcp list` decides which exist (cached 60 s; it is volatile, and absence is
  not deletion). `claudeAiMcpEverConnected` in `~/.claude.json` is append-only and never drives the
  list; the SDK's `system/init` list is cwd-scoped and was rejected.
- Plugins synced from claude.ai: only the logged-in account's folder
  (`${organizationUuid}_${accountUuid}`, lowercased, from `oauthAccount`), each plugin's folder
  derived from the manifest. `.mcp.json` headers and env are never kept.
- Studio (`studio-*`): the workflow `.js` is the only source of truth. Dynamic `meta` stays
  source-only, compiled output is acorn-checked before writing, and a stale save is rejected.

## Telemetry (`telemetry.ts`)

- Event names and fixed props only — never `~/.claude` content. Opt-out means zero egress.
- POSTed with Node's `https`, not `@aptabase/electron`: `electron.net` makes Chromium open its
  cookie store, which asks for the macOS Keychain at launch.
- Errors: `uncaughtExceptionMonitor` (observes without swallowing), and deliberately no
  `unhandledRejection` listener, which would make rejections non-fatal. Every message and stack
  goes through `electron/shared/error-redact.ts` first — that scrubber is the load-bearing part. A
  `403` (quota) latches reporting off for the run.

## Remote (#242, #294)

- The system `ssh`, never a JS client: ClaudeLens holds no credential, and the version gate runs in
  the remote script so there is one login.
- Quoting is the security argument, and it is checked: the POSIX script carries no `'`, backslash,
  `!` or newline (`buildRemoteScript` throws), the folder passes `remoteDirProblem`, and a
  destination that parses as an ssh option is refused. Windows gets `-EncodedCommand`.
- Win32-OpenSSH reports every exit as 0 under a tty, so the Windows script also writes the code as
  a private OSC marker that the main reads back.
- The remote Lens never guesses which session it reads: the launch marker names the pid, and only
  that process or one descending from it is attached. Rows stay in memory, never on disk. Its
  cursor is a copy of `readAppend`, so the local path stays untouched.
- Not verified yet: teardown on a Linux/macOS host.
