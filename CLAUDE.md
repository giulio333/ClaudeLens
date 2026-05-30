# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands (run from repo root)

```bash
npm run dev             # Vite dev server + Electron in parallel
npm run build           # tsc (electron) + vite build (renderer)
npm run electron:build  # Package distributable DMG (macOS)
npm run typecheck       # tsc --noEmit on both configs (renderer + electron)
npm run lint            # ESLint (flat config); lint:fix to autofix
npm run format          # Prettier write; format:check to verify
npm test                # Vitest (unit tests for pure modules)
```

Unit tests (Vitest) live under `test/` and cover the pure parsing modules —
`cost-tracker`, `memory-reader`/`memory-writer`, `session-reader`, and the chat
`utils`. UI/IPC behavior still needs manual validation against real `~/.claude/`
data via `npm run dev`. CI (`.github/workflows/ci.yml`) runs typecheck + lint +
test + build on every push/PR.

## Architecture

ClaudeLens is an Electron app that reads Claude Code's local data from `~/.claude/`.

**Main process** (`electron/main.ts`):
- Registers IPC handlers grouped by namespace: `memory:*`, `cost:*`, `claudeMd:*`, `sessions:*`, `rules:*`, `tasks:*`, `plans:*`
- Watches `~/.claude/projects/`, `~/.claude/tasks/` and `~/.claude/plans/` with chokidar (depth 3); emits `data:changed` to renderer on any change
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
- `tasks-reader.ts` — reads tasks Claude creates during sessions from `~/.claude/tasks/{sessionUUID}/*.json`; maps each session UUID (the project's `.jsonl` filename) back to the project and groups tasks per session
- `plans-reader.ts` — reads plan-mode plans: scans the project's session `.jsonl` for `plan_mode`/`plan_mode_exit` attachments (carrying `planFilePath`), dedupes per file (approved > proposed), then reads the markdown from the global `~/.claude/plans/*.md`; groups per session, flags missing files as deleted

**Renderer** (`src/`):
- Single page, no routing — `ProjectOverview.tsx` manages all views with internal navigation state (`overview` | `sessions` | `chat` | `memory-topic`)
- `useIPC.ts` — all React Query hooks + `window.electronAPI` type declarations; `unwrap()` raises on error
- Mutations (`useCreateTopic`, `useUpdateTopic`, `useDeleteTopic`) invalidate `['memory:project', hash]` on success
- `useDataChangedRefetch()` in `App.tsx` invalidates all queries when the watcher fires
- Chat message pre-processing: user messages that are only `tool_result` are absorbed into the preceding assistant message; `tool_use` is matched to `tool_result` by ID to form `ToolGroup[]`

## Brand palette (Claude Code official)

| Token role     | HEX       | Notes                                   |
|----------------|-----------|-----------------------------------------|
| Accent         | `#C15F3C` | Terracotta — primary brand accent       |
| Paper          | `#FFFFFF` | Base canvas (light theme)               |
| Paper-2        | `#F4F3EE` | Warm off-white surface / cards          |
| Warm gray      | `#B1ADA1` | Muted ink / dividers (`--cl-ink-4`)     |

These are the only brand colors. They're encoded in `src/index.css` as
`--cl-accent`, `--cl-paper`, `--cl-paper-2`, `--cl-ink-4` (light) and
lifted to higher lightness in `[data-theme='dark']`. Do not introduce new
hues for accents — extend by varying lightness/chroma on the same hue (40°).

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
