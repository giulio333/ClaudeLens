# Changelog

All notable changes to ClaudeLens are documented here.

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
