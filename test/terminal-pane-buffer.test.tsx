// @vitest-environment jsdom
//
// The pane among others: several panes are mounted at once once a session can be
// parked, and every one of them hears every terminal's output. A pane parks the
// chunks it cannot attribute only while its own create is in flight, and the
// keyboard follows the pane on screen. Output is observed through OSC 52, the one
// thing a chunk does that leaves a trace outside xterm.
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeContext } from '../src/hooks/useTheme';
import { installFakeElectronAPI } from './helpers/fake-electron-api';

type Created = { data: { id: string; pid: number }; error: null };
let resolveCreates: Array<(result: Created) => void>;
let dataListeners: Set<(id: string, data: string) => void>;
let exitListeners: Set<(id: string, code: number) => void>;
let kill: ReturnType<typeof vi.fn>;
let TerminalPane: typeof import('../src/components/project/terminal/TerminalPane').TerminalPane;
let bridge: ReturnType<typeof installFakeElectronAPI>;

beforeEach(async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
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
  ({ TerminalPane } = await import('../src/components/project/terminal/TerminalPane'));
  resolveCreates = [];
  dataListeners = new Set();
  exitListeners = new Set();
  kill = vi.fn(async () => ({ data: null, error: null }));
  bridge = installFakeElectronAPI();
  Object.assign(bridge.api, {
    terminal: {
      create: vi.fn(() => new Promise<Created>(resolve => resolveCreates.push(resolve))),
      write: vi.fn(async () => ({ data: null, error: null })),
      kill,
      resize: vi.fn(async () => ({ data: null, error: null })),
      onData: (listener: (id: string, data: string) => void) => {
        dataListeners.add(listener);
        return () => dataListeners.delete(listener);
      },
      onExit: (listener: (id: string, code: number) => void) => {
        exitListeners.add(listener);
        return () => exitListeners.delete(listener);
      },
    },
  });
});

afterEach(() => {
  cleanup();
  bridge.restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pane(active: boolean) {
  return (
    <StrictMode>
      <ThemeContext.Provider
        value={{ preference: 'dark', resolved: 'dark', setPreference: vi.fn() }}
      >
        <TerminalPane cwd="/synthetic/project" onPid={vi.fn()} active={active} />
      </ThemeContext.Provider>
    </StrictMode>
  );
}

const copy = (text: string) => `\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`;
const emit = (id: string, data: string) => act(() => dataListeners.forEach(l => l(id, data)));

/** StrictMode mounts twice: the first create is the rehearsal, the second survives. */
async function settle(created: string[]) {
  await waitFor(() => expect(resolveCreates.length).toBe(created.length));
  await act(async () => {
    created.forEach((id, i) => resolveCreates[i]({ data: { id, pid: 100 + i }, error: null }));
  });
}

it('keeps none of another terminal’s output once its own process has ended', async () => {
  render(pane(true));
  await settle(['stale', 'own']);
  act(() => exitListeners.forEach(l => l('own', 0)));
  // Another pane's PTY talks while this one shows "Session ended"…
  emit('other', copy('leaked'));
  // …and if this pane's next create happened to come back under that id, a
  // stored chunk would be flushed into it.
  fireEvent.click(screen.getByRole('button', { name: 'New session' }));
  await waitFor(() => expect(resolveCreates.length).toBe(3));
  await act(async () => resolveCreates[2]({ data: { id: 'other', pid: 300 }, error: null }));
  emit('other', copy('marker'));
  await waitFor(() => expect(bridge.api.clipboard.writeText).toHaveBeenCalledWith('marker'));
  expect(bridge.api.clipboard.writeText).not.toHaveBeenCalledWith('leaked');
});

it('still shows output that beat its create, even when the rehearsal resolves first', async () => {
  render(pane(true));
  await waitFor(() => expect(resolveCreates.length).toBe(2));
  emit('own', copy('before-anything'));
  // The rehearsal's create resolves (and is killed) while the surviving one is
  // still in flight: that must not end the window in which chunks are kept.
  await act(async () => resolveCreates[0]({ data: { id: 'stale', pid: 100 }, error: null }));
  emit('own', copy('after-rehearsal'));
  await act(async () => resolveCreates[1]({ data: { id: 'own', pid: 101 }, error: null }));
  await waitFor(() =>
    expect(bridge.api.clipboard.writeText).toHaveBeenCalledWith('after-rehearsal')
  );
  expect(bridge.api.clipboard.writeText).toHaveBeenCalledWith('before-anything');
  expect(kill).toHaveBeenCalledWith('stale');
});

it('gives up the keyboard while hidden and takes it back on return', async () => {
  const { container, rerender } = render(pane(true));
  await settle(['stale', 'own']);
  const input = container.querySelector('textarea');
  expect(input).not.toBeNull();
  expect(document.activeElement).toBe(input);
  rerender(pane(false));
  expect(document.activeElement).not.toBe(input);
  rerender(pane(true));
  expect(document.activeElement).toBe(input);
});
