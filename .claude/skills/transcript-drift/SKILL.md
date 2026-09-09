---
name: transcript-drift
description: Check whether Claude Code's transcript format has moved ahead of what ClaudeLens reads, and turn what the check finds into triage or an issue. Use when asked to look for format drift, to see what the app is missing from transcripts, after a Claude Code upgrade, or when a session renders wrong and the format is suspected.
---

# Is the transcript format ahead of us?

ClaudeLens reads Claude Code's `~/.claude/projects/**/*.jsonl`, and Claude Code
keeps adding to what it writes there. Nothing announces it. A new row type, a
new `attachment` subtype, a new content block simply doesn't appear in the app —
#245 and #246 both sat unnoticed for months.

Stages 1 and 2 answer two different questions and do not overlap — run both.
Stage 3 costs tokens and is only for a question the first two left open.

## 1. What we don't read

```
npm run census
```

Streams the whole corpus (~1s) and diffs the shapes it finds against the
decisions in `scripts/transcript-manifest.mjs`. Exit 1 means drift. Read the
report in five parts:

- **Drift** — a shape with no manifest entry, absent from the baseline. This is
  the finding. Claude Code writes it and nobody has looked at it.
- **New fields** — the same drift line counts these separately, as in
  `0 unknown shapes, 11 new fields`. A key-path on a row we read or intend to
  read that the baseline has never seen. **Read the warning below before
  re-baselining.**
- **Known gaps** — triaged `candidate`: decided, not yet read. A standing
  backlog, not news. Don't report these as new.
- **Looked at, not decided** — triaged `unknown`: open questions someone already
  examined. Also not news, but each one names what would settle it, so this is
  where to look when you have a new specimen in hand.
- **In the manifest, absent from this corpus** — either dropped upstream, or
  never exercised here. Stage 3 tells the two apart. Suppressed under `--root`,
  where a narrowed corpus makes it list most of the manifest and mean nothing.

> **The field axis is report-once.** Shapes are diffed against the manifest, so
> an un-triaged shape returns every run until someone decides about it. Fields
> are diffed against the _baseline_ only — there is no table they must appear in
> — so `npm run census:accept` makes a field finding **disappear permanently**,
> whether or not you understood it. That is deliberate: a hand table of every
> field would be a second copy of the format and wrong within a week. But it
> means the sequence matters. Look at the fields, write a `FIELDS` entry for any
> that carry something (that is what keeps them in the backlog where you can see
> them), and only then accept. Accepting first destroys the evidence.

## 2. What we read wrong

```
npm run census:replay
```

The census only sees the file. A field can be present, recognised, and still
dropped — which is what #245/#246 were. This test runs the real reader:
fixtures pin which content blocks survive `parseContentArray`, and a corpus
sweep fails on any dropped block the manifest hasn't triaged.

The sweep is opt-in (that script sets `CLAUDELENS_DRIFT_CORPUS=1`) and `npm
test` skips it: it reads the whole corpus, so its outcome depends on state the
test did not create, and left unconditional it reddens `npm test` on an
unrelated branch because _this_ machine's transcripts happen to contain
something new. The fixtures in the same file are unconditional — they are the
regression gate.

A census with no drift and a red test here is the more serious result: it means
we mishandle something we already know about.

## 3. Only if a shape is missing from the corpus

```
node scripts/transcript-exercise.mjs --list
node scripts/transcript-exercise.mjs --yes --only <keys> --census
```

The corpus covers the features this user happens to use. A feature nobody
exercised writes no rows, so the census can't distinguish "Claude Code doesn't
do this" from "we never tried". This drives `claude -p` against prompts chosen
to provoke specific shapes, in a throwaway dir the census skips by name.

**Real model turns, real tokens.** Never run it as part of a check. Reach for it
only when stage 1 or 2 left a specific question a generated transcript would
settle, and say which scenarios you want to run and why before running them.

## Triage

Every drift finding on a _shape_ axis gets one verdict in
`scripts/transcript-manifest.mjs`, then `npm run census:accept` to re-baseline.
(Fields are the exception — `FIELDS` is the one table allowed to be incomplete;
see the report-once warning above.) The verdict is the deliverable: an un-triaged
shape comes back identically next run, and a tool that repeats itself gets
ignored.

- `read('<module>')` — a module consumes it. Only after it actually does.
- `ignored('<reason>')` — deliberately not read. Harness bookkeeping, prompt
  scaffolding, anything carrying nothing a transcript view would show. The
  reason is the point: it's what stops the next person re-litigating it.
- `candidate('<what it would give us>')` — not read, and it should be. Say what
  the app could do with it, not just what the field is.
- `unknown('<what you saw; what would settle it>')` — looked at, and the rows
  didn't say enough.

**Use `unknown` rather than guessing.** Sometimes the only evidence is a shape's
name and one row with an opaque payload — a single occurrence, a bare `{type,
uuid}`, a field whose value tells you nothing. That is not `ignored`: every
`ignored` entry in the manifest names what the thing _is_, and none of them says
"it had no fields". It isn't `candidate` either, which claims the app could use
it. `unknown` records that someone looked, which stops it being re-reported as
fresh drift, and keeps it in its own report section as the open question it is.
Write what a real specimen would need to look like to settle it — that is the
note's job.

One thing no verdict expresses well: a shape read for one purpose and not
another. `agent-meta` is read by `teams-reader`, but only for the
`in_process_teammate` case — 1 of the 35 sidecars on disk — and by nothing for
the other 34. It is filed as `candidate` with that stated in the note, because a
single verdict per shape can't say it. If you hit the same thing, put it in the
note rather than picking the least-wrong verdict silently.

Which table the entry goes in follows the axis the report named: a row type in
`ROW_TYPES`, an `attachment.type` in `ATTACHMENT_TYPES`, a content block in
`CONTENT_BLOCKS`, a `system.subtype` in `SYSTEM_SUBTYPES`, a field in `FIELDS`
keyed by the dotted path exactly as printed.

To decide, read the actual rows before guessing:

```
grep -h '"<the-type>"' ~/.claude/projects/*/*.jsonl | head -3 | python3 -m json.tool
```

Judgement calls worth stating plainly: **volume is not importance** —
`total_tokens_reminder` is 10k+ rows of nothing, `continued-in` is 6 rows and a
missing edge between sessions. And a **dropped content block is never
`ignored`**: `parseContentArray` discarding a block loses user-visible content,
and if the block is a message's only content the whole turn vanishes.

## Reporting

Say which of the three stages produced the finding, and give the count — "57
`image` blocks across the corpus, each a turn the transcript renders as nothing"
lands; "unhandled content block" doesn't. Distinguish the backlog from new
drift; the user knows about the backlog.

For anything worth filing, use the `github-issue` skill — it carries this repo's
house rules. Don't fix and file in the same pass unless asked: triage is cheap
and reversible, a reader change needs a test alongside it.
