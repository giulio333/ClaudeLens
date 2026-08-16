// @vitest-environment jsdom
//
// The confirmation dialog for deleting a project's Claude Code state. The
// deletion itself is delegated to `claude project purge` (see
// `electron/modules/project-purger.ts`) and its parser is unit-tested; what is
// only observable from this side are the two things the dialog must never get
// wrong, because both fail *silently* — the button still works, it just does
// something the user did not agree to:
//
//   1. it must refuse to purge while a Claude Code session is live in the
//      project, since the CLI would be deleting files another CLI is writing;
//   2. it must never show an empty list when the CLI answered something it
//      could not parse — that would collect a confirmation for a plan nobody saw.

import { createElement, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

import { DeleteProjectDialog } from '../src/components/project/shared/DeleteProjectDialog';
import type { ActiveSession, PurgePlan } from '../src/types';
import {
  installFakeElectronAPI,
  ok,
  emptyPurgePlan,
  type FakeBridge,
} from './helpers/fake-electron-api';

const PROJECT = { hash: '-Users-alice-Projects-acme', realPath: '/Users/alice/Projects/acme' };

const PLAN: PurgePlan = emptyPurgePlan({
  projectPath: PROJECT.realPath,
  totalItems: 58,
  items: [
    {
      kind: 'dir',
      target: '/Users/alice/.claude/projects/-Users-alice-Projects-acme',
      detail: 'project transcripts (.jsonl) and memory/',
      count: 1,
      targets: ['/Users/alice/.claude/projects/-Users-alice-Projects-acme'],
    },
    {
      kind: 'dir',
      target: '/Users/alice/.claude/file-history/4b598457-dc3a-4679-a3a2-68c194449847',
      detail: 'file edit history for session …',
      count: 55,
      targets: ['/Users/alice/.claude/file-history/4b598457-dc3a-4679-a3a2-68c194449847'],
    },
  ],
});

function liveSession(cwd: string): ActiveSession {
  return { pid: 4242, sessionId: 'abc', cwd, status: 'busy', source: 'registry' };
}

/** What the legacy `ps` fallback produces: no sessionId, no status. */
function scannedProcess(cwd: string): ActiveSession {
  return { pid: 9001, sessionId: '', cwd, status: 'unknown', source: 'process-scan' };
}

let bridge: FakeBridge;
let queryClient: QueryClient;

beforeEach(() => {
  bridge = installFakeElectronAPI();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  bridge.restore();
});

function mount(onConfirm = () => {}) {
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(DeleteProjectDialog, { project: PROJECT, onConfirm, onCancel: () => {} })
    ) as ReactNode
  );
}

const deleteButton = () => screen.getByRole('button', { name: /delete state/i });

describe('DeleteProjectDialog', () => {
  it('shows the plan the CLI produced, grouped entries included', async () => {
    bridge.api.projects.planPurge.mockResolvedValue(ok(PLAN));
    mount();

    expect(await screen.findByText(/project transcripts/)).toBeTruthy();
    // The 55 per-session sidecars are one row carrying a count, not 55 rows.
    expect(screen.getByText(/file edit history for session/)).toBeTruthy();
    expect(screen.getByText('55 entries')).toBeTruthy();
    // The total is the CLI's own, not the number of rows we drew.
    expect(screen.getByText(/58 items/)).toBeTruthy();
  });

  it('asks the CLI for the plan of this project, and does not purge on its own', async () => {
    bridge.api.projects.planPurge.mockResolvedValue(ok(PLAN));
    mount();

    await screen.findByText(/project transcripts/);
    expect(bridge.api.projects.planPurge).toHaveBeenCalledWith(PROJECT.hash);
    expect(bridge.api.projects.purge).not.toHaveBeenCalled();
  });

  it('purges and reports back only once the user confirms', async () => {
    bridge.api.projects.planPurge.mockResolvedValue(ok(PLAN));
    let confirmed = false;
    mount(() => {
      confirmed = true;
    });

    await screen.findByText(/project transcripts/);
    fireEvent.click(deleteButton());

    await waitFor(() => expect(bridge.api.projects.purge).toHaveBeenCalledWith(PROJECT.hash));
    await waitFor(() => expect(confirmed).toBe(true));
  });

  it('blocks the purge while a session is live in this project', async () => {
    bridge.api.projects.planPurge.mockResolvedValue(ok(PLAN));
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([liveSession(PROJECT.realPath)]));
    mount();

    await screen.findByText(/project transcripts/);
    await waitFor(() => expect(screen.getByText(/session is running/i)).toBeTruthy());
    expect(deleteButton().hasAttribute('disabled')).toBe(true);
  });

  it('names the sessions it is blocking on', async () => {
    // A bare count ("2 live") cannot be checked against what the user has open;
    // a pid and a session id can. This dialog was blocked for a user by two
    // processes that were not sessions at all.
    bridge.api.projects.planPurge.mockResolvedValue(ok(PLAN));
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([liveSession(PROJECT.realPath)]));
    mount();

    await screen.findByText(/project transcripts/);
    expect(await screen.findByText(/pid 4242/)).toBeTruthy();
  });

  it('warns about ps-guessed processes but does not let them block the purge', async () => {
    // `process-scan` entries carry no sessionId: the CLI never said it is
    // running here, `ps` was asked to guess. A guess gets a warning, not a veto.
    bridge.api.projects.planPurge.mockResolvedValue(ok(PLAN));
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([scannedProcess(PROJECT.realPath)]));
    mount();

    await screen.findByText(/project transcripts/);
    await waitFor(() => expect(screen.getByText(/carry no session id/i)).toBeTruthy());
    expect(screen.queryByText(/session is running/i)).toBeNull();
    expect(deleteButton().hasAttribute('disabled')).toBe(false);
  });

  it('ignores sessions live in a different project', async () => {
    bridge.api.projects.planPurge.mockResolvedValue(ok(PLAN));
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([liveSession('/Users/alice/other')]));
    mount();

    await screen.findByText(/project transcripts/);
    expect(screen.queryByText(/session is running/i)).toBeNull();
    expect(deleteButton().hasAttribute('disabled')).toBe(false);
  });

  it('falls back to the raw output when the plan could not be parsed', async () => {
    // A declared total with no recognised rows means the CLI's format moved.
    bridge.api.projects.planPurge.mockResolvedValue(
      ok(emptyPurgePlan({ totalItems: 12, raw: 'a shape we do not know yet' }))
    );
    mount();

    expect(await screen.findByText(/a shape we do not know yet/)).toBeTruthy();
    // Still actionable — the user can see what they are approving.
    expect(deleteButton().hasAttribute('disabled')).toBe(false);
  });

  it('says there is nothing to delete instead of offering an empty purge', async () => {
    bridge.api.projects.planPurge.mockResolvedValue(ok(emptyPurgePlan()));
    mount();

    expect(await screen.findByText(/no stored state/i)).toBeTruthy();
    expect(deleteButton().hasAttribute('disabled')).toBe(true);
  });

  it('surfaces a missing CLI rather than falling back to deleting things itself', async () => {
    bridge.api.projects.planPurge.mockResolvedValue({
      data: null,
      error: "'claude' CLI not found in PATH.",
    });
    mount();

    expect(await screen.findByText(/could not read the purge plan/i)).toBeTruthy();
    expect(deleteButton().hasAttribute('disabled')).toBe(true);
    expect(bridge.api.projects.purge).not.toHaveBeenCalled();
  });
});
