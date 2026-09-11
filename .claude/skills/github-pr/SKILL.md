---
name: github-pr
description: House rules for opening a pull request on this repo — English title and body, the sections the PR template expects, and the gates to run first. Use whenever a PR is being written, opened, or its description rewritten.
allowed-tools: Bash, Read, Grep, Glob
---

# Opening a PR

**Everything is written in English** — title, body, commit messages. No exceptions.

## Before opening

`npm run format:check && npm run typecheck && npm run lint && npm test && npm run build` must all pass. Never launch the app to verify UI; say so and leave it to the user.

## Title

One line, imperative, plain prose that says what the change does — not what file it touches. Append `(#N)` when it closes an issue. Conventional prefixes (`feat(chat):`, `fix(live):`) are fine for small scoped work; prose titles are the norm for anything bigger.

- ✅ `Recover the frontmatter fields around a bad line instead of dropping them all (#248)`
- ❌ `fix parseFrontmatter` · ❌ `Various improvements`

## Body

Fill `.github/pull_request_template.md`; don't invent sections and don't drop the checklist.

- **What this changes** — 2–5 sentences: the defect (or the gap) and the mechanism of the fix. Name the module and the line that mattered (`electron/modules/x.ts:42`); a short code block only when the bug _is_ the snippet. Then `Closes #N`.
- **How to verify** — what a reviewer runs, plus the real evidence you already have (test counts, a check against real `~/.claude/` data).
- **Checklist** — tick honestly; leave unticked what you didn't do.
- **Screenshots** — UI changes only, light + dark.

Describe behaviour, not the diff: no file-by-file walkthrough, no repetition of what the checklist already says. Flag anything left out and why.

## Create it

```bash
gh pr create --title "…" --body-file <scratchpad>/pr-body.md
```

## No authorship attribution

The PR reads as written by the maintainer. Never add the `🤖 Generated with Claude Code` footer, a `claude.ai/code` session link, a co-author trailer, or any phrasing that says the change was produced by an assistant — not in the title, the body, or the commits. Claude Code stays in the text only as the _subject_ of the app (the CLI whose data ClaudeLens reads, its transcripts, its SDK), never as the author.
