---
name: github-issue
description: House rules for filing a GitHub issue on this repo — English, evidence-first, with the sections maintainer issues use. Use whenever an issue is being written, filed, or reworded.
allowed-tools: Bash, Read, Grep, Glob
---

# Filing an issue

**English only.** Maintainer issues go through `gh issue create` and skip the web forms in `.github/ISSUE_TEMPLATE/` (those are for outside reporters). Label with `bug` or `enhancement`.

## Title

One line naming the observed behaviour, not the fix. Specific enough to be recognised in a list; a colon may add the cause.

- ✅ `Transcript drops mid-turn messages: Claude replies to something the view never shows`
- ❌ `Bug in session reader` · ❌ `Fix the SDK read`

## Bug body

- **## What happens** — the wrong behaviour in user terms, then the mechanism: the module and `file.ts:line` that produce it, and the snippet if the bug is in it.
- **## Verified** — the evidence from this machine: what's in the JSONL vs. what the read path returns, counts, how many real sessions show it. An unverified claim is marked as a hypothesis.
- **## Possible directions** — optional, one bullet per approach with its cost. Do not write the patch here.

## Enhancement body

- **## The gap** — what you can't do today and what you do instead.
- **## What it would look like** — the view or namespace it lands in, and what it shows. Concrete, no mockup prose.
- **## Notes** — the modules it would touch, prior art in the repo, open questions.

## Rules

Short beats complete: no logs dumped whole, no restating the architecture — link `CLAUDE.md` instead. One defect per issue; split a shared root cause into linked issues and say so ("Split out of #245"). Search `gh issue list --state all` for a duplicate first.

**No authorship attribution:** the issue reads as written by the maintainer — no `🤖 Generated with Claude Code` footer, no `claude.ai/code` session link, no "I asked Claude to…". Claude Code appears only as the _subject_ (the CLI whose data ClaudeLens reads), never as the author; evidence is reported as observed on this machine, not as something an assistant found.

```bash
gh issue create --title "…" --label bug --body-file <scratchpad>/issue-body.md
```
