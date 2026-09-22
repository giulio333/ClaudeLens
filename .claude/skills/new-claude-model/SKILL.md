---
name: new-claude-model
description: Bring ClaudeLens up to date with a newly released Claude model — exact pricing, context window, display name, alias lists, tests. Use when a new model ships (a new Opus/Sonnet/Haiku/Fable version or a new family), when a session's cost is flagged as an estimate in Analytics, when a model's price changes on the official pricing page, or when asked "does ClaudeLens handle model X?".
---

# A new Claude model shipped — does ClaudeLens know it?

Nothing fails when a model is missing. Its cost is quietly priced by the family
fallback in `getPricing` (anchored on the current generation, so a cheaper
successor is over-billed and a new family word lands on the Sonnet default), its
window may be sized at 200k, and Analytics marks its cost as an estimate
(`isModelPriced` is false). The rationale and the history of past mistakes live
in `electron/modules/CLAUDE.md` (entry `cost-tracker.ts`); read it, don't repeat it.

## 1. Discover what the transcripts actually record

```bash
# model ids in the corpus (quote the glob: zsh expands a bare *.jsonl)
grep -rhoE '"model":"claude-[^"]*"' --include='*.jsonl' ~/.claude/projects | sort | uniq -c | sort -rn
# pricing modifiers the tracker does not model — anything but "standard" matters
grep -rhoE '"speed":"[^"]*"' --include='*.jsonl' ~/.claude/projects | sort | uniq -c
```

Diff the ids against the exact keys of `PRICING` and `SCHEDULED` in
`electron/modules/cost-tracker.ts`. Ids with a `-YYYYMMDD` stamp are covered by
the date-stripped lookup; a `[1m]` suffix is a setting, not an id the API bills.

## 2. Take the rates from the official page — never derive them

Fetch `https://platform.claude.com/docs/en/about-claude/pricing.md` and copy the
row: base input, **5m** cache write (`cacheWrite` is the 5-minute rate by
design), cache hits (`cacheRead`), output. Do **not** compute `cacheRead` as
input × 0.1: some models use another multiplier, and the footnotes under the
table say which. Read the notes there for any dated price change too.

## 3. Update the code

| What                                     | Where                                                                                                                                                     | When                                                                                                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact rate + bump `PRICING_LAST_UPDATED` | `PRICING` in `electron/modules/cost-tracker.ts`                                                                                                           | always                                                                                                                                                                                                 |
| Dated rate change                        | `SCHEDULED` (same file) — re-verify **before** its `from` day                                                                                             | only for a published, dated change                                                                                                                                                                     |
| Family fallback anchor                   | `getPricing` fuzzy branches                                                                                                                               | new family word, or a new current generation — decide it explicitly: re-anchoring on a cheaper model makes an unknown id err **downward**, which the module's rule forbids for ids with no family word |
| Stale comments                           | `cost-tracker.ts` + `electron/modules/CLAUDE.md`                                                                                                          | when a comment claims a model is the "only" exception                                                                                                                                                  |
| Native-1M window                         | `ONE_MILLION_DEFAULT_MODELS` in `electron/shared/context-window.ts`                                                                                       | check the new id matches (and that the regex doesn't over-match its neighbours)                                                                                                                        |
| Display name / family / colour           | `fmtModel`, `modelFamily`, `modelMixKey`, `modelColor` in `src/components/project/utils.ts`                                                               | new family only — versions are parsed from the id                                                                                                                                                      |
| Alias lists                              | `MODEL_ALIASES`, `STEP_MODELS` (StepInspector), `formKit.ts`, `KNOWN_MODELS` (studio-compiler), `BG_MODEL_ALLOWLIST` (claude-cli-args), AgentsLive picker | new family or new CLI alias only                                                                                                                                                                       |

## 4. Tests

- `test/cost-tracker.test.ts` — the exact rate, all four lines (a cache-read
  mistake is invisible on an input/output-only fixture), and `isModelPriced`.
- `test/context-window.test.ts` — the new id's window.
- `test/project-formatters.test.ts` — `fmtModel` for the id, including the
  `[1m]` form if a surface can receive it.

Then `npm run typecheck && npm run lint && npm test`.

## 5. Run the drift census

A new model usually brings new transcript rows too (a new `attachment` subtype,
a new content block). Run `npm run census` and triage with the
`transcript-drift` skill.

## Not modelled — don't "fix" by accident

The tracker prices every token at the standard first-party rate. Fast mode
(`usage.speed: "fast"`), US-only inference (`inference_geo`), 1-hour cache
writes (the transcript doesn't say which TTL was used) and batch discounts are
all ignored. Adding one is a feature, not part of a model update.

Fixtures and examples stay synthetic (see "Fixtures are synthetic" in the root
`CLAUDE.md`): no real project names, session ids or transcript content in the repo.
