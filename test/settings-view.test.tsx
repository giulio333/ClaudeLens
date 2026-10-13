// @vitest-environment jsdom
//
// The Settings page keeps two kinds of thing: ClaudeLens' own preferences, which
// are edited here, and Claude Code's resolved configuration, which is only read.
// They used to share one flat rail and one tab ("General" carried both), and the
// only thing telling them apart was an "editable" chip on one block.
//
// What is pinned here is that separation — which tabs exist and under which
// owner, that General holds nothing read-only, that the datasheet it used to
// carry is the Runtime tab — and that the controls on the editable side still
// reach the stores they write to. Not the layout.

import { createElement, StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SettingsView } from '../src/components/project/settings/SettingsView';
import { ThemeContext, type ThemeContextValue } from '../src/hooks/useTheme';
import type { EffectiveConfig } from '../src/hooks/useIPC';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

let bridge: FakeBridge;
let queryClient: QueryClient;
let theme: ThemeContextValue;

beforeEach(() => {
  bridge = installFakeElectronAPI();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  theme = { preference: 'light', resolved: 'light', setPreference: vi.fn() };
});

afterEach(() => {
  cleanup();
  bridge.restore();
});

function config(): EffectiveConfig {
  return {
    cwd: '/Users/alice',
    init: {
      permissionMode: 'default',
      model: 'claude-opus-5',
      cwd: '/Users/alice',
      apiKeySource: 'subscription',
      claudeCodeVersion: '2.1.220',
      cliSource: 'bundled',
      tools: ['Read', 'Write', 'Edit'],
      mcpServers: [],
      slashCommands: [],
      outputStyle: '',
      skills: [],
      agents: [],
      plugins: [],
      models: [],
    },
    initError: null,
    effective: {},
    provenance: {},
    sources: [],
    settingsError: null,
  };
}

function mount() {
  bridge.api.config.getEffective.mockResolvedValue(ok(config()));
  return render(
    createElement(
      StrictMode,
      null,
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          ThemeContext.Provider,
          { value: theme },
          createElement(SettingsView, { onBack: () => {} })
        )
      )
    )
  );
}

function rail(): HTMLElement {
  return screen.getByRole('complementary', { name: 'Settings sections' });
}

/** A rail item, found by its label: its accessible name also carries the count. */
function tab(name: string): HTMLElement {
  const button = within(rail()).getByText(name, { selector: '.lbl' }).closest('button');
  if (!button) throw new Error(`no rail item labelled "${name}"`);
  return button;
}

describe('Settings · the rail', () => {
  it('lists the app’s own tabs apart from Claude Code’s', () => {
    mount();

    const labels = within(rail())
      .getAllByRole('button')
      .map(b => b.querySelector('.lbl')?.textContent);
    expect(labels).toEqual([
      'General',
      'Privacy',
      'AI',
      'Runtime',
      'Permissions',
      'Tools',
      'MCP servers',
      'Extensions',
    ]);
    // The two owners are named, and the read-only one says it is.
    expect(within(rail()).getByText('ClaudeLens')).toBeTruthy();
    expect(within(rail()).getByText('Claude Code')).toBeTruthy();
    expect(within(rail()).getByText('read-only')).toBeTruthy();
  });

  it('carries a tab’s count once, on the rail', async () => {
    mount();

    await waitFor(() => expect(tab('Tools').querySelector('.ct')?.textContent).toBe('3'));
    fireEvent.click(tab('Tools'));

    // The panel head used to repeat it ("3 tools") one glance to the right.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Tools' })).toBeTruthy());
    expect(screen.queryByText('3 tools')).toBeNull();
  });

  it('leaves a count off until it is known, instead of printing a zero', () => {
    // Nothing has resolved on the first frame: a `0` here would be a claim.
    mount();

    expect(tab('Tools').querySelector('.ct')).toBeNull();
    expect(tab('Extensions').querySelector('.ct')).toBeNull();
  });
});

describe('Settings · General', () => {
  it('holds what ClaudeLens owns and none of the resolved datasheet', async () => {
    mount();

    expect(screen.getByRole('heading', { name: 'General' })).toBeTruthy();
    for (const block of ['Appearance', 'Notifications', 'Updates']) {
      expect(screen.getByText(block)).toBeTruthy();
    }
    // Let the config land: the datasheet must stay off this page once it could
    // be drawn, not merely before the data arrives.
    await waitFor(() => expect(screen.getByText('Opus 5')).toBeTruthy());
    expect(screen.queryByText('Bundled CLI')).toBeNull();
    expect(screen.queryByText('Claude Code preferences')).toBeNull();
  });

  it('moves the resolved datasheet to Runtime, where nothing can be switched', async () => {
    mount();

    fireEvent.click(tab('Runtime'));

    await waitFor(() => expect(screen.getByText('Bundled CLI')).toBeTruthy());
    expect(screen.getByText('Claude Code preferences')).toBeTruthy();
    expect(screen.queryAllByRole('switch')).toEqual([]);
  });

  it('writes a notification preference and shows the new state', async () => {
    mount();

    const toggle = screen.getByRole('switch', { name: 'Show notifications' });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(bridge.api.prefs.set).toHaveBeenCalledWith('cl-notify-enabled', false)
    );
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    // The state is spelled out on the control — the tint is never the only signal.
    expect(toggle.textContent).toBe('Off');
  });

  it('locks the OS notification switch while notifications are off', async () => {
    bridge.api.prefs.getAll.mockResolvedValue(ok({ 'cl-notify-enabled': false }));
    mount();

    const os = screen.getByRole('switch', { name: 'Native OS notifications' });
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Show notifications' }).getAttribute('aria-checked')
      ).toBe('false')
    );
    expect((os as HTMLButtonElement).disabled).toBe(true);
  });

  it('sets the theme from the segmented control', () => {
    mount();

    const group = screen.getByRole('group', { name: 'Theme' });
    expect(within(group).getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe(
      'true'
    );

    fireEvent.click(within(group).getByRole('button', { name: 'Dark' }));

    expect(theme.setPreference).toHaveBeenCalledWith('dark');
  });
});

describe('Settings · Privacy', () => {
  it('turns usage analytics off through the telemetry bridge', async () => {
    mount();
    fireEvent.click(tab('Privacy'));

    const toggle = await screen.findByRole('switch', { name: 'Share anonymous usage data' });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(toggle);

    await waitFor(() => expect(bridge.api.telemetry.setEnabled).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.getByText('Nothing is sent.')).toBeTruthy());
  });
});
