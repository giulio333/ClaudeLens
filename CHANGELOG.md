# Changelog

All notable changes to ClaudeLens are documented here. Each entry condenses the
corresponding [GitHub Release](https://github.com/giulio333/ClaudeLens/releases),
where the full notes, the per-PR list, and the downloadable builds live.

## [2.2.0] - 2026-07-10

### Added

- Workflows section — inspect multi-agent workflow runs (phases, per-agent rows, prompt/result previews) (#142)
- Richer Teams experience — conversation timeline, per-member metrics, token distribution, plus a project-wide TEAMS island in Mission Control (#142)
- Startup update check against GitHub releases, with a passive update notice, per-version skip, and a "Check now" button in Settings → General (#125)

### Changed

- Chat and terminal views moved to the glass-island visual language (#139)

### Fixed

- No more freezes on iCloud-synced projects: a dataless (evicted) file could stall a synchronous read: config/skill/agent/CLAUDE.md reads are now async with a timeout (#145)
- Teams: order-independent `<teammate-message>` attribute parsing, consistent member spawn ordering, member→member message dedup, transient `inboxes/` excluded from the watcher (#146)
- Workflows: run script resolved from the launching session, correct 0/1-based phase index detection, per-agent result preview (#147)
- Chat export fidelity for command/notification turns, fenced blank lines, and fence collisions (#126)
- Hardened `claude` CLI invocations against argument injection (#129)
- Windows glob/spawn fixes and watcher depth correction (#133); session-rename collisions in duplicate merge (#128)
- `updateTopic` refuses a missing topic instead of creating a stray file (#138); NaN-safe sorting and invalid-date guards (#135, #136, #137)

### Compatibility

- Validated against Claude Code 2.1.206

## [2.1.5] - 2026-07-02

### Added

- The Chat action on a session row opens the live Agent SDK chat directly; the view locks and follows the on-disk transcript while the session is live in the terminal
- Reading typography for chat — assistant prose in Inter, 75ch measure, 880px column

### Changed

- Refined chat export — radio preset list, syntax-highlighted PDF code blocks, empty turns skipped, PDF printing waits for fonts

### Fixed

- Live Monitor liveness no longer gated on `updatedAt` staleness (it is not a heartbeat), with a new pid-reuse guard for stale registry entries

## [2.1.4] - 2026-07-02

### Changed

- Skills and agents share a single frontmatter field registry (#122)
- Architecture improvements to the in-app SDK chat internals (#123)

### Fixed

- Needs-attention notifications are deduplicated, so one session no longer triggers repeated alerts (#124)
- Skill/agent editing, and hardened memory-writer path guards (#122)

## [2.1.3] - 2026-06-30

### Added

- Session-lifecycle notifications (MVP) — `needs-attention` / `completed` / `error` events for both registry sessions and the in-app chat, as toasts and, when the window is unfocused, native OS notifications with a dock badge
- Live sub-agent run status in the Mission Control rail
- Skill files explorer — browse the files behind a skill in a dedicated bundle view
- Memory topics grouped and sorted by creation date on the project overview

### Changed

- Settings redesigned as a compact instrument readout; Appearance folded into General

## [2.1.2] - 2026-06-25

### Added

- Agent View sessions open in the embedded terminal — live background agents via `claude attach`, stopped ones via `--resume`; background-agent sessions pushed over a dedicated `live:bgSessions` channel
- Task-notification cards in the transcript, with token / tool-call / duration chips
- `claudeCodeVersion` recorded per release and surfaced in Settings

### Changed

- Unified detail layout for memories, skills, agents, and CLAUDE.md

## [2.1.1] - 2026-06-24

### Added

- Anonymous, opt-out usage telemetry via Aptabase (EU) — launch/exit, sections opened, and a few feature actions; never sessions, prompts, files, paths, or identity
- Settings → Privacy panel with a one-click opt-out, plus [PRIVACY.md](PRIVACY.md)

## [2.1.0] - 2026-06-23

### Added

- Persistent, multi-color text highlights in the Lens chat view, disk-backed per session, painted with the CSS Custom Highlight API
- Highlights carried into Markdown and PDF/HTML exports as `<mark>`

### Changed

- Export HTML unified onto the same react-markdown engine as the live view, with native MathML for math
- Exports no longer contain the absolute project path
- Trimmed white borders from the app icons; added a transparent-background Windows variant

### Fixed

- Selections spanning multiple paragraphs and KaTeX formulas; robust selection-offset measurement; overlapping highlights no longer dropped in export

## [2.0.7] - 2026-06-23

### Fixed

- Sessions list no longer re-renders every row on each background refresh (rows memoized); the full list mounts the first 60 rows behind a "Show more" control

## [2.0.6] - 2026-06-22

### Fixed

- Session transcripts are cached and parsed incrementally instead of being re-read on every `~/.claude/` change (~61× faster on an unchanged refetch); reads moved off the synchronous path

## [2.0.5] - 2026-06-21

### Added

- "Outline + Focus" chat layout — a navigable index of prompts, skills, sub-agent dispatches, and per-file edit runs, collapsible and remembered

### Changed

- Terminal/Lens switch redesigned as a centered tab switch

### Fixed

- Frontmatter scalars are YAML-escaped, so values containing colons survive a read (#111)
- Markdown memoized to skip re-highlighting on unrelated re-renders (#112)

## [2.0.4] - 2026-06-18

### Changed

- Terminal/Lens top bar shows `Project / <session title>` instead of a bare `TERMINAL`
- Mission Control diff bars are always on (the `BARS` toggle is gone)
- Polish for "copy turn as markdown" and code-block rendering

## [2.0.3] - 2026-06-17

### Fixed

- Windows: the embedded terminal launches `claude` through the `cmd.exe` shim instead of failing with "File not found" (#110)
- The Lens transcript no longer blanks when the live-session registry flaps mid-turn (session id latched for the pane's lifetime)
- Mission Control keeps the last good chat/sub-agent data instead of flashing empty on a mid-write read

## [2.0.2] - 2026-06-17

### Added

- Plugins section — plugins installed under `~/.claude/plugins/`, grouped by marketplace, with the skills, agents, and commands each provides
- Read-only detail views for plugin-provided components; live refresh on install/update/remove

## [2.0.1] - 2026-06-15

### Fixed

- Filesystem boundaries: agent/skill writes and plan reads confined to their trusted roots, path guards resolve symlinks, `markdownFile:*` scoped to `~/.claude` or a project's `.claude/agents|skills`
- Project costs priced per session at each session's own model instead of one dominant rate; non-numeric usage fields can no longer corrupt totals
- CRLF-authored frontmatter (CLAUDE.md, SKILL.md, agents, memory) keeps its fields on Windows
- Live monitor ages out stale registry entries, honors `CLAUDE_CONFIG_DIR`, and no longer leaks watchers on concurrent starts
- Watcher refetch debounced; a single malformed `~/.claude.json` entry no longer blanks the MCP panel

## [2.0.0] - 2026-06-14

### Added

- In-app chat through the official Agent SDK — start a new session or continue an existing one, with live streaming and interactive tool approvals (Allow / Always / Deny), persisted to the same `.jsonl` transcript the CLI uses
- Embedded terminal running the interactive `claude` CLI in a real PTY
- Explicit billing channel on every chat entry point (Agent SDK credit vs. subscription usage)
- Cache savings and per-message context usage in the cost views
- Live session monitor backed by the native session registry, tailing the transcript in real time

### Fixed

- Cache-only turns are no longer dropped from cost totals; streaming chat subscribes once and cleans up so chunks and approvals aren't lost mid-turn; the live monitor recovers from a truncated transcript

## [1.6.8] - 2026-06-08

### Fixed

- `markdownFile:write/delete` confined to `~/.claude` (#106)
- `tool_result` array element types guarded so messages aren't silently dropped (#102); only known framing tags stripped, preserving code blocks and generics (#103)
- Plain `/word ...` user messages are no longer rendered as slash commands (#104)
- Readers scan only top-level session `.jsonl` files, skipping sub-agent transcripts (#105); analytics surface query errors instead of failing silently (#107)

## [1.6.7] - 2026-06-07

### Added

- Focus chat layout — centred reading column, floating glass control pill, hairline right-edge minimap
- Sub-agent dock — sub-agents collapse into an avatar cluster tinted with each agent's identity color
- Memory tags, with inline tag chips, a picker, and TagBar management
- Persistent preferences in `~/.claudelens/preferences.json` (pins, tags, theme) instead of `localStorage`

## [1.6.6] - 2026-06-06

### Added

- Delete a session and its on-disk artifacts, with a confirmation dialog enumerating the transcript, `subagents/` sidecar, tasks directory, and referenced plan files; any path outside `~/.claude` is refused
- Rename and delete session tags from the TagBar
- Theme control in Settings → Appearance; autocomplete and inline descriptions in the tools editor

### Fixed

- Chat auto-scroll follows streaming messages without fighting your scroll position
- Entity writers guarded against path traversal and resume commands against injection
- Cost usage deduplication (#56) and the graph timeline `RangeError` (#62)

## [1.6.5] - 2026-06-04

### Added

- Agent rail in the session chat — every sub-agent that ran, with type, status, time span and step count, opening its full internal transcript

### Fixed

- Windows: "Open in terminal" uses `start /d` so the session opens in the right working directory

## [1.6.4] - 2026-06-03

### Added

- Settings view (experimental) backed by the Agent SDK — the effective config cascade with per-key provenance plus runtime info, and a project-scoped Config subtab
- Plan-mode milestones as dedicated plan cards with a "Plan" filter
- Memory origin tracking — `type` and `originSessionId` read from frontmatter, linking back to the originating session
- Pinned sessions section in the Sessions tab
- `CLAUDE_CONFIG_DIR` support, falling back to `~/.claude`

### Fixed

- Parallel and sub-agent tool calls no longer render "No result available"

## [1.6.3] - 2026-06-03

### Fixed

- Multi-line names/descriptions no longer corrupt topic frontmatter or the `MEMORY.md` index; colliding topic names get unique filenames (#61)
- Chat minimal-mode polish (fisheye rail, collapsed tool-only turns, hidden empty filter pills) and a smoother header transition
- Unknown `<command-name>` frames fall back to a generic description instead of leaking raw XML

## [1.6.2] - 2026-06-02

### Added

- LaTeX math rendering via KaTeX everywhere markdown is displayed, in both themes

## [1.6.1] - 2026-06-02

### Added

- Redesigned transcript view — turn minimap, model bar, per-type message filters
- Automated release pipeline: pushing a `v*` tag builds macOS/Linux/Windows (x64 + arm64) and publishes the Release with the binaries attached

### Fixed

- Windows: native menu bar hidden, cross-platform project-name derivation, path compatibility for memory and project names (#55)
- React hydration warning from nested buttons in project/session rows

## [1.6.0] - 2026-05-30

### Added

- Experimental Linux (AppImage) and Windows (NSIS) support (#48, #51), in x64 and arm64 builds
- Cross-platform CI: every push type-checks, tests, and packages on macOS, Linux, and Windows

## [1.5.0] - 2026-05-29

### Added

- Redesigned Plans subtab — plans grouped per session, status filter chips with live counts, search, sort, expandable rows
- Inline plan editing: view/edit the markdown, then save or delete, written to `~/.claude/plans` and reflected via the file watcher

## [1.4.0] - 2026-05-27

### Added

- Pin sessions per project, with a dedicated "Pinned sessions" section
- Per-project session tags with inline hashtag rendering, a filter bar, and an inline picker
- Pin button on session rows in the search lens

### Changed

- "Chats" tab renamed to "Sessions"; entity rows use the single-line project-row layout
- Removed the per-row cost estimate to reduce visual noise

## [1.3.0] - 2026-05-25

### Added

- Live Agents subtab — background agent dispatch with model selection, stop/respawn/attach controls, inline property editor
- Duplicate project detection and merge
- Project pinning with search lens UI, unified search and project picker
- Project-scoped agents with frontmatter validation, scope badges, enhanced creation flow
- Chat export to PDF and Markdown; experimental swimlane timeline view
- Pagination and sorting for MCP servers
- AI-generated or first-message session titles instead of `hash.jsonl`

### Changed

- New color scheme and app icons; topbar unified across pages

## [1.2.0] - 2026-05-22

### Added

- Agents Live view — background agent sessions reader with a live agent badge
- MCP server detail view — brand hero, adoption metrics, local config, and enabled/disabled project lists; reachable by clicking a server in the MCP list

### Changed

- Complete UI redesign with a new editorial design system (broadsheet-style session/chat views, redesigned GlobalHomeView with stats, sparklines, and project cost listing)
- Aligned border-radius and colors to the editorial design system

### Fixed

- Memory topic content no longer shows "No content yet" — lookup now keys on filename instead of the (divergent) MEMORY.md link text
- Corrected CSS font tokens and locale in chat/sessions views

## [1.1.0] - 2026-03-30

### Added

- "Open in Claude Code" button on the project overview header (#3)
- Delete action and inline edit moved into the memory topic detail view (#5)
- Docs links and field hints in the skill/agent creation modals (#4)

### Fixed

- build-dmg script path resolution
- README cleanup for release (sections, intro, screenshots, releases URL)

## [1.0.0] - 2026-03-29

### Added

**Core views**

- Project overview with sessions, memory, cost tracking, and CLAUDE.md hierarchy
- Full chat session viewer with markdown rendering, collapsible thinking blocks, and tool detail panels
- Memory CRUD interface — create, edit, delete topics with YAML frontmatter sync
- Analytics view with token usage bar charts, model distribution pie, and session size buckets
- CLAUDE.md hierarchy viewer (global → project → local → subdir) with accordion layers
- Conditional rules viewer (`.claude/rules/**/*.md`) with path applicability

**Skills & Agents**

- Global and per-project skills viewer with detail panel
- Global and per-project agents viewer with detail panel
- Create skill and create agent modals (global scope)

**MCP**

- MCP server configuration viewer (cloud and local servers)
- Per-project disabled state display

**Live features**

- Live Monitor — real-time view of active Claude processes with activity chart, tool frequency, and status badge
- Real-time file watcher (chokidar) — auto-refreshes the UI when `~/.claude/` changes

**AI Assistant (experimental)**

- Runs `claude -p` in the project context with streaming output
- Preset actions: memory analysis, CLAUDE.md suggestions

**Navigation & UX**

- Sidebar with global section and per-project navigation
- Single-page navigation shell with discriminated union state (no router)
- Terminal integration — open sessions or start new ones in Terminal via AppleScript
