// @vitest-environment jsdom
//
// A project's Config page answers one question the global page cannot: what does
// this repository change? The resolved configuration alone does not say — forty
// rows, of which two came from the project — so the page names each settings
// file with what it sets, and a filter reduces the ledger to the project's own.
//
// Pinned here: the tape tells the truth about the three files (including the one
// that sets nothing), the filter shows what the project's files wrote and hides
// the rest, and the two things that are not settings — the CLAUDE.md cascade and
// the Danger zone — stay reachable either way.

import { createElement, StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ProjectConfigView } from '../src/components/project/settings/ProjectConfigView';
import type { EffectiveConfig } from '../src/hooks/useIPC';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

const HOME = '/Users/alice';
const PROJECT = { hash: '-Users-alice-Projects-acme', realPath: `${HOME}/Projects/acme` };

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

function config(overrides: Partial<EffectiveConfig> = {}): EffectiveConfig {
  const userFile = `${HOME}/.claude/settings.json`;
  const projectFile = `${PROJECT.realPath}/.claude/settings.json`;
  return {
    cwd: PROJECT.realPath,
    init: {
      permissionMode: 'default',
      model: 'claude-opus-5',
      cwd: PROJECT.realPath,
      apiKeySource: 'subscription',
      claudeCodeVersion: '2.1.220',
      cliSource: 'bundled',
      tools: ['Read', 'Write'],
      mcpServers: [],
      slashCommands: [],
      outputStyle: '',
      skills: [],
      agents: [],
      plugins: [],
      models: [],
    },
    initError: null,
    effective: {
      model: 'claude-opus-5',
      cleanupPeriodDays: 30,
      permissions: {
        allow: ['Read(~/notes/**)', 'Bash(npm test)', 'Bash(npm run lint)'],
        deny: ['Read(./.env)'],
      },
    },
    provenance: {
      model: { source: 'project', path: projectFile },
      cleanupPeriodDays: { source: 'user', path: userFile },
      permissions: { source: 'project', path: projectFile },
    },
    sources: [
      {
        source: 'user',
        path: userFile,
        settings: { cleanupPeriodDays: 30, permissions: { allow: ['Read(~/notes/**)'] } },
      },
      {
        source: 'project',
        path: projectFile,
        settings: {
          model: 'claude-opus-5',
          permissions: { allow: ['Bash(npm test)', 'Bash(npm run lint)'], deny: ['Read(./.env)'] },
        },
      },
    ],
    settingsError: null,
    ...overrides,
  };
}

function mount(cfg: EffectiveConfig = config()) {
  bridge.api.config.getEffective.mockResolvedValue(ok(cfg));
  return render(
    createElement(
      StrictMode,
      null,
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ProjectConfigView, {
          project: PROJECT,
          onNavigate: () => {},
          onDeleteProject: () => {},
        })
      )
    )
  );
}

/** The tape cell of a settings tier, found by the tier's pill. */
function tier(label: string): HTMLElement {
  const cell = screen.getByText(label, { selector: '.tier' }).closest('.cell');
  if (!cell) throw new Error(`no settings tier labelled "${label}"`);
  return cell as HTMLElement;
}

async function settled() {
  await waitFor(() => expect(screen.getByText(/settings files/i)).toBeTruthy());
}

describe('project config · the settings files', () => {
  it('names each file and how much it sets', async () => {
    mount();
    await settled();

    expect(tier('User').textContent).toContain('~/.claude/settings.json');
    expect(tier('User').textContent).toContain('2 keys');
    // Relative to the project: the path is the project's own file, not a place
    // under the home that happens to share its tail.
    expect(within(tier('Project')).getByText('.claude/settings.json')).toBeTruthy();
    expect(tier('Project').textContent).toContain('2 keys');
  });

  it('keeps the tier that sets nothing on the tape, and says so', async () => {
    // No `settings.local.json`: a missing cell would read as "not checked".
    mount();
    await settled();

    expect(tier('Local').textContent).toContain('sets nothing');
    expect(tier('Local').className).toContain('is-empty');
  });

  it('stamps a project value apart from an inherited one', async () => {
    mount();
    await settled();

    const stamp = (label: string) =>
      screen.getByText(label).closest('.set-row')?.querySelector('.set-src');
    expect(stamp('Configured model')?.textContent).toBe('Project');
    expect(stamp('Configured model')?.className).toContain('here');
    expect(stamp('Transcript retention')?.textContent).toBe('User');
    expect(stamp('Transcript retention')?.className).not.toContain('here');
  });
});

describe('project config · the project filter', () => {
  it('opens on the whole resolved configuration', async () => {
    mount();
    await settled();

    for (const domain of ['General', 'Permissions', 'Tools', 'MCP servers', 'Extensions']) {
      expect(screen.getByRole('heading', { name: domain })).toBeTruthy();
    }
    expect(screen.queryByRole('heading', { name: 'Set by this project' })).toBeNull();
  });

  it('reduces the ledger to what the project’s files set', async () => {
    mount();
    await settled();

    fireEvent.click(screen.getByRole('button', { name: 'This project' }));

    const domain = screen
      .getByRole('heading', { name: 'Set by this project' })
      .closest('.cl-ledger-domain') as HTMLElement;
    const rows = [...domain.querySelectorAll('.set-row')].map(r => r.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Configured model');
    expect(rows[0]).toContain('claude-opus-5');
    // The project's own rules — the user's one extra `allow` is not its doing.
    expect(rows[1]).toContain('Permissions');
    expect(rows[1]).toContain('2 allow · 1 deny');
    // The resolved datasheet steps aside rather than repeating those values.
    expect(screen.queryByRole('heading', { name: 'General' })).toBeNull();
    expect(screen.queryByText('Transcript retention')).toBeNull();
  });

  it('says so when the project sets nothing', async () => {
    const cfg = config();
    mount({ ...cfg, sources: [cfg.sources[0]] });
    await settled();

    fireEvent.click(screen.getByRole('button', { name: 'This project' }));

    expect(screen.getByText(/nothing is set by this project/i)).toBeTruthy();
    expect(tier('Project').textContent).toContain('sets nothing');
  });

  it('keeps CLAUDE.md and the Danger zone reachable in both readings', async () => {
    bridge.api.claudeMd.getHierarchy.mockResolvedValue(
      ok({
        layers: [
          {
            scope: 'project' as const,
            filePath: `${PROJECT.realPath}/CLAUDE.md`,
            content: 'a\nb\nc',
          },
        ],
      })
    );
    mount();
    await settled();
    await waitFor(() => expect(screen.getByText('1 layer', { exact: false })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'This project' }));

    expect(screen.getByRole('heading', { name: 'CLAUDE.md' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /CLAUDE\.md.*3 lines/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /delete state/i })).toBeTruthy();
  });
});
