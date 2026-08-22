// @vitest-environment jsdom
//
// The project purge is withdrawn from the UI (`PROJECT_PURGE_ENABLED`), and this
// pins that it really is unreachable rather than merely discouraged.
//
// Why a test for an absence: the purge deleted the state of projects the user had
// not selected, irreversibly, and the confirmation dialog did not say so — the
// plan's project rows all carry the identical detail `project transcripts
// (.jsonl) and memory/`, so `groupItems` folded several distinct projects into
// one row headed by the single path the user recognised. Until both halves are
// fixed, an entry point restored by accident is a data-loss regression, which is
// exactly the kind a passing suite should refuse to stay quiet about.
//
// `ProjectConfigView`'s Danger zone is the documented entry point; the search
// popover's "Remove current" is guarded by the same flag, at its one call site.

import { createElement } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

import { ProjectConfigView } from '../src/components/project/settings/ProjectConfigView';
import { PROJECT_PURGE_ENABLED } from '../src/components/project/shared/project-purge';
import { installFakeElectronAPI, type FakeBridge } from './helpers/fake-electron-api';

const PROJECT = { hash: '-Users-alice-Projects-acme', realPath: '/Users/alice/Projects/acme' };

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

function mount() {
  let deleteRequests = 0;
  const view = render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ProjectConfigView, {
        project: PROJECT,
        onDeleteProject: () => {
          deleteRequests++;
        },
      })
    )
  );
  return { view, requests: () => deleteRequests };
}

describe('project purge, while withdrawn', () => {
  it('is off', () => {
    expect(PROJECT_PURGE_ENABLED).toBe(false);
  });

  it('offers no way to delete a project from the config view', async () => {
    const { requests } = mount();

    // The view has finished its read: what is missing is missing from the settled
    // page, not from a frame that had not rendered yet.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /effective configuration/i })).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: /delete state/i })).toBeNull();
    expect(screen.queryByText(/danger zone/i)).toBeNull();
    // Nothing reached the dialog either: no plan was requested for this project.
    expect(bridge.api.projects.planPurge).not.toHaveBeenCalled();
    expect(requests()).toBe(0);
  });
});
