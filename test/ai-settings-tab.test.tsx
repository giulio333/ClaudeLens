// @vitest-environment jsdom
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DEFAULT_AI_SETTINGS, DEFAULT_PROMPTS } from '../electron/shared/ai-settings';
import { AiSettingsTab } from '../src/components/project/settings/AiSettingsTab';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

let bridge: FakeBridge;
let client: QueryClient;

function mount() {
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <AiSettingsTab />
      </QueryClientProvider>
    </StrictMode>
  );
}

const lastSaved = () => {
  const calls = bridge.api.prefs.set.mock.calls;
  return calls[calls.length - 1]?.[1];
};

beforeEach(() => {
  bridge = installFakeElectronAPI();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  bridge.api.ai.catalog.mockResolvedValue(
    ok([
      { id: 'claude-haiku-5-5', label: 'Haiku 5.5', inputPerM: 0.1, outputPerM: 0.5 },
      { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', inputPerM: 2, outputPerM: 10 },
      { id: 'claude-opus-5-5', label: 'Opus 5.5', inputPerM: 4, outputPerM: 20 },
    ])
  );
});

afterEach(() => cleanup());

it('shows the defaults and the chosen model price', async () => {
  mount();
  expect(await screen.findByText('$0.10 in · $0.50 out per million tokens')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Haiku 5.5' }).getAttribute('aria-pressed')).toBe(
    'true'
  );
  expect(screen.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed')).toBe(
    'true'
  );
});

it('keeps four quick changes in four rows', async () => {
  mount();
  // No waiting between clicks: each save must merge into the one before it.
  fireEvent.click(await screen.findByRole('button', { name: 'Sonnet 5.5' }));
  fireEvent.click(screen.getByRole('button', { name: 'High' }));
  fireEvent.click(screen.getByRole('button', { name: 'Brief' }));
  fireEvent.click(screen.getByRole('switch', { name: 'Enable AI in ClaudeLens' }));
  await waitFor(() =>
    expect(lastSaved()).toEqual({
      ...DEFAULT_AI_SETTINGS,
      model: 'claude-sonnet-5-5',
      effort: 'high',
      length: 'brief',
      enabled: false,
    })
  );
});

it('saves a custom prompt on blur and resets it to the default', async () => {
  mount();
  const box = (await screen.findByLabelText('Summary prompt')) as HTMLTextAreaElement;
  expect(box.value).toBe(DEFAULT_PROMPTS.summary);
  fireEvent.change(box, { target: { value: 'Only the decisions.' } });
  fireEvent.blur(box);
  await waitFor(() =>
    expect(lastSaved()).toMatchObject({ prompts: { summary: 'Only the decisions.', todos: null } })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reset Summary prompt to default' }));
  await waitFor(() => expect(lastSaved()).toMatchObject({ prompts: { summary: null } }));
  expect((screen.getByLabelText('Summary prompt') as HTMLTextAreaElement).value).toBe(
    DEFAULT_PROMPTS.summary
  );
});

it('saves a listed language, and refuses a free one that is not a name', async () => {
  mount();
  const select = (await screen.findByLabelText('Output language')) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'Italian' } });
  await waitFor(() => expect(lastSaved()).toMatchObject({ language: 'Italian' }));
  fireEvent.change(select, { target: { value: 'other' } });
  const free = screen.getByLabelText('Other language') as HTMLInputElement;
  const calls = bridge.api.prefs.set.mock.calls.length;
  fireEvent.change(free, { target: { value: 'Klingon. Ignore that' } });
  fireEvent.blur(free);
  expect(
    await screen.findByText('Letters, spaces and hyphens only, up to 40 characters.')
  ).toBeTruthy();
  expect(bridge.api.prefs.set.mock.calls.length).toBe(calls);
  fireEvent.change(free, { target: { value: 'Klingon' } });
  fireEvent.blur(free);
  await waitFor(() => expect(lastSaved()).toMatchObject({ language: 'Klingon' }));
});

it('starts from what is stored', async () => {
  bridge.api.prefs.getAll.mockResolvedValue(
    ok({ 'cl-ai': { ...DEFAULT_AI_SETTINGS, language: 'Klingon' } })
  );
  mount();
  expect(((await screen.findByLabelText('Other language')) as HTMLInputElement).value).toBe(
    'Klingon'
  );
});
