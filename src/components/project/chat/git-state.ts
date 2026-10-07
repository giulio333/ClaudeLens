// The git state a session's transcript records: the branch each assistant turn
// ran on (`ChatMessage.gitBranch`) and the worktree it worked in
// (`ChatMessage.worktree`). Both are what Claude Code wrote at the time, so the
// branch is the one of the LAST turn, not a live read of the repository — a
// `git checkout` in another terminal shows up only once the session writes again.
import type { ChatMessage, WorktreeState } from '../../../types';

/** What Claude Code writes on a row while HEAD is detached. */
export const DETACHED = 'HEAD';

/** A stretch of consecutive turns on one branch, starting at `uuid`. */
export interface BranchRun {
  branch: string;
  uuid: string;
  timestamp: string;
}

export interface SessionGitState {
  /** The branch of the latest turn that recorded one. */
  branch: string | null;
  /** Every branch the session was on, in order; one entry when it never moved. */
  runs: BranchRun[];
  /** The worktree from the latest `worktree-state` change, if it is still in one. */
  worktree: WorktreeState | null;
}

/** `HEAD` is not a branch: printed bare it reads as one named that. */
export function branchLabel(branch: string): string {
  return branch === DETACHED ? 'detached HEAD' : branch;
}

/** The runs of turns on one branch. A turn with no branch (a user row, a
 *  queued message, a turn written outside a repository) neither starts nor
 *  ends one. */
export function branchRuns(messages: readonly ChatMessage[]): BranchRun[] {
  const runs: BranchRun[] = [];
  for (const m of messages) {
    if (!m.gitBranch) continue;
    if (runs.length > 0 && runs[runs.length - 1].branch === m.gitBranch) continue;
    runs.push({ branch: m.gitBranch, uuid: m.uuid, timestamp: m.timestamp });
  }
  return runs;
}

/** Null when the transcript says nothing about git at all, so a caller draws
 *  nothing instead of an empty chip. */
export function sessionGitState(
  messages: readonly ChatMessage[] | null | undefined
): SessionGitState | null {
  if (!messages || messages.length === 0) return null;
  const runs = branchRuns(messages);
  let worktree: WorktreeState | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const w = messages[i].worktree;
    if (w !== undefined) {
      worktree = w;
      break;
    }
  }
  if (runs.length === 0 && !worktree) return null;
  return { branch: runs.length > 0 ? runs[runs.length - 1].branch : null, runs, worktree };
}

/** The branch a surface names for the session: the latest turn's, else the
 *  worktree's when no turn recorded one yet. One answer for the strip and the
 *  tab card, so the two cannot name different branches. */
export function shownBranch(state: SessionGitState | null): string | null {
  return state ? (state.branch ?? state.worktree?.branch ?? null) : null;
}

/**
 * The transcript with a one-line marker before the first turn on a new branch
 * — the marker is a `branch-change` notice, drawn the way the harness notices
 * are. Only a change is marked: the branch a session started on is the strip's
 * to say. Returns `messages` itself when nothing moved, so a memo keyed on the
 * result does not recompute for the common session that stayed on one branch.
 */
export function withBranchMarkers(messages: ChatMessage[]): ChatMessage[] {
  const runs = branchRuns(messages);
  if (runs.length < 2) return messages;
  const from = new Map<string, string>();
  for (let i = 1; i < runs.length; i++) from.set(runs[i].uuid, runs[i - 1].branch);
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const prev = from.get(m.uuid);
    if (prev !== undefined && m.gitBranch) {
      const text = `${branchLabel(prev)} → ${branchLabel(m.gitBranch)}`;
      out.push({
        uuid: `branch-${m.uuid}`,
        role: 'user',
        timestamp: m.timestamp,
        content: [{ type: 'text', text }],
        notice: { kind: 'branch-change', text },
      });
    }
    out.push(m);
  }
  return out;
}

/** The first seven characters of a commit, the length git abbreviates to. */
export function shortCommit(sha: string): string {
  return sha.slice(0, 7);
}
