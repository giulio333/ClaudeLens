// @vitest-environment jsdom
//
// What the delete dialog does with the ANSWER it gets back (#193).
//
// The backend has always been best-effort per artifact, but the dialog treated
// any resolved IPC call as a completed deletion: it fired `session_deleted`,
// closed, and navigated away even when the transcript was still on disk. The
// module-level halves of the fix are covered in `session-deleter.test.ts`; what
// only this side can prove is the contract between the two:
//
//   1. `required` travels with every requested path, so the main process can
//      tell whether the delete meant anything;
//   2. a failed required artifact keeps the dialog open, tells no telemetry and
//      navigates nowhere — the session is still there;
//   3. a failed OPTIONAL artifact is still a deleted session, but it is named
//      instead of silently left behind.

import { createElement } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

import { DeleteSessionDialog } from '../src/components/project/shared/DeleteSessionDialog';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';
import type { DeleteSessionResult, SessionArtifacts } from '../src/types';

const HASH = '-Users-alice-Projects-acme';
const FILENAME = 'sess1.jsonl';
const TRANSCRIPT = '/Users/alice/.claude/projects/-Users-alice-Projects-acme/sess1.jsonl';
const TASKS = '/Users/alice/.claude/tasks/sess1';

const ARTIFACTS: SessionArtifacts = {
  sessionId: 'sess1',
  artifacts: [
    {
      kind: 'session',
      label: 'Session transcript',
      path: TRANSCRIPT,
      isDir: false,
      locked: true,
      defaultSelected: true,
    },
    {
      kind: 'tasks',
      label: 'Tasks',
      path: TASKS,
      isDir: true,
      count: 3,
      defaultSelected: true,
    },
  ],
};

let bridge: FakeBridge;
let queryClient: QueryClient;
let onDeleted: Mock<() => void>;
let onCancel: Mock<() => void>;

beforeEach(() => {
  bridge = installFakeElectronAPI();
  bridge.api.sessions.getArtifacts.mockResolvedValue(ok(ARTIFACTS));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  onDeleted = vi.fn();
  onCancel = vi.fn();
});

afterEach(() => {
  cleanup();
  bridge.restore();
});

function mount() {
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(DeleteSessionDialog, {
        hash: HASH,
        sessionFilename: FILENAME,
        title: 'Refactor the monitor',
        onCancel,
        onDeleted,
      })
    )
  );
}

async function clickDelete() {
  await waitFor(() => expect(screen.getByText('Session transcript')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
}

const result = (over: Partial<DeleteSessionResult> = {}): DeleteSessionResult => ({
  outcomes: [],
  deleted: [],
  warnings: [],
  succeeded: true,
  ...over,
});

describe('DeleteSessionDialog', () => {
  it('marks the locked transcript as required and the rest as optional', async () => {
    bridge.api.sessions.deleteSession.mockResolvedValue(
      ok(
        result({
          outcomes: [
            { path: TRANSCRIPT, status: 'deleted', required: true },
            { path: TASKS, status: 'deleted', required: false },
          ],
          deleted: [TRANSCRIPT, TASKS],
        })
      )
    );

    mount();
    await clickDelete();

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(bridge.api.sessions.deleteSession).toHaveBeenCalledWith([
      { path: TRANSCRIPT, required: true },
      { path: TASKS, required: false },
    ]);
    expect(bridge.api.telemetry.track).toHaveBeenCalledWith('session_deleted', undefined);
  });

  it('stays open, silent and un-navigated when the transcript survives', async () => {
    bridge.api.sessions.deleteSession.mockResolvedValue(
      ok(
        result({
          succeeded: false,
          outcomes: [
            { path: TRANSCRIPT, status: 'failed', required: true, reason: 'EACCES' },
            { path: TASKS, status: 'deleted', required: false },
          ],
          deleted: [TASKS],
          warnings: [`Failed to delete ${TRANSCRIPT}: EACCES`],
        })
      )
    );

    mount();
    await clickDelete();

    await waitFor(() => expect(screen.getByText(/was not deleted/i)).toBeTruthy());
    // The report names the surviving artifact and why.
    expect(screen.getByText('still there')).toBeTruthy();
    expect(screen.getByText('EACCES')).toBeTruthy();
    // Nothing was claimed and nowhere was navigated.
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(bridge.api.telemetry.track).not.toHaveBeenCalledWith('session_deleted', undefined);
    // And it can be retried without reopening the dialog.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('reports a leftover optional artifact but still counts the session deleted', async () => {
    bridge.api.sessions.deleteSession.mockResolvedValue(
      ok(
        result({
          succeeded: true,
          outcomes: [
            { path: TRANSCRIPT, status: 'deleted', required: true },
            { path: TASKS, status: 'failed', required: false, reason: 'EPERM' },
          ],
          deleted: [TRANSCRIPT],
          warnings: [`Failed to delete ${TASKS}: EPERM`],
        })
      )
    );

    mount();
    await clickDelete();

    await waitFor(() => expect(screen.getByText(/with leftovers/i)).toBeTruthy());
    expect(screen.getByText('EPERM')).toBeTruthy();
    // The session IS gone, so it is counted — but the user closes the report
    // themselves rather than being navigated away from what it says.
    expect(bridge.api.telemetry.track).toHaveBeenCalledWith('session_deleted', undefined);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDeleted).toHaveBeenCalled();
  });

  it('says "already gone" rather than "deleted" for what was never there', async () => {
    bridge.api.sessions.deleteSession.mockResolvedValue(
      ok(
        result({
          succeeded: true,
          outcomes: [
            { path: TRANSCRIPT, status: 'deleted', required: true },
            { path: TASKS, status: 'refused', required: false, reason: 'outside root' },
          ],
          deleted: [TRANSCRIPT],
          warnings: [`Failed to delete ${TASKS}: outside root`],
        })
      )
    );

    mount();
    await clickDelete();

    await waitFor(() => expect(screen.getByText('refused')).toBeTruthy());
    expect(screen.queryByText('already gone')).toBeNull();
  });
});
