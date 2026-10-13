// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { InsightResult } from '../electron/shared/ai-settings';
import { NotesRailPanel } from '../src/components/project/terminal/NotesRailPanel';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

const SESSION = '0f8e2c1a-1111-4222-8333-944455556666';
let bridge: FakeBridge;
let client: QueryClient;

function answer(over: Partial<InsightResult> = {}) {
  return ok<InsightResult>({
    lines: ['- Renamed the module', '- Fixed the build'],
    truncated: false,
    model: 'claude-haiku-5-5',
    inputTokens: 84_000,
    outputTokens: 600,
    costUsd: 0.009,
    ...over,
  });
}

function mount() {
  return render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <NotesRailPanel
          id="notes"
          sessionId={SESSION}
          onClose={() => {}}
          onUse={async () => {}}
          useHint="Add to the input"
        />
      </QueryClientProvider>
    </StrictMode>
  );
}

const values = () => screen.getAllByRole('textbox').map(el => (el as HTMLTextAreaElement).value);

async function pick(action: 'Summary' | 'To-dos') {
  fireEvent.click(await screen.findByRole('button', { name: 'Write with AI' }));
  fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(action) }));
}

beforeEach(() => {
  bridge = installFakeElectronAPI();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  bridge.api.notes.get.mockResolvedValue(ok('mine\n'));
});

afterEach(() => cleanup());

it('has no AI button while the AI is turned off', async () => {
  bridge.api.prefs.getAll.mockResolvedValue(ok({ 'cl-ai': { enabled: false } }));
  mount();
  await screen.findByDisplayValue('mine');
  await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Write with AI' })).toBeNull();
});

it('appends a summary under a title, with its cost and an Undo', async () => {
  bridge.api.ai.insight.mockResolvedValue(answer());
  mount();
  await pick('Summary');
  await waitFor(() => expect(values()).toContain('Renamed the module'));
  expect(bridge.api.ai.insight).toHaveBeenCalledWith(SESSION, 'summary');
  expect(values()[0]).toBe('mine');
  expect(values()[1]).toMatch(/^Summary · /);
  expect(screen.getByText(/Haiku 5\.5 · 84K in · 0\.6K out · \$0\.009 at API rates/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(values()).toEqual(['mine']);
});

it('appends to what was typed while the run was going', async () => {
  let release!: (v: ReturnType<typeof answer>) => void;
  bridge.api.ai.insight.mockReturnValue(new Promise(r => (release = r)));
  mount();
  await pick('To-dos');
  fireEvent.change(screen.getByDisplayValue('mine'), { target: { value: 'mine, edited' } });
  await act(async () => release(answer({ lines: ['- [ ] Write docs'] })));
  await waitFor(() => expect(values()).toContain('Write docs'));
  expect(values()[0]).toBe('mine, edited');
});

it('says when there is nothing to add, and leaves the notes alone', async () => {
  bridge.api.ai.insight.mockResolvedValue(answer({ lines: [] }));
  mount();
  await pick('To-dos');
  expect(await screen.findByText('Nothing to add')).toBeTruthy();
  expect(values()).toEqual(['mine']);
});

it('shows an error inline and leaves the notes alone', async () => {
  bridge.api.ai.insight.mockResolvedValue({ data: null, error: 'Not logged in' });
  mount();
  await pick('Summary');
  expect((await screen.findByRole('alert')).textContent).toContain('Not logged in');
  expect(values()).toEqual(['mine']);
});

it('offers Cancel while running, and shows nothing for a cancelled run', async () => {
  let reject!: (e: unknown) => void;
  bridge.api.ai.insight.mockReturnValue(new Promise((_, r) => (reject = r)));
  mount();
  await pick('Summary');
  // StrictMode's mount-time cleanup already sent one cancel: count from here.
  const before = bridge.api.ai.cancelInsight.mock.calls.length;
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(bridge.api.ai.cancelInsight.mock.calls.length).toBe(before + 1);
  expect(bridge.api.ai.cancelInsight).toHaveBeenLastCalledWith(SESSION);
  await act(async () => reject(new Error('Cancelled.')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(await screen.findByRole('button', { name: 'Write with AI' })).toBeTruthy();
});

it('cancels the run when the panel goes away, and writes nothing', async () => {
  let release!: (v: ReturnType<typeof answer>) => void;
  bridge.api.ai.insight.mockReturnValue(new Promise(r => (release = r)));
  const view = mount();
  await pick('Summary');
  const before = bridge.api.ai.cancelInsight.mock.calls.length;
  view.unmount();
  expect(bridge.api.ai.cancelInsight.mock.calls.length).toBeGreaterThan(before);
  expect(bridge.api.ai.cancelInsight).toHaveBeenLastCalledWith(SESSION);
  await act(async () => release(answer()));
  const saved = bridge.api.notes.save.mock.calls.map(c => c[1] as string);
  expect(saved.some(text => text.includes('Renamed the module'))).toBe(false);
});

it('leaves the focus where it is when the answer lands', async () => {
  let release!: (v: ReturnType<typeof answer>) => void;
  bridge.api.ai.insight.mockReturnValue(new Promise(r => (release = r)));
  render(<input aria-label="Elsewhere" />);
  mount();
  await pick('Summary');
  const elsewhere = screen.getByLabelText('Elsewhere');
  elsewhere.focus();
  await act(async () => release(answer()));
  await waitFor(() => expect(values()).toContain('Renamed the module'));
  expect(document.activeElement).toBe(elsewhere);
});
