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
//      could not parse — that would collect a confirmation for a plan nobody saw;
//   3. it must refuse a plan that reaches more than one project, and name them.
//      `claude project purge <path>` deletes every project at or below `<path>`,
//      and this dialog folded those rows into one headed by the path the user
//      recognised — which is how #224 destroyed projects nobody had selected;
//   4. it must read the outcome instead of assuming it. Only a verified-clean
//      purge closes the dialog: a partial one is irreversible and used to be
//      reported as a plain red failure.

import { createElement, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

import { DeleteProjectDialog } from '../src/components/project/shared/DeleteProjectDialog';
import type { ActiveSession, PurgePlan, PurgePlanProject } from '../src/types';
import {
  installFakeElectronAPI,
  ok,
  emptyPurgePlan,
  purgeResult,
  type FakeBridge,
} from './helpers/fake-electron-api';

const PROJECT = { hash: '-Users-alice-Projects-acme', realPath: '/Users/alice/Projects/acme' };

const ACME: PurgePlanProject = {
  hash: '-Users-alice-Projects-acme',
  target: '/Users/alice/.claude/projects/-Users-alice-Projects-acme',
  path: '/Users/alice/Projects/acme',
  requested: true,
};

const PLAN: PurgePlan = emptyPurgePlan({
  projectPath: PROJECT.realPath,
  totalItems: 58,
  projects: [ACME],
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

/** The shape of the plan that caused #224: the target plus two projects under it. */
const MULTI_PLAN: PurgePlan = emptyPurgePlan({
  projectPath: PROJECT.realPath,
  totalItems: 71,
  projects: [
    ACME,
    {
      hash: '-Users-alice-Projects-acme-tools-cli',
      target: '/Users/alice/.claude/projects/-Users-alice-Projects-acme-tools-cli',
      path: '/Users/alice/Projects/acme/tools/cli',
      requested: false,
    },
    {
      hash: '-Users-alice-Projects-acme-vendor-sdk',
      target: '/Users/alice/.claude/projects/-Users-alice-Projects-acme-vendor-sdk',
      path: null,
      requested: false,
    },
  ],
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
      target: '/Users/alice/.claude/projects/-Users-alice-Projects-acme-tools-cli',
      detail: 'project transcripts (.jsonl) and memory/',
      count: 1,
      targets: ['/Users/alice/.claude/projects/-Users-alice-Projects-acme-tools-cli'],
    },
    {
      kind: 'dir',
      target: '/Users/alice/.claude/projects/-Users-alice-Projects-acme-vendor-sdk',
      detail: 'project transcripts (.jsonl) and memory/',
      count: 1,
      targets: ['/Users/alice/.claude/projects/-Users-alice-Projects-acme-vendor-sdk'],
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

  it('falls back to the raw output when the plan could not be parsed, and blocks', async () => {
    // A declared total with no recognised rows means the CLI's format moved. The
    // raw output is still shown — but the button is now disabled, which is a
    // deliberate reversal: the guard against deleting other projects is the count
    // of projects in the plan, and a plan we cannot parse is one we cannot count.
    bridge.api.projects.planPurge.mockResolvedValue(
      ok(emptyPurgePlan({ totalItems: 12, raw: 'a shape we do not know yet' }))
    );
    mount();

    expect(await screen.findByText(/a shape we do not know yet/)).toBeTruthy();
    expect(deleteButton().hasAttribute('disabled')).toBe(true);
    expect(bridge.api.projects.purge).not.toHaveBeenCalled();
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
  it('counts the projects in the plan, not only the items', async () => {
    bridge.api.projects.planPurge.mockResolvedValue(ok(PLAN));
    mount();

    await screen.findByText(/project transcripts/);
    expect(screen.getByText(/58 items · 1 project/)).toBeTruthy();
  });

  it('refuses a plan that reaches other projects, and names every one of them', async () => {
    bridge.api.projects.planPurge.mockResolvedValue(ok(MULTI_PLAN));
    mount();

    // "3 projects" is deliberately said twice — in the refusal and in the plan
    // header — so anchor on the sentence that explains the subtree rule.
    expect(await screen.findByText(/deletes every project at or below/i)).toBeTruthy();
    expect(screen.getAllByText(/3 projects/).length).toBeGreaterThan(0);
    // Each project is its own row — the row that used to be a single `×3`.
    expect(screen.getByText(/the one you selected/)).toBeTruthy();
    // Named in the refusal AND on its own plan row (the row shows the resolved
    // cwd, not the hash — that is the name the user knows the project by).
    expect(screen.getAllByText('/Users/alice/Projects/acme/tools/cli')).toHaveLength(2);
    // A project the registry could not name is still listed, by its folder.
    expect(screen.getAllByText(/-Users-alice-Projects-acme-vendor-sdk/).length).toBeGreaterThan(0);
    expect(deleteButton().hasAttribute('disabled')).toBe(true);
    expect(bridge.api.projects.purge).not.toHaveBeenCalled();
  });

  it('keeps the plan rows one per project instead of one row with a count', async () => {
    bridge.api.projects.planPurge.mockResolvedValue(ok(MULTI_PLAN));
    mount();

    await screen.findByText(/deletes every project at or below/i);
    expect(screen.getAllByText('project transcripts (.jsonl) and memory/')).toHaveLength(3);
  });

  it('stays open on a partial purge and does not report it as done', async () => {
    // The case #224 hid: the deletion happened, in part, irreversibly. Closing
    // here — or showing a red "failed" — both misrepresent what is on disk.
    bridge.api.projects.planPurge.mockResolvedValue(ok(PLAN));
    bridge.api.projects.purge.mockResolvedValue(
      ok(
        purgeResult({
          status: 'partial',
          output: 'Purged 41 item(s).',
          paths: [
            { path: '/Users/alice/.claude/tasks/abc', kind: 'dir', status: 'gone' },
            { path: '/Users/alice/.claude/file-history/def', kind: 'dir', status: 'remaining' },
          ],
        })
      )
    );
    let confirmed = false;
    mount(() => {
      confirmed = true;
    });

    await screen.findByText(/project transcripts/);
    fireEvent.click(deleteButton());

    expect(await screen.findByText(/part of it is still there/i)).toBeTruthy();
    expect(screen.getByText(/file-history\/def/)).toBeTruthy();
    expect(screen.getByText(/1 of 2 folders/)).toBeTruthy();
    expect(confirmed).toBe(false);
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('says a timed-out purge may still be running instead of calling it a failure', async () => {
    bridge.api.projects.planPurge.mockResolvedValue(ok(PLAN));
    bridge.api.projects.purge.mockResolvedValue(
      ok(
        purgeResult({
          status: 'unknown',
          error: 'claude timed out after 120000ms',
          paths: [{ path: '/Users/alice/.claude/tasks/abc', kind: 'dir', status: 'gone' }],
        })
      )
    );
    mount();

    await screen.findByText(/project transcripts/);
    fireEvent.click(deleteButton());

    expect(await screen.findByText(/still running/i)).toBeTruthy();
    // Retrying while the CLI is still deleting would race it, so the action —
    // now labelled "Try again" — is disabled.
    const retry = screen.getByRole('button', { name: /try again/i });
    expect(retry.hasAttribute('disabled')).toBe(true);
  });

  it('reports a refusal from the module without claiming anything was deleted', async () => {
    // Defence in depth: the dialog blocks on the same rule, so reaching this
    // means the plan changed between the read and the confirmation.
    bridge.api.projects.planPurge.mockResolvedValue(ok(PLAN));
    bridge.api.projects.purge.mockResolvedValue(
      ok(
        purgeResult({
          status: 'refused',
          refusal: 'multiple-projects',
          projects: MULTI_PLAN.projects,
        })
      )
    );
    let confirmed = false;
    mount(() => {
      confirmed = true;
    });

    await screen.findByText(/project transcripts/);
    fireEvent.click(deleteButton());

    expect(await screen.findByText(/refused/i)).toBeTruthy();
    expect(screen.getByText(/nothing was deleted/i)).toBeTruthy();
    expect(confirmed).toBe(false);
  });
});
