// The git state a transcript records, as the renderer reads it: the branch of
// each assistant turn and the worktree the session works in. Everything here is
// a claim about the LAST turn written, never a live read of the repository.
import { describe, expect, it } from 'vitest';
import {
  branchLabel,
  branchRuns,
  sessionGitState,
  shortCommit,
  shownBranch,
  withBranchMarkers,
} from '../src/components/project/chat/git-state';
import type { ChatMessage, WorktreeState } from '../src/types';

function turn(uuid: string, gitBranch?: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    uuid,
    role: 'assistant',
    timestamp: `2026-09-08T10:00:0${uuid.slice(-1)}.000Z`,
    content: [{ type: 'text', text: uuid }],
    ...(gitBranch ? { gitBranch } : {}),
    ...extra,
  };
}

function user(uuid: string): ChatMessage {
  return { uuid, role: 'user', timestamp: '2026-09-08T10:00:00.000Z', content: [] };
}

const SPIKE: WorktreeState = {
  name: 'spike',
  path: '/work/acme/.claude/worktrees/spike',
  branch: 'worktree-spike',
  originalBranch: 'trunk',
  originalHeadCommit: '0123456789abcdef',
};

describe('branchRuns', () => {
  it('collapses consecutive turns on one branch, and turns with none break nothing', () => {
    const runs = branchRuns([
      turn('a1', 'trunk'),
      user('u1'),
      turn('a2'),
      turn('a3', 'trunk'),
      turn('a4', 'feature-one'),
      turn('a5', 'trunk'),
    ]);
    expect(runs.map(r => [r.branch, r.uuid])).toEqual([
      ['trunk', 'a1'],
      ['feature-one', 'a4'],
      ['trunk', 'a5'],
    ]);
  });
});

describe('sessionGitState', () => {
  it('is null for a transcript that says nothing about git', () => {
    expect(sessionGitState([turn('a1'), user('u1')])).toBeNull();
    expect(sessionGitState(undefined)).toBeNull();
  });

  it('names the latest branch and the latest worktree change', () => {
    const state = sessionGitState([
      turn('a1', 'trunk'),
      turn('a2', 'worktree-spike', { worktree: SPIKE }),
      turn('a3', 'worktree-spike'),
    ]);
    expect(state?.branch).toBe('worktree-spike');
    expect(state?.worktree).toEqual(SPIKE);
  });

  it('forgets the worktree once the session left it', () => {
    const state = sessionGitState([
      turn('a1', 'worktree-spike', { worktree: SPIKE }),
      turn('a2', 'trunk', { worktree: null }),
    ]);
    expect(state?.worktree).toBeNull();
    expect(state?.branch).toBe('trunk');
  });

  it("falls back to the worktree's branch before any turn recorded one", () => {
    expect(shownBranch(sessionGitState([turn('a1', undefined, { worktree: SPIKE })]))).toBe(
      'worktree-spike'
    );
    expect(shownBranch(null)).toBeNull();
  });
});

describe('withBranchMarkers', () => {
  it('returns the transcript itself when the branch never moved', () => {
    const messages = [turn('a1', 'trunk'), user('u1'), turn('a2', 'trunk')];
    expect(withBranchMarkers(messages)).toBe(messages);
  });

  it('puts one marker before the first turn on each new branch, and none for the first', () => {
    const out = withBranchMarkers([
      turn('a1', 'trunk'),
      user('u1'),
      turn('a2', 'feature-one'),
      turn('a3', 'feature-one'),
      turn('a4', 'HEAD'),
    ]);
    expect(out.map(m => m.uuid)).toEqual(['a1', 'u1', 'branch-a2', 'a2', 'a3', 'branch-a4', 'a4']);
    const marker = out[2];
    expect(marker.role).toBe('user');
    expect(marker.timestamp).toBe(out[3].timestamp);
    expect(marker.notice).toEqual({ kind: 'branch-change', text: 'trunk → feature-one' });
    expect(out[5].notice?.text).toBe('feature-one → detached HEAD');
  });
});

describe('labels', () => {
  it('never prints HEAD as if it were a branch', () => {
    expect(branchLabel('HEAD')).toBe('detached HEAD');
    expect(branchLabel('trunk')).toBe('trunk');
  });

  it('abbreviates a commit to seven characters', () => {
    expect(shortCommit('0123456789abcdef')).toBe('0123456');
  });
});
