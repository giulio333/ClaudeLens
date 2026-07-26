# Contributing to ClaudeLens

Thanks for your interest in improving ClaudeLens! It's an Electron + React + TypeScript app that reads Claude Code's local data from `~/.claude/`. This guide covers everything you need to get a local environment running and land a change.

Participation in this project is covered by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- **Node 22** (CI runs on Node 22)
- **npm**
- **[Claude Code](https://claude.ai/code)** installed and used at least once, so that `~/.claude/` exists with real data to render.
- **An OS to develop on** — macOS is the primary target (packaging produces a `.dmg`); Linux (AppImage) and Windows (NSIS) are supported as experimental and are built by CI on every release.

## Local development

```bash
npm install
npm run dev      # Vite dev server + Electron in parallel
```

`npm run dev` runs Vite, the Electron TypeScript compiler in watch mode, and Electron itself once the dev server is ready.

## Useful scripts

| Script                   | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `npm run dev`            | Vite dev server + Electron in parallel                   |
| `npm run build`          | Compile the Electron main process (tsc) + Vite build     |
| `npm run typecheck`      | Type-check both tsconfigs (renderer + electron), no emit |
| `npm run lint`           | Run ESLint over the repo                                 |
| `npm run lint:fix`       | Run ESLint and auto-fix                                  |
| `npm run format`         | Format the repo with Prettier                            |
| `npm run format:check`   | Check Prettier formatting without writing                |
| `npm test`               | Run the Vitest suite once                                |
| `npm run test:watch`     | Run Vitest in watch mode                                 |
| `npm run electron:build` | Package a distributable macOS `.dmg`                     |

## Project structure

- `electron/` — Electron main process, preload, and backend modules (`electron/modules/`)
- `src/` — React renderer (single-page UI)

See [`CLAUDE.md`](CLAUDE.md) for the detailed architecture: IPC namespaces, the file watcher, backend module responsibilities, the IPC result shape, project identity hashing, and key conventions.

## Code style

- **ESLint + Prettier.** Run `npm run lint` before opening a PR (CI enforces it).
- The repo is **not** fully Prettier-clean yet, so `npm run format` would reformat hundreds of unrelated files. Format only what you touched: `npx prettier --write <your files>`.
- Keep functions small and use meaningful names.
- Add comments only for non-obvious logic.

## Testing

- **Vitest** drives the automated suite (`npm test`). Unit tests live under `test/` and cover the pure backend modules.
- When you add or change a pure module, add tests for it.
- There are **no automated UI tests** — validate UI changes manually with `npm run dev` against your real `~/.claude/` data.

## Reporting bugs and requesting features

- **Bugs** and **feature requests** go through the [issue templates](https://github.com/giulio333/ClaudeLens/issues/new/choose) — they ask for the ClaudeLens version, OS, and `claude --version`, which is what triage needs first.
- **Questions and rough ideas** belong in [Discussions](https://github.com/giulio333/ClaudeLens/discussions) rather than issues.
- **Security vulnerabilities** must never be filed publicly — see [SECURITY.md](SECURITY.md).

## Pull requests

Work happens on `main`. The [PR template](.github/pull_request_template.md) carries the checklist; before opening a PR, make sure locally:

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] UI changes validated manually via `npm run dev`

CI runs typecheck, lint, test, and build on every push and PR — it must be **green** before merge. A separate CI job spawns the real `claude` CLI through node-pty on Linux, macOS, and Windows to guard the embedded terminal.

**Commit and PR conventions:**

- Commit messages in **English**, using conventional-commit prefixes (`feat`, `fix`, `chore`, `ci`, `perf`, `docs`).
- Reference the related issue number in the PR subject, e.g. `(#27)`.

Repo: <https://github.com/giulio333/ClaudeLens>
