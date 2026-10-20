// @vitest-environment jsdom
//
// The TOOLKIT panel in Mission Control's rail: what the SDK handshake says the
// project loads, against what the session called. The claims: no handshake, no
// icon; a failed MCP server puts a mark on the icon and its group in the panel,
// while a server waiting for auth is not listed; a skill or agent the session
// called leads its section with its ×N from the transcript and the rest folds
// under a count; a row with a definition opens it, one without is no button;
// Escape closes the panel and hands focus back to the icon; and the strip under
// the feed now names the branch only.

import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChatMessage, EffectiveConfig, InitInfo } from '../src/types';
import type { Skill } from '../src/hooks/useIPC';
import { ThemeContext } from '../src/hooks/useTheme';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

const ROOT = '/projects/acme';

const call = (id: string, name: string, input: Record<string, unknown>, n: number) => [
  {
    uuid: `a${n}`,
    role: 'assistant' as const,
    timestamp: `2026-10-05T10:00:0${n}.000Z`,
    gitBranch: 'feature-x',
    content: [{ type: 'tool_use' as const, id, name, input }],
  },
  {
    uuid: `u${n}`,
    role: 'user' as const,
    timestamp: `2026-10-05T10:00:0${n}.500Z`,
    content: [{ type: 'tool_result' as const, toolUseId: id, content: 'done', isError: false }],
  },
];

/** The session calls the `alpha:draft` skill twice and the Explore agent once. */
const CHAT: ChatMessage[] = [
  ...call('t1', 'Skill', { skill: 'alpha:draft' }, 1),
  ...call('t2', 'Agent', { subagent_type: 'Explore', description: 'look', prompt: 'p' }, 2),
  ...call('t3', 'Skill', { skill: 'alpha:draft' }, 3),
] as ChatMessage[];

const INIT: InitInfo = {
  permissionMode: 'default',
  model: 'claude-opus-5-5',
  cwd: ROOT,
  apiKeySource: 'none',
  claudeCodeVersion: '2.1.283',
  cliSource: 'bundled',
  tools: ['Read', 'Bash', 'Edit'],
  mcpServers: [
    { name: 'plugin:gamma:first', status: 'failed', source: 'plugin' },
    { name: 'local-db', status: 'failed', source: 'project' },
    { name: 'claude.ai Mail', status: 'needs-auth', source: 'claudeai' },
  ],
  slashCommands: [],
  outputStyle: 'default',
  skills: ['alpha:draft', 'beta', 'delta'],
  agents: ['Explore', 'Plan'],
  plugins: [],
  models: [],
};

const config = (init: InitInfo | null): EffectiveConfig =>
  ({
    cwd: ROOT,
    init,
    initError: null,
    effective: {},
    provenance: {},
    sources: [],
    settingsError: null,
  }) as EffectiveConfig;

const BETA: Skill = {
  name: 'beta',
  path: `${ROOT}/.claude/skills/beta/SKILL.md`,
  scope: 'project',
  content: '',
  rawContent: '',
  description: 'Writes the beta notes',
};

let bridge: FakeBridge;
let client: QueryClient;
let MissionRail: typeof import('../src/components/project/terminal/MissionRail').MissionRail;
let onOpenSkillDef: ReturnType<typeof vi.fn<(skill: Skill) => void>>;

beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  ({ MissionRail } = await import('../src/components/project/terminal/MissionRail'));
  bridge = installFakeElectronAPI();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  onOpenSkillDef = vi.fn<(skill: Skill) => void>();
  bridge.api.sessions.getChat.mockResolvedValue(ok(CHAT));
  bridge.api.config.getEffective.mockResolvedValue(ok(config(INIT)));
  Object.assign(bridge.api.sessions, { getSubagents: vi.fn(async () => ok([])) });
  Object.assign(bridge.api, {
    tasks: { getByProject: vi.fn(async () => ok([])) },
    teams: { getByProject: vi.fn(async () => ok([])) },
    skills: { getAll: vi.fn(async () => ok([BETA])) },
    plugins: { getAll: vi.fn(async () => ok([])) },
    agents: {
      getGlobal: vi.fn(async () => ok([])),
      getByProject: vi.fn(async () => ok([])),
    },
  });
  Object.assign(bridge.api.memory, { getProject: vi.fn(async () => ok(null)) });
});

afterEach(() => {
  cleanup();
  client.clear();
  bridge.restore();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountRail(remote?: React.ComponentProps<typeof MissionRail>['remote']) {
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <ThemeContext.Provider
          value={{ preference: 'light', resolved: 'light', setPreference: vi.fn() }}
        >
          <MissionRail
            hash="project-a"
            sessionId="session-a"
            realPath={ROOT}
            width={380}
            onWidthChange={vi.fn()}
            onOpenTool={vi.fn()}
            onOpenChange={vi.fn()}
            onOpenAgent={vi.fn()}
            onOpenSkillDef={onOpenSkillDef}
            onOpenAgentDef={vi.fn()}
            onOpenTeam={vi.fn()}
            onLocateTurn={vi.fn()}
            onUsePrompt={vi.fn(async () => {})}
            onOpenFile={vi.fn()}
            remote={remote}
          />
        </ThemeContext.Provider>
      </QueryClientProvider>
    </StrictMode>
  );
}

const icon = () => screen.findByRole('button', { name: /^Toolkit/ });
const panel = () => screen.findByRole('region', { name: 'Toolkit' });

it('marks the icon when a server failed, and lists the failed ones only', async () => {
  mountRail();
  const trigger = await icon();
  expect(trigger.getAttribute('aria-label')).toBe('Toolkit — 2 MCP servers failed to connect');
  expect(trigger.querySelector('.cl-toolkit-alert')).toBeTruthy();
  fireEvent.click(trigger);
  const mcp = within(await panel()).getByRole('region', { name: 'mcp' });
  expect(mcp.textContent).toContain('2 failed');
  expect(mcp.textContent).toContain('PLUGIN · GAMMA');
  expect(mcp.textContent).toContain('first');
  expect(mcp.textContent).toContain('CONFIGURED · PROJECT');
  expect(mcp.textContent).toContain('local-db');
  expect(mcp.textContent).not.toContain('claude.ai Mail');
  expect(mcp.textContent).not.toContain('plugin:');
  expect(screen.getByText('TOOLKIT')).toBeTruthy();
});

it('leads with what the session called and folds the rest under a count', async () => {
  mountRail();
  fireEvent.click(await icon());
  const region = await panel();
  const skills = within(region).getByRole('region', { name: 'skills' });
  await waitFor(() => expect(skills.textContent).toContain('×2'));
  expect(skills.textContent).toContain('3 · 1 used');
  expect(skills.textContent).toContain('alpha:draft');
  expect(skills.textContent).not.toContain('beta');
  fireEvent.click(within(skills).getByRole('button', { name: /2 available/ }));
  expect(skills.textContent).toContain('beta');
  expect(skills.textContent).toContain('delta');
  const agents = within(region).getByRole('region', { name: 'agents' });
  expect(agents.textContent).toContain('Explore');
  expect(agents.textContent).toContain('×1');
  const tools = within(region).getByRole('region', { name: 'tools' });
  expect(tools.textContent).toContain('3 built-in');
});

it('opens a definition when one resolves, and offers no button when none does', async () => {
  mountRail();
  fireEvent.click(await icon());
  const skills = within(await panel()).getByRole('region', { name: 'skills' });
  fireEvent.click(within(skills).getByRole('button', { name: /2 available/ }));
  await waitFor(() => expect(within(skills).getByRole('button', { name: 'beta' })).toBeTruthy());
  fireEvent.click(within(skills).getByRole('button', { name: 'beta' }));
  expect(onOpenSkillDef).toHaveBeenCalledWith(BETA);
  // `delta` has no definition on disk: a plain row, not a promise of a page.
  expect(within(skills).queryByRole('button', { name: 'delta' })).toBeNull();
  expect(within(skills).getByText('delta')).toBeTruthy();
});

it('closes on Escape and hands focus back to the icon', async () => {
  mountRail();
  const trigger = await icon();
  fireEvent.click(trigger);
  fireEvent.keyDown(await panel(), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Toolkit' })).toBeNull());
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByText('MISSION CONTROL')).toBeTruthy();
});

it('names the branch alone under the feed', async () => {
  mountRail();
  await icon();
  const branch = await screen.findByLabelText('Git branch feature-x');
  const strip = branch.closest('.shrink-0') as HTMLElement;
  expect(strip.textContent).toBe('feature-x');
  expect(screen.queryByText('DEFAULT')).toBeNull();
});

it('offers no toolkit before the handshake answers', async () => {
  bridge.api.config.getEffective.mockResolvedValue(ok(config(null)));
  mountRail();
  await screen.findByText('MISSION CONTROL');
  await waitFor(() => expect(bridge.api.config.getEffective).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: /^Toolkit/ })).toBeNull();
});

it('offers no toolkit to a remote pane', async () => {
  mountRail({ hostName: 'devbox', messages: CHAT, status: 'idle', summary: null });
  await screen.findByText('MISSION CONTROL');
  expect(screen.queryByRole('button', { name: /^Toolkit/ })).toBeNull();
  expect(bridge.api.config.getEffective).not.toHaveBeenCalled();
});
