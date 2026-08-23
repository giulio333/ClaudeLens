// @vitest-environment jsdom
//
// The project purge is reachable again (`PROJECT_PURGE_ENABLED`), and this pins
// the entry point that carries it.
//
// It replaces a test that pinned the *absence* of this button: for v2.2.13 the
// feature was withdrawn because a purge deleted the state of projects the user
// had not selected and the confirmation dialog did not say so (#224). What makes
// it safe to reach now is not this file but the guard — the plan's project rows
// are individual and named, more than one of them refuses the purge, and the
// outcome is verified on disk (`test/project-purger.test.ts`,
// `test/delete-project-dialog.test.tsx`). What this file is still for: the
// Danger zone is the one *visible* way in, and it must open the dialog rather
// than delete anything by itself.

import { createElement } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

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

describe('project purge entry points', () => {
  it('is on', () => {
    expect(PROJECT_PURGE_ENABLED).toBe(true);
  });

  it('offers the Danger zone in the config view', async () => {
    mount();

    // The view has finished its read: what is present is present on the settled
    // page, not on a frame that had not rendered yet.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /effective configuration/i })).toBeTruthy();
    });

    expect(screen.getByText(/danger zone/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /delete state/i })).toBeTruthy();
  });

  it('asks for the dialog instead of purging, and reads no plan until then', async () => {
    // The button's whole job is to open the confirmation. Reading the plan — let
    // alone running the purge — from this view would collect no consent at all.
    const { requests } = mount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /effective configuration/i })).toBeTruthy();
    });
    expect(bridge.api.projects.planPurge).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /delete state/i }));

    expect(requests()).toBe(1);
    expect(bridge.api.projects.planPurge).not.toHaveBeenCalled();
    expect(bridge.api.projects.purge).not.toHaveBeenCalled();
  });
});
