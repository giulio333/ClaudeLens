// @vitest-environment jsdom
//
// Settings → General prints "which Claude Code do I have installed?". There are
// two numbers in the app that could answer it and only one is right:
//
//   - `init.claudeCodeVersion`, from the Agent SDK `system/init` handshake — the
//     CLI bundled inside the `@anthropic-ai/claude-agent-sdk` THIS BUILD SHIPS.
//     It never moves when the user updates their own CLI.
//   - `updates:claudeCodeVersion`, which runs `claude --version` on PATH.
//
// The page used to read the first and print it as the installed version, so a
// user on CLI 2.1.229 was told 2.1.220 (the shipped SDK's) and judged against
// the requirement on that basis.
//
// Both numbers are now on the page, because both are real: "Claude Code" is what
// the user's terminal runs, "Bundled CLI" is what the in-app chat runs. What must
// never happen again is one standing in for the other, so these tests pin which
// row each number lands in — and that only the installed one carries the verdict.
// They pin the source, not the layout.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { GeneralTab } from '../src/components/project/settings/SettingsView';
import type { EffectiveConfig } from '../src/hooks/useIPC';
import { installFakeElectronAPI, ok, fail, type FakeBridge } from './helpers/fake-electron-api';

/** What the SDK handshake claims — deliberately different from the CLI's answer. */
const SDK_BUNDLED_VERSION = '2.1.220';
const INSTALLED_VERSION = '2.1.229';

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

function config(): EffectiveConfig {
  return {
    cwd: '/Users/alice',
    init: {
      permissionMode: 'default',
      model: 'claude-opus-5',
      cwd: '/Users/alice',
      apiKeySource: 'subscription',
      claudeCodeVersion: SDK_BUNDLED_VERSION,
      tools: [],
      mcpServers: [],
      slashCommands: [],
      outputStyle: '',
      skills: [],
      agents: [],
      plugins: [],
    },
    initError: null,
    effective: {},
    provenance: {},
    sources: [],
    settingsError: null,
  };
}

function renderGeneral() {
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(GeneralTab, { cfg: config(), q: '' })
    )
  );
}

/** The `.set-row` a datasheet label belongs to, so a number can be read in place. */
function row(label: string): HTMLElement {
  const el = screen.getByText(label).closest('.set-row');
  if (!el) throw new Error(`no datasheet row labelled "${label}"`);
  return el as HTMLElement;
}

describe('Settings → General · installed Claude Code', () => {
  it('prints the CLI version in the installed row and the SDK one in the bundled row', async () => {
    bridge.api.updates.claudeCodeVersion.mockResolvedValue(ok({ version: INSTALLED_VERSION }));

    renderGeneral();

    await waitFor(() => expect(row('Claude Code').textContent).toContain(INSTALLED_VERSION));
    // The handshake number is shown, but only ever as the bundled CLI.
    expect(row('Claude Code').textContent).not.toContain(SDK_BUNDLED_VERSION);
    expect(row('Bundled CLI').textContent).toContain(SDK_BUNDLED_VERSION);
    expect(row('Bundled CLI').textContent).not.toContain(INSTALLED_VERSION);
  });

  it('judges the requirement on the installed version, never on the bundled one', async () => {
    // Installed satisfies the requirement; the bundled CLI is older than it and
    // must not drag an "outdated" verdict onto the page — a new ClaudeLens is
    // the only thing that moves that number.
    bridge.api.updates.claudeCodeVersion.mockResolvedValue(ok({ version: '9.9.9' }));

    renderGeneral();

    await waitFor(() => expect(row('Claude Code').textContent).toContain('9.9.9'));
    expect(screen.queryByText('outdated')).toBeNull();
  });

  it('says the CLI could not be read instead of falling back to the SDK version', async () => {
    bridge.api.updates.claudeCodeVersion.mockResolvedValue(fail(`'claude' CLI not found in PATH.`));

    renderGeneral();

    await waitFor(() => expect(screen.getByText('not found in PATH')).toBeTruthy());
    expect(row('Claude Code').textContent).not.toContain(SDK_BUNDLED_VERSION);
  });
});
