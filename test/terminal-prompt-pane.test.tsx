// @vitest-environment jsdom
import { StrictMode, createRef } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ThemeContext } from '../src/hooks/useTheme';
import type { TerminalPromptHandle } from '../src/components/project/terminal/terminal-prompt';
import { installFakeElectronAPI } from './helpers/fake-electron-api';

type Created = { data: { id: string; pid: number }; error: null };
let resolveCreates: Array<(result: Created) => void>;
let dataListeners: Set<(id: string, data: string) => void>;
let exitListeners: Set<(id: string, code: number) => void>;
let terminal: {
  create: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
};
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
  terminal = {
    create: vi.fn(() => new Promise<Created>(resolve => resolveCreates.push(resolve))),
    write: vi.fn(async () => ({ data: null, error: null })),
    kill: vi.fn(async () => ({ data: null, error: null })),
  };
  bridge = installFakeElectronAPI();
  Object.assign(bridge.api, {
    terminal: {
      ...terminal,
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

function mount() {
  const ref = createRef<TerminalPromptHandle>();
  const mounted = render(
    <StrictMode>
      <ThemeContext.Provider
        value={{ preference: 'dark', resolved: 'dark', setPreference: vi.fn() }}
      >
        <TerminalPane ref={ref} cwd="/synthetic/project" onPid={vi.fn()} />
      </ThemeContext.Provider>
    </StrictMode>
  );
  return { ref, ...mounted };
}

async function finishCreates() {
  await act(async () => {
    resolveCreates[0]({ data: { id: 'stale', pid: 10 }, error: null });
    resolveCreates[1]({ data: { id: 'current', pid: 11 }, error: null });
  });
}

it('inserts exactly once through the surviving StrictMode terminal and removes its listeners', async () => {
  const { ref, unmount } = mount();
  const pasted = ref.current!.pastePrompt('Review\nthis change');
  await finishCreates();
  expect(terminal.kill).toHaveBeenCalledWith('stale');
  expect(terminal.write).not.toHaveBeenCalled();
  act(() => dataListeners.forEach(listener => listener('current', '\x1b[?2004h')));
  await pasted;
  expect(terminal.write).toHaveBeenCalledExactlyOnceWith(
    'current',
    '\x1b[200~Review\rthis change\x1b[201~'
  );
  unmount();
  expect(terminal.kill).toHaveBeenCalledWith('current');
  expect(dataListeners.size).toBe(0);
  expect(exitListeners.size).toBe(0);
});

it('rejects a pending draft when the process exits before create resolves', async () => {
  const { ref } = mount();
  const failed = expect(ref.current!.pastePrompt('Never submit')).rejects.toThrow('ended');
  act(() => {
    dataListeners.forEach(listener => listener('current', '\x1b[?2004h'));
    exitListeners.forEach(listener => listener('current', 1));
  });
  await finishCreates();
  await failed;
  await expect(ref.current!.pastePrompt('Do not restart')).rejects.toThrow('unavailable');
  expect(terminal.create).toHaveBeenCalledTimes(2);
  expect(terminal.write).not.toHaveBeenCalled();
});

it('rejects a pending draft on unmount and cannot paste through a stale handle', async () => {
  const { ref, unmount } = mount();
  await finishCreates();
  const handle = ref.current!;
  const failed = expect(handle.pastePrompt('Cancelled')).rejects.toThrow('closed');
  unmount();
  await failed;
  await expect(handle.pastePrompt('Still cancelled')).rejects.toThrow('not mounted');
  await waitFor(() => expect(terminal.write).not.toHaveBeenCalled());
});

it('forwards cancellation without pasting or stealing focus when readiness arrives later', async () => {
  const { ref } = mount();
  await finishCreates();
  const otherInput = document.createElement('input');
  document.body.append(otherInput);
  otherInput.focus();
  const abort = new AbortController();
  const failed = expect(ref.current!.pastePrompt('Cancelled', abort.signal)).rejects.toThrow(
    'cancelled'
  );
  abort.abort();
  await failed;
  // The cursor-report reply proves xterm parsed the preceding mode change.
  act(() => dataListeners.forEach(listener => listener('current', '\x1b[?2004h\x1b[6n')));
  await waitFor(() =>
    expect(terminal.write).toHaveBeenCalledExactlyOnceWith('current', '\x1b[1;1R')
  );
  expect(document.activeElement).toBe(otherInput);
  terminal.write.mockClear();
  await ref.current!.pastePrompt('Next draft');
  expect(terminal.write).toHaveBeenCalledExactlyOnceWith('current', '\x1b[200~Next draft\x1b[201~');
  expect(document.activeElement).not.toBe(otherInput);
  otherInput.remove();
});

it('rejects a pending draft when creating the PTY fails without automatically retrying', async () => {
  terminal.create.mockRejectedValue(new Error('PTY could not be created'));
  const { ref, getByText } = mount();
  const failed = expect(ref.current!.pastePrompt('Keep as draft')).rejects.toThrow('ended');
  await act(async () => {
    await failed;
  });
  expect(getByText('PTY could not be created')).toBeTruthy();
  await expect(ref.current!.pastePrompt('Try again')).rejects.toThrow('unavailable');
  expect(terminal.create).toHaveBeenCalledTimes(2);
  expect(terminal.write).not.toHaveBeenCalled();
});
