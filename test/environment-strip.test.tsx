// @vitest-environment jsdom
//
// The environment strip at the foot of Mission Control. Failed MCP servers used
// to be listed under its row by full name — three wrapped lines for four
// servers in a rail with no room for a list. What is asserted is that they are
// now one count on the strip's own row, and that the servers are one hover or
// focus away, grouped by the plugin or scope that defines them.

import { describe, it, expect, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { EnvironmentStrip } from '../src/components/project/terminal/EnvironmentStrip';
import type { InitInfo } from '../src/types';
import type { SessionGitState } from '../src/components/project/chat/git-state';

afterEach(cleanup);

function init(mcpServers: InitInfo['mcpServers']): InitInfo {
  return {
    permissionMode: 'default',
    model: 'claude-opus-5-5',
    cwd: '/work/acme',
    apiKeySource: 'none',
    claudeCodeVersion: '2.1.283',
    cliSource: 'bundled',
    tools: ['Read', 'Edit', 'Bash'],
    mcpServers,
    slashCommands: [],
    outputStyle: 'default',
    skills: ['alpha'],
    agents: [],
    plugins: [],
    models: [],
  };
}

function mount(info: InitInfo | null) {
  return render(
    <StrictMode>
      <EnvironmentStrip init={info} />
    </StrictMode>
  );
}

const FAILED: InitInfo['mcpServers'] = [
  { name: 'plugin:alpha:first server', status: 'failed', source: 'plugin' },
  { name: 'plugin:alpha:second', status: 'failed', source: 'plugin' },
  { name: 'plugin:gamma:third', status: 'failed', source: 'plugin' },
  { name: 'local-db', status: 'failed', source: 'project' },
  { name: 'claude.ai Mail', status: 'needs-auth', source: 'claudeai' },
];

describe('EnvironmentStrip', () => {
  it('draws nothing before the handshake has answered', () => {
    const { container } = mount(null);
    expect(container.textContent).toBe('');
  });

  it('says nothing about MCP when no server failed', () => {
    const { container, queryByLabelText } = mount(
      init([{ name: 'claude.ai Mail', status: 'needs-auth' }])
    );
    expect(container.textContent).toContain('DEFAULT');
    expect(container.textContent).not.toContain('MCP');
    expect(queryByLabelText(/failed to connect/)).toBeNull();
  });

  it('counts the failed servers on the row and lists none of them at rest', () => {
    const { container, getByLabelText, queryByRole } = mount(init(FAILED));
    expect(getByLabelText('4 MCP servers failed to connect').textContent).toBe('4 MCP');
    expect(queryByRole('tooltip')).toBeNull();
    for (const name of ['first server', 'second', 'third', 'local-db', 'plugin:']) {
      expect(container.textContent).not.toContain(name);
    }
  });

  it('raises the servers on hover, one line per plugin or scope, and drops them on leave', () => {
    const { getByLabelText, getByRole, queryByRole } = mount(init(FAILED));
    const chip = getByLabelText('4 MCP servers failed to connect');
    fireEvent.mouseEnter(chip);
    const card = getByRole('tooltip');
    expect(card.textContent).toContain('4 failed');
    expect(card.textContent).toContain('PLUGIN · ALPHA');
    expect(card.textContent).toContain('first server · second');
    expect(card.textContent).toContain('PLUGIN · GAMMA');
    expect(card.textContent).toContain('CONFIGURED · PROJECT');
    expect(card.textContent).toContain('local-db');
    // The prefix is the group's header, never repeated on each server.
    expect(card.textContent).not.toContain('plugin:');
    // A server waiting for auth is not a failure, and the card does not list it.
    expect(card.textContent).not.toContain('claude.ai Mail');
    fireEvent.mouseLeave(chip);
    expect(queryByRole('tooltip')).toBeNull();
  });

  it('opens the same card on focus, so it is reachable without a pointer', () => {
    const { getByLabelText, getByRole, queryByRole } = mount(init(FAILED));
    const chip = getByLabelText('4 MCP servers failed to connect');
    fireEvent.focus(chip);
    expect(getByRole('tooltip').textContent).toContain('PLUGIN · ALPHA');
    fireEvent.blur(chip);
    expect(queryByRole('tooltip')).toBeNull();
  });

  it('says one server in the singular', () => {
    const { getByLabelText } = mount(init([{ name: 'ide', status: 'failed' }]));
    expect(getByLabelText('1 MCP server failed to connect').textContent).toBe('1 MCP');
  });
});

describe('EnvironmentStrip — git', () => {
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

  function mountGit(info: InitInfo | null, git: SessionGitState | null) {
    return render(
      <StrictMode>
        <EnvironmentStrip init={info} git={git} />
      </StrictMode>
    );
  }

  it('names the branch without waiting for the handshake', () => {
    const { getByLabelText, container } = mountGit(null, GIT);
    expect(getByLabelText('Git branch worktree-spike').textContent).toBe('worktree-spike');
    expect(container.textContent).not.toContain('DEFAULT');
  });

  it('sits beside the permission mode once the handshake answers', () => {
    const { getByLabelText, container } = mountGit(init([]), GIT);
    expect(container.textContent).toContain('DEFAULT');
    expect(getByLabelText('Git branch worktree-spike')).toBeTruthy();
  });

  it('raises the worktree, what it was cut from and the branches of the session', () => {
    const { getByLabelText, getByRole, queryByRole } = mountGit(init([]), GIT);
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

  it('lists no branches for a session that stayed on one, and says detached for HEAD', () => {
    const { getByLabelText, getByRole } = mountGit(null, {
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

  it('draws nothing with neither a handshake nor a branch', () => {
    expect(mountGit(null, null).container.textContent).toBe('');
  });
});
