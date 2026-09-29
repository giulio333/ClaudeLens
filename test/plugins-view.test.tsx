// @vitest-environment jsdom
//
// The Plugins page. Which plugins exist, and whether each is on, is the
// reader's to decide (`plugins-reader.test.ts`); what only this side can prove
// is what the page says about it:
//
//   1. a plugin claude.ai syncs to the account sits under its own heading, apart
//      from the installed ones, and says where it came from;
//   2. a plugin Claude Code does not load says so, in the tree and on its page;
//   3. a synced plugin that shares its name and marketplace with an installed
//      one is its own entry — selecting one never opens the other.

import { StrictMode, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

import { PluginsView } from '../src/components/project/plugins/PluginsView';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';
import type { InstalledPlugin } from '../src/types';

function plugin(over: Partial<InstalledPlugin>): InstalledPlugin {
  return {
    name: 'tool',
    marketplace: 'mkt',
    scope: 'user',
    source: 'marketplace',
    enabled: true,
    version: '1.0.0',
    installPath: '/Users/alice/.claude/plugins/cache/mkt/tool/1.0.0',
    skills: [],
    agents: [],
    commands: [],
    mcpServers: [],
    hooks: [],
    ...over,
  };
}

const INSTALLED = plugin({ name: 'tool', description: 'Installed from a marketplace.' });
const OFF = plugin({ name: 'quiet', enabled: false, description: 'Turned off.' });
const SYNCED = plugin({
  name: 'data',
  marketplace: 'kw',
  source: 'synced',
  description: 'Synced to the account.',
  installPath:
    '/Users/alice/.claude/plugins/synced/0a1b2c3d-1111-4222-8333-444455556666_7e8f9a0b-7777-4888-9999-aaaabbbbcccc/data',
});

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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </StrictMode>
  );
  return render(<PluginsView onBack={() => {}} />, { wrapper });
}

const treeNode = (name: string) =>
  screen
    .getAllByRole('button')
    .find(b => b.classList.contains('cl-plugin-node') && within(b).queryByText(name))!;

describe('PluginsView', () => {
  it('puts synced plugins under their own heading, after the installed ones', async () => {
    bridge.api.plugins.getAll.mockResolvedValue(ok([INSTALLED, OFF, SYNCED]));

    const { container } = mount();

    await screen.findByText('Synced from claude.ai');
    const kickers = [...container.querySelectorAll('.cl-plugin-tree-kicker')].map(
      k => k.textContent
    );
    expect(kickers).toEqual(['Marketplaces', 'Synced from claude.ai']);
  });

  it('says a synced plugin comes from claude.ai, and hides the account folder in its path', async () => {
    bridge.api.plugins.getAll.mockResolvedValue(ok([INSTALLED, SYNCED]));

    mount();

    fireEvent.click(await screen.findByText('data'));
    expect(await screen.findByRole('heading', { name: 'data' })).toBeTruthy();
    expect(screen.getByText('Synced from claude.ai', { selector: '.val' })).toBeTruthy();
    expect(screen.getByText('synced/…/data')).toBeTruthy();
  });

  it('marks a plugin Claude Code does not load, in the tree and on its page', async () => {
    bridge.api.plugins.getAll.mockResolvedValue(ok([INSTALLED, OFF]));

    mount();

    await screen.findByText('quiet');
    expect(treeNode('quiet').classList.contains('is-off')).toBe(true);
    expect(within(treeNode('quiet')).getByText('off')).toBeTruthy();
    expect(treeNode('tool').classList.contains('is-off')).toBe(false);

    fireEvent.click(treeNode('quiet'));
    expect(await screen.findByText(/Claude Code does not load this plugin/)).toBeTruthy();
    fireEvent.click(treeNode('tool'));
    expect(screen.queryByText(/Claude Code does not load this plugin/)).toBeNull();
  });

  it('keeps a synced plugin apart from an installed one of the same name and marketplace', async () => {
    const twin = plugin({ name: 'data', marketplace: 'kw', description: 'The installed twin.' });
    bridge.api.plugins.getAll.mockResolvedValue(ok([twin, SYNCED]));

    mount();

    await screen.findByText('Synced from claude.ai');
    const nodes = screen.getAllByRole('button').filter(b => b.classList.contains('cl-plugin-node'));
    expect(nodes).toHaveLength(2);

    fireEvent.click(nodes[1]);
    expect(await screen.findByText('Synced to the account.')).toBeTruthy();
    expect(screen.queryByText('The installed twin.')).toBeNull();
    expect(nodes[1].getAttribute('aria-current')).toBe('true');
    expect(nodes[0].getAttribute('aria-current')).toBeNull();
  });

  it('lists a plugin with neither field as installed and on, never as off', async () => {
    // What a main process older than `source`/`enabled` sends: a dev run whose
    // Electron started before the rebuild landed. The tree went empty and the
    // first plugin read "Off" — a claim nothing on disk made.
    const legacy = plugin({ name: 'legacy', description: 'From an older main process.' });
    delete (legacy as Partial<InstalledPlugin>).source;
    delete (legacy as Partial<InstalledPlugin>).enabled;
    bridge.api.plugins.getAll.mockResolvedValue(ok([legacy]));

    const { container } = mount();

    expect(await screen.findByRole('heading', { name: 'legacy' })).toBeTruthy();
    expect(screen.getByText('Marketplaces')).toBeTruthy();
    expect(treeNode('legacy').classList.contains('is-off')).toBe(false);
    expect(screen.queryByText(/Claude Code does not load this plugin/)).toBeNull();
    expect(container.querySelector('.cl-plugin-node .off')).toBeNull();
  });
});
