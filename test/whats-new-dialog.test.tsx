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
import type { WhatsNewRelease } from '../src/data/whats-new';

// The suite used to read whatever the running package.json version authored,
// and skip the three rendering tests when it authored nothing — which is
// exactly a fix-only release, so on every one of those the dialog shipped with
// no test of its rendering or its "Got it". The entry is stubbed instead: what
// the popup does with an entry and without one are both pinned on every run,
// whatever the version on disk says. `shouldShowWhatsNew` stays the real one.
const stub = vi.hoisted(() => ({ release: undefined as WhatsNewRelease | undefined }));
vi.mock('../src/data/whats-new', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/data/whats-new')>();
  return {
    ...actual,
    whatsNewFor: (version: string) =>
      stub.release && stub.release.version === version ? stub.release : undefined,
  };
});

// Real `visual` keys: the dialog draws them through its VISUALS map, so the
// test also proves every key the type allows still renders.
const AUTHORED: WhatsNewRelease = {
  version: appVersion,
  highlights: [
    { title: 'A first feature', description: 'What it does.', visual: 'prompt-playbook' },
    { title: 'A second feature', description: 'Another.', visual: 'cross-session-message' },
    { title: 'A third feature', description: 'No visual for this one.' },
    { title: 'A published page', description: 'The card.', visual: 'artifact' },
    { title: 'A picture', description: 'Drawn.', visual: 'chat-image' },
    { title: 'A diff', description: 'Under the turn.', visual: 'file-changes' },
    { title: 'A colour', description: 'On the crumb.', visual: 'session-color' },
  ],
};

let bridge: FakeBridge;
let queryClient: QueryClient;

beforeEach(() => {
  stub.release = AUTHORED;
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

describe('WhatsNewDialog', () => {
  it('shows the current version highlights when nothing was seen yet', async () => {
    const release = AUTHORED;
    renderDialog();
    await waitFor(() => {
      screen.getByRole('dialog', { name: "What's new" });
    });
    // By heading, not by text: the masthead's index names every feature too.
    screen.getByRole('heading', { name: release.highlights[0].title });
  });

  it('gives every authored highlight its own section, with its visual', async () => {
    const release = AUTHORED;
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

  it('draws the transcript visuals with the feature in them, not just a frame', async () => {
    const { container } = renderDialog();
    await waitFor(() => {
      screen.getByRole('dialog', { name: "What's new" });
    });
    // The picture is decoded by the browser, never by jsdom: what can be pinned
    // here is that it is an inline `data:` PNG and not a path the dialog would
    // have to read through `images:read` on a machine that does not have it.
    const img = container.querySelector<HTMLImageElement>('.cl-image-open img')!;
    expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    // The diff is open on the page, numbered where the fixture's patch says.
    expect(container.querySelector('.cl-file-change.is-edited')).not.toBeNull();
    expect(container.querySelector('.cl-diff-row')).not.toBeNull();
    // The colour is set on the frame and worn by the crumb, glow lit.
    expect(
      container.querySelector('.cl-session-aura.cyan .cl-session-identity.cyan')
    ).not.toBeNull();
    expect(container.querySelector('.cl-session-bottom-glow.is-active')).not.toBeNull();
  });

  it('marks the version seen and closes on "Got it"', async () => {
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

  it('stays silent on a release that authored nothing', async () => {
    stub.release = undefined;
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
