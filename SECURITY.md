# Security Policy

## Reporting a Vulnerability

ClaudeLens runs locally and has an IPC + filesystem-write surface, so responsible disclosure matters. Please **do not** open a public issue for security problems.

Report vulnerabilities privately through **GitHub's private vulnerability reporting**:

1. Go to the repository's **Security** tab: <https://github.com/giulio333/ClaudeLens/security>
2. Click **Report a vulnerability**.
3. Describe the issue, affected version, and steps to reproduce.

## Supported versions

Only the latest release on `main` is supported. Fixes are applied to `main` and shipped in subsequent releases.

## Response expectations

ClaudeLens is a solo open-source project, so triage and fixes are **best-effort** with no guaranteed timeline. You'll get a response as soon as is reasonably possible.

## Scope

ClaudeLens is a local desktop application. It reads your local `~/.claude/` data and runs entirely on your machine — there is no server or backend component. Relevant security surface is therefore local: the Electron IPC bridge and the app's filesystem reads and writes under `~/.claude/`.
