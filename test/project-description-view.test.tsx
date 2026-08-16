// @vitest-environment jsdom
//
// The description line under the project name. The derivation itself is unit
// tested (`project-description.test.ts`); what only this side can prove is the
// contract between the two sources:
//
//   1. the project's CLAUDE.md is a SOURCE — an edit here is stored in
//      ClaudeLens' prefs (`cl-project-descriptions`) and never written back to
//      that file, which is why there is no writer IPC to call at all;
//   2. clearing the field falls back to the derived text instead of leaving the
//      project blank, so the file keeps working as the default.

import { createElement, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

import { ProjectDescription } from '../src/components/project/overview/ProjectDescription';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

const PROJECT = { hash: '-Users-alice-Projects-acme', realPath: '/Users/alice/Projects/acme' };

const DERIVED = {
  text: 'Acme is the billing pipeline behind the storefront.',
  source: 'lead' as const,
  filePath: '/Users/alice/Projects/acme/CLAUDE.md',
};

let bridge: FakeBridge;
let queryClient: QueryClient;

beforeEach(() => {
  localStorage.clear();
  bridge = installFakeElectronAPI();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  bridge.restore();
  localStorage.clear();
});

function mount() {
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ProjectDescription, PROJECT)
    ) as ReactNode
  );
}

// The sentence itself is the edit trigger — there is no separate Edit button.
const descriptionButton = (text: string | RegExp) => screen.getByRole('button', { name: text });

describe('ProjectDescription', () => {
  it('shows the sentence derived from CLAUDE.md, naming the file in its tooltip', async () => {
    bridge.api.projects.getDescription.mockResolvedValue(ok(DERIVED));
    mount();

    expect(await screen.findByText(DERIVED.text)).toBeTruthy();
    expect(descriptionButton(DERIVED.text).title).toContain(DERIVED.filePath);
    expect(bridge.api.projects.getDescription).toHaveBeenCalledWith(PROJECT.realPath);
  });

  it('invites a description when the project has no CLAUDE.md to derive one from', async () => {
    bridge.api.projects.getDescription.mockResolvedValue(ok(null));
    mount();

    expect(await screen.findByRole('button', { name: /add a description/i })).toBeTruthy();
  });

  it('stores an edit in the prefs, keyed by project hash, and never in CLAUDE.md', async () => {
    bridge.api.projects.getDescription.mockResolvedValue(ok(DERIVED));
    mount();
    await screen.findByText(DERIVED.text);

    fireEvent.click(descriptionButton(DERIVED.text));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'What we actually call it internally.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('What we actually call it internally.')).toBeTruthy();
    // The prefs store is the only writer reached — the bridge exposes no
    // CLAUDE.md write for this component to call even by accident.
    expect(bridge.api.prefs.set).toHaveBeenCalledWith('cl-project-descriptions', {
      [PROJECT.hash]: 'What we actually call it internally.',
    });
    // The user's wording wins, and the tooltip stops pointing at the file.
    expect(descriptionButton(/what we actually call it/i).title).not.toContain('CLAUDE.md');
  });

  it('falls back to the derived text when the edit is dropped', async () => {
    bridge.api.projects.getDescription.mockResolvedValue(ok(DERIVED));
    mount();
    await screen.findByText(DERIVED.text);

    fireEvent.click(descriptionButton(DERIVED.text));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await screen.findByText('Mine');

    fireEvent.click(descriptionButton('Mine'));
    fireEvent.click(screen.getByRole('button', { name: /use claude\.md/i }));

    await waitFor(() => expect(screen.getByText(DERIVED.text)).toBeTruthy());
    expect(bridge.api.prefs.set).toHaveBeenLastCalledWith('cl-project-descriptions', {});
  });

  it('does not freeze the derived sentence into the prefs when it is saved unchanged', async () => {
    bridge.api.projects.getDescription.mockResolvedValue(ok(DERIVED));
    mount();
    await screen.findByText(DERIVED.text);

    fireEvent.click(descriptionButton(DERIVED.text));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(bridge.api.prefs.set).toHaveBeenCalledWith('cl-project-descriptions', {})
    );
    expect(descriptionButton(DERIVED.text).title).toContain(DERIVED.filePath);
  });

  it('leaves the text untouched when the edit is cancelled', async () => {
    bridge.api.projects.getDescription.mockResolvedValue(ok(DERIVED));
    mount();
    await screen.findByText(DERIVED.text);

    fireEvent.click(descriptionButton(DERIVED.text));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Discarded' } });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(await screen.findByText(DERIVED.text)).toBeTruthy();
    expect(bridge.api.prefs.set).not.toHaveBeenCalled();
  });
});
