# Privacy Policy

_Last updated: 2026-08-14_

ClaudeLens is a local-first desktop application. It reads and manages the Claude
Code data already on your computer (under `~/.claude/`). **That data never leaves
your device** — it is not uploaded, synced, or sent to us or anyone else.

The only information that leaves your computer is a small amount of **anonymous
usage telemetry** and, when something breaks, an **error report** — both
described in full below, both covered by the same one-click opt-out — plus a
lightweight **update check**, described right after them.

---

## TL;DR

|                           |                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **What we collect**       | A handful of anonymous events (app launch/exit, which sections you open, a few feature actions), plus your app version, OS, and language — and, when the app breaks, the error itself (with all paths and names stripped out). |
| **What we never collect** | Anything from your Claude Code sessions, files, prompts, paths, or identity.                                                                                                                                                   |
| **Who processes it**      | [Aptabase](https://aptabase.com), EU data center. Anonymous by design.                                                                                                                                                         |
| **Why**                   | To estimate how many people use ClaudeLens and on which platforms, and to find the crashes nobody reports.                                                                                                                     |
| **Can I opt out?**        | Yes — **Settings → Privacy → "Share anonymous usage data"**. Takes effect immediately.                                                                                                                                         |

---

## Usage telemetry

ClaudeLens uses [Aptabase](https://aptabase.com), an open-source, privacy-first
analytics service built for desktop and mobile apps. Events are sent to
Aptabase's **EU data center** (`eu.aptabase.com`).

Aptabase is designed to be GDPR/CCPA-compliant: it monitors **sessions**, not
users, and uses **no persistent unique identifier**. There is no cross-session
tracking and no way to single out an individual.

### What is collected

**System properties** are attached anonymously to every event:

- **App version** (e.g. `2.1.0`)
- **Operating system** name and version (e.g. `macOS 15.5`)
- **Language / locale** (e.g. `en-US`)
- **App engine version** (the Chromium version ClaudeLens runs on)
- A **rotating session id** — a random value that resets after roughly an hour of
  inactivity and is **not** tied to your identity or reused across sessions

**Events** record only that an action happened, never its content. The complete
list of events and their properties:

| Event             | When                                    | Extra property                                                                                      |
| ----------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `app_started`     | The app launches                        | —                                                                                                   |
| `app_exited`      | The app quits                           | `duration_seconds` — how long the app was open                                                      |
| `view_opened`     | You open a section (first time per run) | `view` — a fixed internal label like `sessions` or `analytics`, **never** a project or session name |
| `chat_started`    | You start a new in-app chat             | —                                                                                                   |
| `export_done`     | An export finishes                      | `format` — `markdown` or `pdf`                                                                      |
| `terminal_opened` | The embedded terminal starts            | —                                                                                                   |
| `session_deleted` | You delete a session                    | —                                                                                                   |

Those fixed labels and numbers are the **entire** custom payload. No event ever
carries text you wrote, a session/project name, a file path, or any content.

### What is never collected

ClaudeLens **never** sends, and Aptabase never receives, any of the following:

- Your Claude Code sessions, prompts, or model responses
- Any file under `~/.claude/` (transcripts, memory, plans, skills, agents, MCP config)
- File paths, directory names, usernames, or project names
- API keys, credentials, or environment variables
- IP-based location beyond the coarse country inference Aptabase derives in
  aggregate (we never see or store your IP address ourselves)

In short: nothing that could identify you, and nothing about _what_ you do in
Claude Code — only the fact that the app launched, and on what platform.

## Error reports

When ClaudeLens breaks — a crash, a screen that fails to render, an operation
that throws — it sends the error to the same Aptabase account, so bugs can be
found and fixed without waiting for someone to report them.

An error report contains only:

- The **error type** and **message** (e.g. `Error:ENOENT`, `no such file`)
- The **stack trace**, i.e. which lines of ClaudeLens' own code were running
- The same anonymous system properties as any other event (app version, OS,
  language, rotating session id)

**Every file path is removed before the report leaves your machine.** Error
messages and stack traces are the one place where a path — and therefore a
username or a project name — could slip in, so each report goes through a
scrubbing step first:

- Paths inside the ClaudeLens app itself are kept as `<app>/…` (that is our own
  code, and it is what makes the report useful)
- **Every other path** — your home directory, your projects, anything under
  `~/.claude/` — is replaced with `<path>`
- Your **username** is replaced with `<user>`, even when it appears outside a path

We also never send the contents of a file, a prompt, or a session; only the
error text produced by the code itself. When a report cannot be sent because the
app is dying, it is stored on your disk (`~/.claudelens/pending-error.json`) and
sent on the next launch — or discarded if you turned telemetry off in the
meantime.

Error reports follow the **same opt-out toggle** as usage telemetry: turning off
"Share anonymous usage data" stops them too.

## Update check

At launch (and when you press **Check now** in Settings → General), ClaudeLens
asks the public GitHub API for the latest release of this repository
(`api.github.com/repos/giulio333/ClaudeLens/releases/latest`) to tell you when
a newer version is available. The request carries **no data about you or your
usage** — it is a plain anonymous read of a public endpoint, like opening the
releases page in a browser (GitHub sees your IP address, as with any web
request; see [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)).
Nothing is downloaded or installed automatically.

## Legal basis (GDPR)

We rely on **legitimate interest** (GDPR Article 6(1)(f)) to collect this data.
This is lawful here because the data is anonymous and aggregate, the impact on
your privacy is minimal, and you can opt out with one click. We disclose the
processing here, in the in-app Settings → Privacy panel, and in the project
README, in line with the GDPR transparency principle.

If you are in a jurisdiction that requires consent for any analytics, simply turn
the toggle off — see below.

## How to opt out

Telemetry is **on by default**, but you are always in control:

1. Open ClaudeLens.
2. Go to **Settings** (the gear icon) → **Privacy**.
3. Turn off **"Share anonymous usage data"**.

The change takes effect immediately — no restart required. While it is off,
**nothing** is sent from your machine.

## Data processor and retention

Telemetry is processed by Aptabase. See Aptabase's own privacy policy at
[aptabase.com/legal/privacy](https://aptabase.com/legal/privacy) for how they
store and retain anonymous event data in the EU. We do not sell, share, or
monetize any data, and we use it only in aggregate to understand adoption.

## Children

ClaudeLens is a developer tool and is not directed at children.

## Changes to this policy

If we change what we collect, we will update this file and the in-app Privacy
panel in the same release. Because this policy lives in the repository, every
change is versioned alongside the code that makes it.

## Contact

Questions or concerns about privacy? Please
[open an issue](https://github.com/giulio333/ClaudeLens/issues) on GitHub.
