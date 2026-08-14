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
// the requirement on that basis. These tests pin the source, not the layout.

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

describe('Settings → General · installed Claude Code', () => {
  it('prints the version the CLI reports, not the one the SDK handshake carries', async () => {
    bridge.api.updates.claudeCodeVersion.mockResolvedValue(ok({ version: INSTALLED_VERSION }));

    renderGeneral();

    await waitFor(() => expect(screen.getByText(INSTALLED_VERSION)).toBeTruthy());
    expect(screen.queryByText(SDK_BUNDLED_VERSION)).toBeNull();
  });

  it('says the CLI could not be read instead of falling back to the SDK version', async () => {
    bridge.api.updates.claudeCodeVersion.mockResolvedValue(fail(`'claude' CLI not found in PATH.`));

    renderGeneral();

    await waitFor(() => expect(screen.getByText('not found in PATH')).toBeTruthy());
    expect(screen.queryByText(SDK_BUNDLED_VERSION)).toBeNull();
  });
});
