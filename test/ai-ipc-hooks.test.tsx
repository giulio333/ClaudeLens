// @vitest-environment jsdom
import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_AI_SETTINGS } from '../electron/shared/ai-settings';
import { useAiSettings, useSetAiSettings } from '../src/hooks/useIPC';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

let bridge: FakeBridge;
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <StrictMode>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </StrictMode>
);

beforeEach(() => {
  bridge = installFakeElectronAPI();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

it('reads the AI settings through the shared normaliser', async () => {
  bridge.api.prefs.getAll.mockResolvedValue(
    ok({ 'cl-ai': { model: 'claude-opus-5-5', effort: 'nope' } })
  );
  const { result } = renderHook(() => useAiSettings(), { wrapper });
  await waitFor(() =>
    expect(result.current.data).toEqual({ ...DEFAULT_AI_SETTINGS, model: 'claude-opus-5-5' })
  );
});

it('merges two quick saves and writes the whole object under cl-ai', async () => {
  const { result } = renderHook(() => ({ set: useSetAiSettings(), get: useAiSettings() }), {
    wrapper,
  });
  await waitFor(() => expect(result.current.get.data).toBeDefined());
  act(() => {
    result.current.set.save({ length: 'brief' });
    result.current.set.save(current => ({ prompts: { ...current.prompts, todos: 'Mine.' } }));
  });
  const both = {
    ...DEFAULT_AI_SETTINGS,
    length: 'brief',
    prompts: { summary: null, todos: 'Mine.' },
  };
  await waitFor(() => expect(result.current.get.data).toEqual(both));
  expect(bridge.api.prefs.set).toHaveBeenLastCalledWith('cl-ai', both);
});
