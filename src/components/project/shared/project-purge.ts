// Whether the project-purge entry points are reachable in the UI.
//
// **Off since v2.2.13, and it must stay off until both halves below are fixed.**
// Turning it on again means uncommenting nothing: flip this to `true`.
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
// A fix has to make the projects being deleted individually visible (never
// grouped by a detail that omits the subject) and refuse — or at least escalate
// hard — a target that contains other known projects.
//
// Typed `boolean` on purpose: as a `false` literal every guarded block would be
// statically dead, and the reviewer's own linter would start asking to delete the
// feature we intend to bring back.
export const PROJECT_PURGE_ENABLED: boolean = false;
