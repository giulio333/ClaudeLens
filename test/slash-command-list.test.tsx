// @vitest-environment jsdom
//
// Settings → Extensions used to print every slash command as one flat column
// of names — over a hundred with a few plugins installed. It is now an
// explorer: the sources on a rail, the selected source's commands with what
// each does, and a search that shows every match at once, grouped.

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode, createElement } from 'react';
import { SlashCommandList } from '../src/components/project/settings/SlashCommandList';
import type { InitInfo } from '../src/types';

afterEach(cleanup);

function init(over: Partial<InitInfo> = {}): InitInfo {
  return {
    permissionMode: 'default',
    model: 'claude-opus-5',
    cwd: '/Users/alice',
    apiKeySource: 'subscription',
    claudeCodeVersion: '2.1.290',
    cliSource: 'bundled',
    tools: [],
    mcpServers: [],
    slashCommands: ['deploy', 'acme:release', 'compact'],
    commands: [
      { name: 'deploy', description: 'Ship it', argumentHint: '<env>', builtin: false },
      {
        name: 'acme:release',
        description: '(acme) Cut a release',
        argumentHint: '',
        builtin: false,
      },
      { name: 'compact', description: 'Free up context', argumentHint: '', builtin: true },
    ],
    outputStyle: '',
    skills: [],
    agents: [],
    plugins: [],
    models: [],
    ...over,
  };
}

function mount(info: InitInfo | null, q = '') {
  return render(
    createElement(StrictMode, null, createElement(SlashCommandList, { init: info, q }))
  );
}

describe('Settings → Extensions · slash commands', () => {
  it('opens on the first source and prints what each command does', () => {
    mount(init());
    const local = screen.getByRole('region', { name: 'Project & user' });
    expect(within(local).getByText('Ship it')).toBeTruthy();
    expect(within(local).getByText('<env>')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'acme' })).toBeNull();
  });

  it('shows another source when its rail entry is clicked', () => {
    mount(init());
    const rail = screen.getByRole('navigation', { name: 'Command sources' });
    fireEvent.click(within(rail).getByRole('button', { name: /acme/ }));
    const acme = screen.getByRole('region', { name: 'acme' });
    expect(within(acme).getByText('Cut a release')).toBeTruthy();
    expect(within(acme).getByText('release')).toBeTruthy();
    expect(within(rail).getByRole('button', { name: /acme/ }).getAttribute('aria-current')).toBe(
      'true'
    );
    expect(screen.queryByRole('region', { name: 'Project & user' })).toBeNull();
  });

  it('shows every match of a search at once, across sources', () => {
    const info = init();
    info.commands = [
      ...(info.commands ?? []),
      { name: 'acme:review', description: 'Review a release', argumentHint: '', builtin: false },
      { name: 'review', description: 'Review the diff', argumentHint: '', builtin: true },
    ];
    mount(info, 'review');
    expect(screen.getByRole('region', { name: 'acme' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Built-in' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Project & user' })).toBeNull();
  });

  it('says so when the CLI gave names only', () => {
    mount(init({ commands: undefined }));
    expect(screen.getByText(/names only/)).toBeTruthy();
    const rail = screen.getByRole('navigation', { name: 'Command sources' });
    expect(within(rail).queryByRole('button', { name: /Built-in/ })).toBeNull();
    expect(screen.getByRole('region', { name: 'Commands' })).toBeTruthy();
  });
});
