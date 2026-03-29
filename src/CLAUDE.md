# src/ — Renderer (React SPA)

This directory contains the Electron renderer process: a single-page React app that displays ClaudeLens UI.

## Architecture

**App.tsx** — Root component
- Sets up the outer layout (header + main)
- Calls `useDataChangedRefetch()` to invalidate all queries when `~/.claude/` changes
- Renders `<ProjectOverview />`

**ProjectOverview.tsx** (`tabs/ProjectOverview.tsx`) — Root navigation shell
- Manages all UI state in a single `View` discriminated union (no router)
- Views: `overview` | `global-claudemd` | `global-skills` | `skill-detail` | `global-agents` | `agent-detail` | `global-mcp` | `project-claudemd` | `project-memory` | `sessions` | `analytics` | `chat` | `memory-topic` | `ai-assistant` | `live-monitor`
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
- `project/shared/` — Atomic UI: `ModelChip`, `SectionTitle`, `BackButton`, `StatChip`, `Accordion`
- `project/chat/` — Chat rendering: `ChatView`, `MessageBubble`, `ToolDetailPanel`, `ToolGroupCard`, atoms, utils
- `project/sessions/` — `SessionsDetailView`
- `project/memory/` — `MemorySection`, `MemoryTopicView`, `MemoryIndexFile`, `TopicForm`, `MemoryFullView`, utils
- `project/claudemd/` — `GlobalClaudeMdView`
- `project/skills/` — `GlobalSkillsView`, `SkillDetailView`, `SkillPropertiesPanel`, `CreateSkillModal`
- `project/agents/` — `GlobalAgentsView`, `AgentDetailView`, `AgentPropertiesPanel`, `CreateAgentModal`
- `project/mcp/` — `GlobalMcpView`, `McpServerCard`
- `project/analytics/` — `AnalyticsView`
- `project/ai-assistant/` — `AiAssistantView`
- `project/overview/` — `ProjectOverviewContent`, `NavCard`

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
- **Styling:** Tailwind CSS; reuse zinc/indigo palette for consistency
- **Date/time:** Use `fmtDate()` for localized display (currently `it-IT`)

## Testing

No automated tests — validate against real `~/.claude/` data by running:
```bash
npm run dev
```

Then navigate the ClaudeLens UI, inspect DevTools (`Cmd+Shift+I`), and check that views render correctly.
