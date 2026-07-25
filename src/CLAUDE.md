# src/ — Renderer (React SPA)

This directory contains the Electron renderer process: a single-page React app that displays ClaudeLens UI.

## Architecture

**App.tsx** — Root component
- Sets up the outer layout (header + main)
- Calls `useDataChangedRefetch()` to invalidate the queries affected by a `~/.claude/` change (the watcher event carries the changed path's category — see `electron/shared/data-change.ts`)
- Renders `<ProjectOverview />`

**ProjectOverview.tsx** (`tabs/ProjectOverview.tsx`) — Root navigation shell
- Manages all UI state in a single `View` discriminated union (no router)
- Views (~30 cases, see `components/project/types.ts`): `global-home` | `overview` | `global-claudemd` | `global-skills` | `skill-detail` | `skill-create` | `global-agents` | `agent-detail` | `agent-create` | `global-mcp` | `mcp-detail` | `studio` | `studio-create` | `studio-blueprint` | `project-skills` | `project-agents` | `project-mcp` | `project-tasks` | `project-plans` | `plan-detail` | `project-workflows` | `workflow-detail` | `project-teams` | `team-detail` | `project-claudemd` | `project-memory` | `sessions` | `analytics` | `chat` | `memory-topic` | `ai-assistant` | `live-monitor` | `agents-live` | `duplicates` | `settings` | `project-config`
- Thin shell (~340 righe): sidebar + `switch(view.type)` → delegates to feature components
- All feature components live in `components/project/`

**Hooks** (`hooks/useIPC.ts`)
- React Query hooks wrapping IPC calls to the main process
- All results follow `{ data: T | null, error: string | null }` shape
- `unwrap()` helper raises on error
- Mutations (`useCreateTopic`, `useUpdateTopic`, `useDeleteTopic`) invalidate `['memory:project', hash]` cache on success
- Types: `MemoryTopic`, `MemoryProject`, `SessionSummary`, `ClaudeMdLayer`, `RuleFile`, etc.

**Components** (`components/`)
- `Markdown.tsx` — Renders markdown with syntax highlighting
- `project/types.ts` — `View` union type + `TYPE_STYLES` / `SCOPE_STYLES` design tokens
- `project/utils.ts` — Pure formatters: `fmt`, `fmtCost`, `fmtDate`, `fmtModel`, `modelColor`
- `project/shared/` — Atomic UI: `BackButton`, `StatChip`, `TopBar`, `CreateFormKit` (shared building blocks for create pages)
- `project/chat/` — Chat rendering: `ChatView`, `MessageBubble`, `ToolDetailPanel`, `ToolGroupCard`, atoms, utils
- `project/memory/` — `MemoryTopicView`, utils
- `project/claudemd/` — `GlobalClaudeMdView`, `ProjectClaudeMdView`
- `project/skills/` — `GlobalSkillsView`, `SkillDetailView`, `CreateSkillPage`
- `project/agents/` — `GlobalAgentsView`, `AgentDetailView`, `RunAgentDialog`, `CreateAgentPage`
- `project/agents-live/` — `AgentsLiveView` (background/live agent sessions)
- `project/mcp/` — `GlobalMcpView`, `McpServerCard`, `McpServerDetailView`
- `project/analytics/` — `AnalyticsView`
- `project/ai-assistant/` — `AiAssistantView`
- `project/sessions/` — `TagBar`, `TagChip`, `TagPicker` (session tagging)
- `project/tasks/` — `TasksSection`
- `project/plans/` — `PlansSection`, `PlanDetailView`
- `project/teams/` — `TeamsSection`, `TeamDetailView` (agent teams)
- `project/overview/` — `ProjectOverviewContent`, `GlobalHomeView`, `Lens`, `ProjectSubtabs`, `DuplicateProjectsNotice`

## When adding a new view

1. Add a new case to the `View` type in `components/project/types.ts`
2. Add a new hook to `useIPC.ts` if data fetching is needed
3. Create a new component in the appropriate `components/project/<domain>/` folder
4. Add the `case` to the `switch(view.type)` in `tabs/ProjectOverview.tsx`
5. Update navigation handlers to call `onNavigate({ type: '...' })`

## Conventions

- **Navigation state:** Keep it in one `useState` in `ProjectOverview`; pass callbacks to child components
- **Data fetching:** Always use hooks from `useIPC.ts`; React Query caches automatically
- **Error handling:** Use `unwrap()` or check `error` field; show user-friendly messages
- **Styling:** Tailwind CSS + the `--cl-*` brand tokens / `cl-*` classes in `index.css` (terracotta accent `#C15F3C`); do not introduce new accent hues — see root `CLAUDE.md`
- **Date/time:** Use `fmtDate()` for localized display (currently `it-IT`); `fmt()` uses `en-US` thousands separators

## Testing

Pure modules are covered by Vitest unit tests under `test/` (run `npm test`).
UI/IPC behavior has no automated tests — validate against real `~/.claude/`
data by running:
```bash
npm run dev
```

Then navigate the ClaudeLens UI, inspect DevTools (`Cmd+Shift+I`), and check that views render correctly.
