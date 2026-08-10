// Claude Code keeps a project's history in `~/.claude/projects/<hash>/`, where
// the hash is the absolute cwd with its separators folded to '-'. The main
// process never guesses that mapping backwards: it reads the authoritative cwd
// out of a transcript (`resolveRealPath`), which is why every project the
// renderer gets from `memory:listProjects` carries a trustworthy `realPath`.
//
// A session that has not written a transcript yet has no folder at all — the
// CLI creates `~/.claude/projects/<hash>/` only on the first message, while it
// registers the live session (with its cwd) at launch. Such a project exists
// only in the session registry, so there is no hash to look up and nothing on
// disk the hash could point at.
//
// `provisionalProjectHash` mints a disposable key for exactly that window, so
// the project can be opened instead of being an inert row. It must survive
// `assertValidHash` in the main process (no path separators), hence the fold of
// '/' and '\'. It is deliberately NOT treated as correct: the exact folding
// rule for a Windows drive letter is unverified here, and `reconcileProject`
// swaps the whole project for the real entry as soon as the folder appears.
export function provisionalProjectHash(cwd: string): string {
  return cwd.replace(/[/\\:.]/g, '-');
}
