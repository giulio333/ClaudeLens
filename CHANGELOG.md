# Changelog

All notable changes to ClaudeLens are documented here.

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
