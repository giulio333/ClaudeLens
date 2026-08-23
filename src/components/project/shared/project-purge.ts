// Whether the project-purge entry points are reachable in the UI.
//
// **Off in v2.2.13, back on with the guardrails of #224 in place.** The history
// matters, because the upstream cause has not gone away — it is contained:
//
// What happened: purging a project deleted the Claude Code state of projects the
// user never selected — transcripts, memories, `file-history/`, task files, and
// the prompts of every one of them filtered out of `history.jsonl`. Nothing of
// that is recoverable (the CLI unlinks, it does not move to the Trash).
//
// Three causes, all reproduced, and what now stands in front of each:
//
//  1. UPSTREAM, still true — `claude project purge <path>` does not act on one
//     project. It acts on **every project at or below `<path>`**, whether or not
//     it is registered in `~/.claude.json`. Verified again on CLI 2.1.240:
//     purging `<sbx>/home` planned the deletion of `home`, `home/ProjA` and
//     `home/ProjB/deep`, sparing only the sibling `home-extra`. There is no flag
//     that narrows it, so the fix cannot be in how we call it — it is in
//     refusing to. `refusePurge` in `electron/modules/project-purger.ts` counts
//     the `projects/<hash>` dirs the plan names and declines to run at all when
//     there is more than one; the dialog blocks on the same rule and lists the
//     projects by name. Nesting is legal on disk, so a parent project stays
//     un-purgeable from here until its children are purged individually. That is
//     the intended trade: the operation this feature performs is irreversible.
//
//  2. OURS, fixed — the dialog hid cause 1. `groupItems` keyed a group on
//     `kind::detail`, which was right for the per-session sidecars it was written
//     for (`file edit history for session <uuid>`: same item, one per session,
//     the id is noise). But a project's transcript folder always carries the
//     identical detail `project transcripts (.jsonl) and memory/`, so N
//     *different projects* collapsed into one row displaying only the first
//     one's path with a count badge — three doomed projects rendered as a single
//     `×3` row headed by the one the user had asked to delete. Grouping is now
//     confined to entries whose detail actually carried a varying id: where the
//     detail does not identify the entry, the target is the row.
//
//  3. OURS, fixed — a partial purge reported as a plain failure. The plan is a
//     flat, arbitrarily ordered list and the purge walks it deleting one entry at
//     a time; a nested project is not a child at delete time, just another row.
//     Hitting an entry it cannot remove, the CLI **hangs** instead of erroring,
//     `runProjectPurge` capped it at 120s and `execClaude` answered the cap with
//     `proc.kill()` and an `ETIMEDOUT` rejection. So everything before the stall
//     was gone, the stall point and everything after it survived, and the dialog
//     showed a red timeout banner over an irreversible deletion that half
//     succeeded. Reproduced: plan order `h, A, D, C, B` with `C` obstructed,
//     killed at 25s — `h, A, D` deleted, `C, B` intact. The cap now **detaches
//     instead of killing** (`onTimeout: 'detach'`), and every outcome is verified
//     on disk per path: a run that did not finish says so and says how far it
//     got, and only a verified-clean run closes the dialog.
//
// Typed `boolean` on purpose: as a literal, one of the two branches at every
// guarded call site would be statically dead, and the reviewer's own linter would
// start asking to delete whichever side is currently unreachable.
export const PROJECT_PURGE_ENABLED: boolean = true;
