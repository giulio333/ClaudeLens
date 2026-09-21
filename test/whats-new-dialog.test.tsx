// @vitest-environment jsdom
//
// The "What's new" popup (src/components/WhatsNewDialog.tsx): shown once per
// app version on first launch after an update, dismissed for good by writing
// the current version to prefs (`cl-whatsnew-seen-version`) — the same
// per-version dismissal shape as the update banner's "skip this version".

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, StrictMode } from 'react';
import { WhatsNewDialog } from '../src/components/WhatsNewDialog';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';
import { version as appVersion } from '../package.json';
import { WHATS_NEW } from '../src/data/whats-new';

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

function renderDialog() {
  return render(
    createElement(
      StrictMode,
      null,
      createElement(QueryClientProvider, { client: queryClient }, createElement(WhatsNewDialog))
    )
  );
}

// The suite pins its own claim against the shipped content, not a hardcoded
// title: it reads whatever the running package.json version authored.
//
// A release may author nothing — the repo's own rule is one entry per release
// WITH something to show, skipped for a fix-only one — and that is not a
// failure, it is the other half of the feature: the popup stays silent. So the
// three tests that need an entry run only when there is one, and the silence is
// asserted when there is not. Making the entry mandatory instead turned every
// fix-only bump into three red tests about a dialog that behaved correctly.
const currentRelease = WHATS_NEW.find(r => r.version === appVersion);
const whenAuthored = currentRelease ? it : it.skip;
const whenNotAuthored = currentRelease ? it.skip : it;

describe('WhatsNewDialog', () => {
  whenAuthored('shows the current version highlights when nothing was seen yet', async () => {
    const release = currentRelease!;
    renderDialog();
    await waitFor(() => {
      screen.getByRole('dialog', { name: "What's new" });
    });
    // By heading, not by text: the masthead's index names every feature too.
    screen.getByRole('heading', { name: release.highlights[0].title });
  });

  whenAuthored('gives every authored highlight its own section, with its visual', async () => {
    const release = currentRelease!;
    const { container } = renderDialog();
    await waitFor(() => {
      screen.getByRole('dialog', { name: "What's new" });
    });

    // Not just the first one: a release that authored three features must show
    // three, or the popup silently drops what it was written to announce.
    for (const highlight of release.highlights)
      screen.getByRole('heading', { name: highlight.title });
    expect(container.querySelectorAll('.cl-whatsnew-item')).toHaveLength(release.highlights.length);
    expect(container.querySelectorAll('.cl-whatsnew-frame')).toHaveLength(
      release.highlights.filter(h => h.visual).length
    );
    // And the masthead lists them, so nothing under the fold is a surprise.
    expect(container.querySelectorAll('.cl-whatsnew-index button')).toHaveLength(
      release.highlights.length
    );
  });

  whenAuthored('marks the version seen and closes on "Ho capito"', async () => {
    renderDialog();
    await waitFor(() => {
      screen.getByRole('dialog', { name: "What's new" });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));

    await waitFor(() => {
      expect(bridge.api.prefs.set).toHaveBeenCalledWith('cl-whatsnew-seen-version', appVersion);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: "What's new" })).toBeNull();
    });
  });

  whenNotAuthored('stays silent on a release that authored nothing', async () => {
    renderDialog();
    await waitFor(() => {
      expect(bridge.api.prefs.getAll).toHaveBeenCalled();
    });
    expect(screen.queryByRole('dialog', { name: "What's new" })).toBeNull();
  });

  it('stays hidden when this exact version was already marked seen', async () => {
    const getAll = vi.fn(async () =>
      ok<Record<string, unknown>>({ 'cl-whatsnew-seen-version': appVersion })
    );
    bridge.api.prefs.getAll = getAll;
    renderDialog();
    await waitFor(() => {
      expect(getAll).toHaveBeenCalled();
    });
    expect(screen.queryByRole('dialog', { name: "What's new" })).toBeNull();
  });
});
