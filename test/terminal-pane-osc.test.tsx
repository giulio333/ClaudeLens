// @vitest-environment jsdom
//
// The pane itself, fed raw PTY output: an OSC 52 copy reaches the clipboard
// through the main process, and a clipboard read is never answered (#293).
import { StrictMode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeContext } from '../src/hooks/useTheme';
import { installFakeElectronAPI } from './helpers/fake-electron-api';

type Created = { data: { id: string; pid: number }; error: null };
let resolveCreates: Array<(result: Created) => void>;
let dataListeners: Set<(id: string, data: string) => void>;
let write: ReturnType<typeof vi.fn>;
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
  write = vi.fn(async () => ({ data: null, error: null }));
  bridge = installFakeElectronAPI();
  Object.assign(bridge.api, {
    terminal: {
      create: vi.fn(() => new Promise<Created>(resolve => resolveCreates.push(resolve))),
      write,
      kill: vi.fn(async () => ({ data: null, error: null })),
      resize: vi.fn(async () => ({ data: null, error: null })),
      onData: (listener: (id: string, data: string) => void) => {
        dataListeners.add(listener);
        return () => dataListeners.delete(listener);
      },
      onExit: () => () => {},
    },
  });
});

afterEach(() => {
  cleanup();
  bridge.restore();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Mounts the pane and hands it a running PTY, as the main process would. */
async function running() {
  render(
    <StrictMode>
      <ThemeContext.Provider
        value={{ preference: 'dark', resolved: 'dark', setPreference: vi.fn() }}
      >
        <TerminalPane cwd="/synthetic/project" onPid={vi.fn()} />
      </ThemeContext.Provider>
    </StrictMode>
  );
  // StrictMode mounts twice: the first create is the discarded rehearsal.
  await waitFor(() => expect(resolveCreates.length).toBeGreaterThan(0));
  await act(async () => {
    for (const [i, resolve] of resolveCreates.entries())
      resolve({ data: { id: `pty-${i}`, pid: 100 + i }, error: null });
  });
  const id = `pty-${resolveCreates.length - 1}`;
  return (data: string) => {
    for (const listener of dataListeners) listener(id, data);
  };
}

it('puts what a program copies with OSC 52 on the clipboard', async () => {
  const emit = await running();
  const url = 'https://claude.ai/oauth/authorize?code=true&state=abc';
  emit(`sign in: \x1b]52;c;${Buffer.from(url).toString('base64')}\x07`);
  await waitFor(() => expect(bridge.api.clipboard.writeText).toHaveBeenCalledWith(url));
});

it('never answers a request to read the clipboard', async () => {
  const emit = await running();
  emit('\x1b]52;c;?\x07');
  // Give xterm's parser the same chance it had to handle the copy above.
  emit(`\x1b]52;c;${Buffer.from('marker').toString('base64')}\x07`);
  await waitFor(() => expect(bridge.api.clipboard.writeText).toHaveBeenCalledWith('marker'));
  expect(bridge.api.clipboard.readText).not.toHaveBeenCalled();
  expect(bridge.api.clipboard.writeText).toHaveBeenCalledTimes(1);
  expect(write).not.toHaveBeenCalled();
});
