---
name: run-app
description: Launch and drive the ClaudeLens Electron app (mock data) via Playwright to verify UI changes or take screenshots.
---

Drive ClaudeLens either from the REPL (`driver.mjs`, for humans) or from a
script of the same commands (`run.mjs`, for agents). Both share one command
table in `app.mjs`, so a sequence worked out at the REPL pastes into a script
file unchanged. Default launch uses `SCREENSHOT_MODE` (mock fixtures from
`electron/screenshotFixtures.ts` — no real `~/.claude/` reads); `launch real`
uses real data.

## Setup (from repo root)

```bash
npx tsc -p tsconfig.electron.json          # build main/preload
npx vite --port 5173 &                     # renderer dev server
```

If the launch fails with `spawn …/Electron ENOENT`, npm skipped Electron's
postinstall: `node node_modules/electron/install.js`.

## Run

Interactive: `node .claude/skills/run-app/driver.mjs`

Scripted — **the path for agents**, no tty and no tmux needed:

```bash
node .claude/skills/run-app/run.mjs shots.txt      # or `-` to read stdin
```

Each command is awaited before the next, the run stops at the first failure
(exit 1, naming the command), and `quit` always runs, so no Electron process is
left behind. Do not pipe into `driver.mjs` instead: readline emits every piped
line at once and the async handlers interleave.

The README gallery has a ready script — see `readme-shots.txt`:

```bash
SCREENSHOT_DIR=/tmp/shots node .claude/skills/run-app/run.mjs \
  .claude/skills/run-app/readme-shots.txt
```

Screenshots land in `/tmp/claudelens-shots/` (override: `SCREENSHOT_DIR`).
**Always open and look at the screenshots** — a blank frame means launch failed.
Kill the Vite process when done.

## Commands

| command                      | effect                                                     |
| ---------------------------- | ---------------------------------------------------------- |
| `launch [real]`              | start app (mock data; `real` = real `~/.claude/`)          |
| `reset`                      | reload → back to the global home                           |
| `ss [name]`                  | screenshot → `$SCREENSHOT_DIR/<name>.png`                  |
| `click-text <text>`          | DOM-click button/link/card by text (exact, then substring) |
| `click <css>` / `wait <css>` | DOM-click / wait for selector                              |
| `text [css]`                 | print innerText (body if omitted)                          |
| `eval <js>`                  | evaluate in page, print JSON                               |
| `theme [light\|dark]`        | force `data-theme`                                         |
| `errors`                     | page errors seen since launch, with stacks                 |
| `sleep <ms>`                 | wait                                                       |
| `quit`                       | close app and exit                                         |

In a script, `#` comments and blank lines are skipped.

## Gotchas

- Clicks go through `page.evaluate(el.click())`, not coordinates — reliable
  with the app's custom chrome. Navigation is client-side state (no router):
  reach views by clicking like a user (e.g. `click-text webapp` →
  `click-text Teams` → `click-text Open team`).
- **There is no way back from a detail view** — a skill, a plan and the other
  detail pages hide the top bar. Use `reset` between views instead of trying to
  click home.
- **Match the DOM text, not what you see.** Labels like `Edit`, `Graph`, `List`
  are title-case in the markup and only uppercased by CSS, so `click-text EDIT`
  does not match.
- `theme` does not disturb navigation state: navigate once, then shoot both
  themes from the same view.
- The window needs ~2.5s after `domcontentloaded` (baked into `launch`);
  each click already waits ~1.2s.
- An error-boundary card ("Something went wrong") carries no stack — run
  `errors` to get it. A view that only the fixtures feed can crash because the
  fixtures drifted behind the type, not because the view is broken.
- On Linux add xvfb (`xvfb-run -a node …`); `--no-sandbox` is already applied.
