# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands (run from repo root)

```bash
npm run dev             # Vite dev server + Electron in parallel
npm run build           # tsc (electron) + vite build (renderer)
npm run electron:build  # Package distributable DMG (macOS)
```

No automated tests — validate against real `~/.claude/` data.

## Architecture

ClaudeLens is an Electron app that reads Claude Code's local data from `~/.claude/`.

**Main process** (`electron/main.ts`):
- Registers IPC handlers grouped by namespace: `memory:*`, `cost:*`, `claudeMd:*`, `sessions:*`, `rules:*`
- Watches `~/.claude/projects/` with chokidar (depth 3); emits `data:changed` to renderer on any change
- Serializes `Map` → plain object before IPC (Maps are not transferable)

**Preload** (`electron/preload.ts`):
- Exposes `window.electronAPI` via `contextBridge` with context isolation
- `onDataChanged(callback)` lets the renderer subscribe to file watcher events

**Backend modules** (`electron/modules/`) — pure functions except `memory-writer.ts`:
- `memory-reader.ts` — parses `MEMORY.md` index and topic `.md` files; infers topic type from filename prefix (`feedback_`, `project_`, `reference_`; default `user`)
- `memory-writer.ts` — creates/updates/deletes topic files, keeps `MEMORY.md` in sync; normalizes accented chars in filenames
- `cost-tracker.ts` — parses `.jsonl` session files; hardcoded pricing table per model with fuzzy fallback to Sonnet
- `claude-md-reader.ts` — reads CLAUDE.md hierarchy: global → project → local (`CLAUDE.local.md`) → subdir (`.claude/CLAUDE.md`)
- `rules-reader.ts` — reads conditional rules from `.claude/rules/**/*.md`; extracts `paths` from YAML frontmatter
- `session-reader.ts` — parses JSONL chat sessions; skips meta/sidechain lines; normalizes content (string or block array)

**Renderer** (`src/`):
- Single page, no routing — `ProjectOverview.tsx` manages all views with internal navigation state (`overview` | `sessions` | `chat` | `memory-topic`)
- `useIPC.ts` — all React Query hooks + `window.electronAPI` type declarations; `unwrap()` raises on error
- Mutations (`useCreateTopic`, `useUpdateTopic`, `useDeleteTopic`) invalidate `['memory:project', hash]` on success
- `useDataChangedRefetch()` in `App.tsx` invalidates all queries when the watcher fires
- Chat message pre-processing: user messages that are only `tool_result` are absorbed into the preceding assistant message; `tool_use` is matched to `tool_result` by ID to form `ToolGroup[]`

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
