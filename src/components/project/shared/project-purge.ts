// Whether the project-purge entry points are reachable in the UI.
//
// **Off since v2.2.13, and it must stay off until both halves below are fixed.**
// Turning it on again means uncommenting nothing: flip this to `true`. Tracked as
// issue #224, which carries the sandbox repro and the checklist for re-enabling.
//
// What happened: purging a project deleted the Claude Code state of projects the
// user never selected — transcripts, memories, `file-history/`, task files, and
// the prompts of every one of them filtered out of `history.jsonl`. Nothing of
// that is recoverable (the CLI unlinks, it does not move to the Trash).
//
// Two independent causes, both reproduced:
//
//  1. UPSTREAM — `claude project purge <path>` does not act on one project. It
//     acts on **every project at or below `<path>`**, whether or not it is
//     registered in `~/.claude.json`. Verified against a sandbox
//     `CLAUDE_CONFIG_DIR`: a purge of `/tmp` swept all five projects under it and
//     matched `--all` item for item, while a purge of `/tmp/sbhome` correctly
//     spared the sibling `/tmp/sbhome-extra`. So the rule is path containment,
//     and for any project whose path is an ancestor of others — the home
//     directory above all, where every project lives — `purge` IS `--all`.
//
//  2. OURS — the dialog hid that. `groupItems` in `electron/modules/project-purger.ts`
//     keys a group on `kind::detail`, which was right for the per-session sidecars
//     it was written for (`file edit history for session <uuid>`: same item, one
//     per session, the id is noise). But a project's transcript folder always
//     carries the identical detail `project transcripts (.jsonl) and memory/`,
//     so N *different projects* collapse into one row that displays only the
//     first one's path with a count badge. Fed the real dry-run above, the parser
//     rendered three doomed projects as a single `×3` row headed by the one the
//     user had asked to delete. The plan was correct; the plan on screen was not.
//
//  3. OURS, and the one that shaped the damage — a partial purge reported as a
//     plain failure. The plan is a flat, arbitrarily ordered list and the purge
//     walks it deleting one entry at a time; a nested project is not a child at
//     delete time, just another row. Hitting an entry it cannot remove, the CLI
//     **hangs** instead of erroring, `runProjectPurge` caps it at 120s and
//     `execClaude` answers the cap with `proc.kill()` and an `ETIMEDOUT`
//     rejection. So everything before the stall is gone, the stall point and
//     everything after it survives, and the dialog shows a red timeout banner
//     over an irreversible deletion that half succeeded. Reproduced: plan order
//     `h, A, D, C, B` with `C` obstructed, killed at 25s — `h, A, D` deleted,
//     `C, B` intact. An unobstructed purge of the same layout finishes in under
//     a second, so reaching the cap *means* a partial deletion happened.
//
// A fix has to make the projects being deleted individually visible (never
// grouped by a detail that omits the subject), refuse — or at least escalate
// hard — a target that contains other known projects, and never let a timeout
// kill the CLI mid-delete: a non-clean exit must read as "this may have partly
// completed", never as "nothing happened".
//
// Typed `boolean` on purpose: as a `false` literal every guarded block would be
// statically dead, and the reviewer's own linter would start asking to delete the
// feature we intend to bring back.
export const PROJECT_PURGE_ENABLED: boolean = false;
