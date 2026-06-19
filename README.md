# ClaudeLens

A desktop app to explore, manage, and work with your local [Claude Code](https://claude.ai/code) data — macOS, with experimental Linux and Windows support.

If you use Claude Code heavily, you know how opaque `~/.claude/` is. ClaudeLens makes it navigable: read your past sessions, manage memory and CLAUDE.md, edit skills and agents — and pick a conversation back up, either in an embedded terminal or in an in-app chat. Everything stays in sync with `~/.claude/` in real time, so changes you make in the terminal show up instantly, and vice versa.

---

## Screenshots

<table>
  <tr>
    <td align="center"><sub><b>Global Home — Light</b></sub></td>
    <td align="center"><sub><b>Global Home — Dark</b></sub></td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/home_light.png" alt="ClaudeLens — Global Home Light" style="max-width:100%;height:auto;"/>
    </td>
    <td align="center">
      <img src="docs/screenshots/home_dark.png" alt="ClaudeLens — Global Home Dark" style="max-width:100%;height:auto;"/>
    </td>
  </tr>
  <tr>
    <td align="center"><sub><b>Project Overview — Light</b></sub></td>
    <td align="center"><sub><b>Project Overview — Dark</b></sub></td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/project_light.png" alt="ClaudeLens — Project Overview Light" style="max-width:100%;height:auto;"/>
    </td>
    <td align="center">
      <img src="docs/screenshots/project_dark.png" alt="ClaudeLens — Project Overview Dark" style="max-width:100%;height:auto;"/>
    </td>
  </tr>
  <tr>
    <td align="center"><sub><b>Skill Editor — Light</b></sub></td>
    <td align="center"><sub><b>Skill Editor — Dark</b></sub></td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/skills_light.png" alt="ClaudeLens — Skill Editor Light" style="max-width:100%;height:auto;"/>
    </td>
    <td align="center">
      <img src="docs/screenshots/skills_dark.png" alt="ClaudeLens — Skill Editor Dark" style="max-width:100%;height:auto;"/>
    </td>
  </tr>
  <tr>
    <td align="center"><sub><b>Agent View — Light</b></sub></td>
    <td align="center"><sub><b>Agent View — Dark</b></sub></td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/agentview_light.png" alt="ClaudeLens — Agent View Light" style="max-width:100%;height:auto;"/>
    </td>
    <td align="center">
      <img src="docs/screenshots/agentview_dark.png" alt="ClaudeLens — Agent View Dark" style="max-width:100%;height:auto;"/>
    </td>
  </tr>
</table>

---

## Features

### Explore

- **Projects & sessions** — every project from `~/.claude/projects/` in one sidebar, with token usage and cost per project and per session. Open any session to replay the full conversation: messages, thinking blocks, and tool calls rendered for what they are (code diffs, terminal output, web results, sub-agent transcripts).
- **Analytics** — token and cost trends across your history.
- **Memory** — read and edit memory topics with full CRUD, kept in the exact `MEMORY.md` + topic-file format Claude Code expects, with a warning when the index grows large enough to risk truncation.
- **CLAUDE.md & rules** — the complete instruction hierarchy active for a project (global → project → local → subdir) plus conditional `.claude/rules/`.
- **Skills, agents, plugins & MCP** — browse global and per-project skills, agents, installed plugins, and MCP servers; create or edit skills and agents straight from the UI.
- **Plans & tasks** — plan-mode plans (filterable, searchable, editable) and the tasks Claude creates during sessions, grouped per session.

### Work

- **Embedded terminal** — pick up any session in a real terminal inside the app, side by side with its read-only Lens view.
- **In-app chat** — continue a conversation through the Claude Agent SDK without leaving ClaudeLens: streaming replies, native slash commands, and interactive tool approvals (Allow / Always / Deny). Chats persist to the same transcript files as the terminal, so the two are interchangeable.

### Monitor

- **Live Monitor** _(experimental)_ — real-time view of active Claude processes: status (idle / thinking / busy), a sliding activity chart, tool-frequency breakdown, and elapsed timer.
- **Duplicate projects** — detect project folders that point to the same directory and merge their history and memory.

Everything updates live: any change under `~/.claude/` while you work in the terminal is reflected immediately, and vice versa.

---

## Requirements

- macOS 12 Monterey or later, or Linux / Windows (experimental)
- [Claude Code](https://claude.ai/code) installed and used at least once (so `~/.claude/` exists)

---

## Installation

**macOS** — download the `.dmg` from the [Releases](https://github.com/giulio333/ClaudeLens/releases) page, open it, and drag ClaudeLens to Applications.

**Linux (experimental)** — download the `.AppImage` from the [Releases](https://github.com/giulio333/ClaudeLens/releases) page and make it executable with `chmod +x`. Opening a session in a terminal relies on a common terminal emulator being installed (`gnome-terminal`, `konsole`, `xfce4-terminal`, or `xterm`).

**Windows (experimental)** — download and run the `.exe` installer from the [Releases](https://github.com/giulio333/ClaudeLens/releases) page. Opening a session launches it in a new `cmd` window.

> **First launch — Gatekeeper warning**
>
> The app is not code-signed. macOS will block it on first open.
> Right-click the app in Finder and choose **Open**, then confirm in the dialog.
>
> Alternatively, run this command once in Terminal:
>
> ```bash
> xattr -d com.apple.quarantine /Applications/ClaudeLens.app
> ```

---

## Build from source

```bash
npm install
npm run dev              # Vite dev server + Electron
npm run electron:build   # Generate distributable DMG
```

---

## Known limitations

- The embedded terminal and in-app chat require the `claude` CLI installed and in `PATH`
- Session list is not paginated — may be slow with very large histories (500+ sessions)
- No automatic updates
- App is not code-signed (see installation note above)
- On Windows, the Live Monitor and background agents are not yet supported (they rely on Unix process tooling); browsing sessions, memory, CLAUDE.md, and opening sessions in a terminal all work

---

## License

[MIT](LICENSE)
