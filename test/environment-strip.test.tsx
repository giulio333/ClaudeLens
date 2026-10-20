// @vitest-environment jsdom
//
// The strip at the foot of Mission Control's rail. It holds the git branch
// alone: the permission mode it used to print came from the project's
// settings and went stale on the session's first shift+tab, and the failed
// MCP servers and the capability counts moved to the TOOLKIT panel
// (`toolkit-rail-panel.test.tsx`). What is asserted is the branch, the card it
// raises, and that the strip is absent when there is no branch to name.

import { describe, it, expect, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { EnvironmentStrip } from '../src/components/project/terminal/EnvironmentStrip';
import type { SessionGitState } from '../src/components/project/chat/git-state';

afterEach(cleanup);

const run = (branch: string, uuid: string, timestamp: string) => ({ branch, uuid, timestamp });
const GIT: SessionGitState = {
  branch: 'worktree-spike',
  runs: [
    run('trunk', 'a1', '2026-09-08T09:00:00.000Z'),
    run('worktree-spike', 'a2', '2026-09-08T09:30:00.000Z'),
  ],
  worktree: {
    name: 'spike',
    path: '/work/acme/.claude/worktrees/spike',
    branch: 'worktree-spike',
    originalBranch: 'trunk',
    originalHeadCommit: '0123456789abcdef',
  },
};

function mount(git: SessionGitState | null) {
  return render(
    <StrictMode>
      <EnvironmentStrip git={git} />
    </StrictMode>
  );
}

describe('EnvironmentStrip', () => {
  it('names the branch and nothing else', () => {
    const { getByLabelText, container } = mount(GIT);
    expect(getByLabelText('Git branch worktree-spike').textContent).toBe('worktree-spike');
    expect(container.textContent).toBe('worktree-spike');
  });

  it('raises the worktree, what it was cut from and the branches of the session', () => {
    const { getByLabelText, getByRole, queryByRole } = mount(GIT);
    const chip = getByLabelText('Git branch worktree-spike');
    fireEvent.mouseEnter(chip);
    const card = getByRole('tooltip').textContent;
    expect(card).toContain('WORKTREE');
    expect(card).toContain('spike');
    expect(card).toContain('cut from trunk @ 0123456');
    expect(card).toContain('BRANCHES THIS SESSION');
    expect(card).toContain('trunk');
    // The reading's own limit is part of the card: it is not a live git read.
    expect(card).toContain('the branch the last turn ran on');
    fireEvent.mouseLeave(chip);
    expect(queryByRole('tooltip')).toBeNull();
  });

  it('opens the same card on focus, so it is reachable without a pointer', () => {
    const { getByLabelText, getByRole, queryByRole } = mount(GIT);
    const chip = getByLabelText('Git branch worktree-spike');
    fireEvent.focus(chip);
    expect(getByRole('tooltip').textContent).toContain('WORKTREE');
    fireEvent.blur(chip);
    expect(queryByRole('tooltip')).toBeNull();
  });

  it('lists no branches for a session that stayed on one, and says detached for HEAD', () => {
    const { getByLabelText, getByRole } = mount({
      branch: 'HEAD',
      runs: [run('HEAD', 'a1', '2026-09-08T09:00:00.000Z')],
      worktree: null,
    });
    const chip = getByLabelText('Git branch detached HEAD');
    fireEvent.focus(chip);
    const card = getByRole('tooltip').textContent;
    expect(card).not.toContain('BRANCHES THIS SESSION');
    expect(card).not.toContain('WORKTREE');
  });

  it('draws nothing when the transcript names no branch', () => {
    expect(mount(null).container.textContent).toBe('');
    expect(mount({ branch: null, runs: [], worktree: null }).container.textContent).toBe('');
  });
});
