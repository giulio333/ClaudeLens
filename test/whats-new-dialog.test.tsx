// @vitest-environment jsdom
//
// The "What's new" popup (src/components/WhatsNewDialog.tsx): shown once per
// app version on first launch after an update, dismissed for good by writing
// the current version to prefs (`cl-whatsnew-seen-version`) — the same
// per-version dismissal shape as the update banner's "skip this version".

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, StrictMode } from 'react';
import { WhatsNewDialog } from '../src/components/WhatsNewDialog';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';
import { version as appVersion } from '../package.json';
import { openWhatsNew, WHATS_NEW, type WhatsNewRelease } from '../src/data/whats-new';
import { compareVersions } from '../electron/shared/version-compare';

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
    { title: 'The files read', description: 'On the edge.', visual: 'context-rail' },
    { title: 'A note', description: 'Inline.', visual: 'thinking-note' },
    { title: 'A model', description: 'Priced.', visual: 'model-picker' },
    { title: 'A host', description: 'Beta.', visual: 'remote' },
    { title: 'A shell', description: 'In the top bar.', visual: 'background-shells' },
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
    // Each section is a stop on the thread, and the card opens on the first.
    expect(container.querySelectorAll('.cl-whatsnew-stop .cl-whatsnew-dot')).toHaveLength(
      release.highlights.length
    );
    const lit = container.querySelectorAll('.cl-whatsnew-item.is-current');
    expect(lit).toHaveLength(1);
    expect(lit[0]).toBe(container.querySelector('.cl-whatsnew-item'));
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
    // The rail lists the files the preview's own turns read — four, one dot
    // each, the last turn's two lit — and opens on that list, not on dots.
    const rail = container.querySelector('.cl-whatsnew-frame--rail .cl-ctx-rail')!;
    expect(rail.querySelectorAll('.cl-ctx-dot')).toHaveLength(4);
    expect(rail.querySelectorAll('.cl-ctx-dot.is-active')).toHaveLength(2);
    expect(rail.querySelector('.cl-ctx-panel.is-open')).not.toBeNull();
    expect([...rail.querySelectorAll('.cl-ctx-row .name')].map(n => n.textContent)).toEqual(
      expect.arrayContaining(['retry.ts', 'config.ts', 'retry.test.ts', 'package.json'])
    );
    // The thinking note is drawn in MIN, labelled, before the answer.
    const note = container.querySelector('.cl-thinking-note');
    expect(note?.querySelector('.cl-thinking-note-tag')?.textContent).toBe('Thinking');
    expect(note?.textContent).toContain('The loop is wrong, not the tests.');
    // The Model picker is open on the session's Opus 5.5, and every alias says
    // which version it runs on — `opus` still meaning Opus 5.
    const menu = container.querySelector('.cl-whatsnew-frame--composer .cl-composer-menu')!;
    const items = [...menu.querySelectorAll('.cl-composer-menu-item-label')].map(
      n => n.textContent
    );
    expect(items).toEqual([
      'Opus 5.5',
      'Sonnet 5',
      'Opus 5',
      'Haiku 4.5',
      'Fable 5.1',
      'Default · Opus 5.5',
    ]);
    expect(menu.querySelector('.is-active')?.textContent).toBe('Opus 5.5');
    // The remote pane says where the session runs, and that Remote is a beta.
    const remote = container.querySelector('.cl-whatsnew-frame--remote')!;
    expect(remote.textContent).toContain('RUNNING ON BUILD SERVER');
    const banner = remote.querySelector('[role="note"]')!;
    expect(banner.textContent).toContain('Remote · dev@build.example.com');
    expect(banner.querySelector('.cl-beta')?.textContent).toBe('Beta');
    // The pill counts the running shell and its minutes, measured from when the
    // popup opened — never from a date written into the preview — and opens on
    // the running shell and the one that just ended.
    const pill = container.querySelector<HTMLButtonElement>(
      '.cl-whatsnew-frame--shells .cl-bgshell-pill'
    )!;
    expect(pill.textContent).toBe('1 in background· 12 min');
    fireEvent.click(pill);
    const list = [...document.querySelectorAll('.cl-bgshell-item-title')].map(n => n.textContent);
    expect(list).toEqual(['Start the dev server', 'Build the app']);
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

  it('dismisses on Escape, like "Got it"', async () => {
    renderDialog();
    await waitFor(() => {
      screen.getByRole('dialog', { name: "What's new" });
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(bridge.api.prefs.set).toHaveBeenCalledWith('cl-whatsnew-seen-version', appVersion);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: "What's new" })).toBeNull();
    });
  });

  it('leaves Escape to a modal a preview opened on top of it', async () => {
    renderDialog();
    await waitFor(() => {
      screen.getByRole('dialog', { name: "What's new" });
    });
    const sheet = document.createElement('div');
    sheet.setAttribute('aria-modal', 'true');
    document.body.appendChild(sheet);
    try {
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(bridge.api.prefs.set).not.toHaveBeenCalled();
      screen.getByRole('dialog', { name: "What's new" });
    } finally {
      sheet.remove();
    }
  });

  it('lists the releases skipped since the last one seen, folded until asked', async () => {
    const seen = '0.0.1';
    bridge.api.prefs.getAll = vi.fn(async () =>
      ok<Record<string, unknown>>({ 'cl-whatsnew-seen-version': seen })
    );
    const { container } = renderDialog();
    await waitFor(() => {
      screen.getByRole('dialog', { name: "What's new" });
    });
    const skipped = WHATS_NEW.filter(
      r => compareVersions(r.version, seen) > 0 && compareVersions(r.version, appVersion) < 0
    );
    expect(container.querySelector('.cl-whatsnew-earlier-title')?.textContent).toBe(
      `Also new since ${seen}`
    );
    const heads = container.querySelectorAll<HTMLElement>('.cl-whatsnew-past-head');
    expect([...heads].map(h => h.querySelector('.version')?.textContent)).toEqual(
      skipped.map(r => r.version)
    );
    // Folded: none of their screens is mounted.
    expect(container.querySelector('.cl-whatsnew-past-body')).toBeNull();

    fireEvent.click(heads[0]);
    expect(heads[0].getAttribute('aria-expanded')).toBe('true');
    for (const h of skipped[0].highlights) screen.getByRole('heading', { name: h.title });
  });

  it('reopens from Settings after it was dismissed, with every release before it', async () => {
    bridge.api.prefs.getAll = vi.fn(async () =>
      ok<Record<string, unknown>>({ 'cl-whatsnew-seen-version': appVersion })
    );
    const { container } = renderDialog();
    await waitFor(() => {
      expect(bridge.api.prefs.getAll).toHaveBeenCalled();
    });
    expect(screen.queryByRole('dialog', { name: "What's new" })).toBeNull();

    act(() => openWhatsNew());
    await waitFor(() => {
      screen.getByRole('dialog', { name: "What's new" });
    });
    expect(container.querySelector('.cl-whatsnew-title')?.textContent).toContain(appVersion);
    expect(container.querySelector('.cl-whatsnew-earlier-title')?.textContent).toBe(
      'Earlier releases'
    );
    expect(container.querySelectorAll('.cl-whatsnew-past')).toHaveLength(
      WHATS_NEW.filter(r => compareVersions(r.version, appVersion) < 0).length
    );

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: "What's new" })).toBeNull();
    });
  });
});
