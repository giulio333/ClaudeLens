---
name: run-app
description: Launch and drive the ClaudeLens Electron app (mock data) via a Playwright REPL to verify UI changes or take screenshots.
---

Drive ClaudeLens with the REPL at `.claude/skills/run-app/driver.mjs`.
Default launch uses `SCREENSHOT_MODE` (mock fixtures from
`electron/screenshotFixtures.ts` — no real `~/.claude/` reads); `launch real`
uses real data.

## Setup (from repo root)

```bash
npx tsc -p tsconfig.electron.json          # build main/preload
npx vite --port 5173 &                     # renderer dev server
```

## Run

Interactive: `node .claude/skills/run-app/driver.mjs`

For agents, wrap in tmux and poll the prompt:

```bash
tmux new-session -d -s cl -x 200 -y 50
tmux send-keys -t cl 'cd <repo> && node .claude/skills/run-app/driver.mjs' Enter
timeout 20 bash -c 'until tmux capture-pane -t cl -p | grep -q "driver>"; do sleep 0.2; done'
tmux send-keys -t cl 'launch' Enter
timeout 60 bash -c 'until tmux capture-pane -t cl -p | grep -q "launched:"; do sleep 0.2; done'
tmux send-keys -t cl 'ss home' Enter
```

Screenshots land in `/tmp/claudelens-shots/` (override: `SCREENSHOT_DIR`).
**Always open and look at the screenshots** — a blank frame means launch failed.
Quit with `quit` and kill the Vite process when done.

## Commands

| command                      | effect                                                     |
| ---------------------------- | ---------------------------------------------------------- |
| `launch [real]`              | start app (mock data; `real` = real `~/.claude/`)          |
| `ss [name]`                  | screenshot → `$SCREENSHOT_DIR/<name>.png`                  |
| `click-text <text>`          | DOM-click button/link/card by text (exact, then substring) |
| `click <css>` / `wait <css>` | DOM-click / wait for selector                              |
| `text [css]`                 | print innerText (body if omitted)                          |
| `eval <js>`                  | evaluate in page, print JSON                               |
| `theme [light\|dark]`        | force `data-theme`                                         |
| `quit`                       | close app and exit                                         |

## Gotchas

- Clicks go through `page.evaluate(el.click())`, not coordinates — reliable
  with the app's custom chrome. Navigation is client-side state (no router):
  reach views by clicking like a user (e.g. `click-text webapp` →
  `click-text Teams` → `click-text Open team`).
- The window needs ~2.5s after `domcontentloaded` (baked into `launch`);
  give another ~1s after each navigation click before screenshotting.
- On Linux add xvfb (`xvfb-run -a node …`); `--no-sandbox` is already applied.
