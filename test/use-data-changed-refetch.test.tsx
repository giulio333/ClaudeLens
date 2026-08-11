// @vitest-environment jsdom
//
// `useDataChangedRefetch` is the renderer half of the scoped `data:changed`
// protocol (#148, reworked in #181). The main process tags each watcher event
// with the namespaces the changed path can affect; this hook coalesces a burst
// of them and invalidates only the query keys those namespaces own.
//
// The pure table underneath (`dataChangeScopes.ts`) is already unit-tested. What
// was not covered is the hook that consumes it: the debounce window, the union
// across that window, and the fallback to "invalidate everything" when the
// payload is not something we can vouch for. Getting any of those wrong is
// invisible — the UI still works, it just re-reads every transcript on every
// keystroke of a live chat, or quietly goes stale.

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { useDataChangedRefetch } from '../src/hooks/useIPC';
import { ALL_SCOPES, SCOPE_KEYS } from '../src/hooks/dataChangeScopes';
import { installFakeElectronAPI, type FakeBridge } from './helpers/fake-electron-api';

/** The trailing-debounce window in the hook. */
const DEBOUNCE_MS = 200;

let bridge: FakeBridge;
let queryClient: QueryClient;
let invalidate: MockInstance<QueryClient['invalidateQueries']>;

beforeEach(() => {
  vi.useFakeTimers();
  bridge = installFakeElectronAPI();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidate = vi.spyOn(queryClient, 'invalidateQueries');
});

afterEach(() => {
  cleanup();
  bridge.restore();
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: queryClient }, children);
}

function mount() {
  return renderHook(() => useDataChangedRefetch(), { wrapper });
}

/** Every query key the hook asked to invalidate, flattened and deduped. */
function invalidatedKeys(): string[] {
  const keys = invalidate.mock.calls.map(([filters]) => String(filters?.queryKey?.[0]));
  return [...new Set(keys)].sort();
}

function flush() {
  act(() => {
    vi.advanceTimersByTime(DEBOUNCE_MS);
  });
}

describe('useDataChangedRefetch', () => {
  it('invalidates only the keys the scope owns', () => {
    mount();

    act(() => bridge.channels.dataChanged.emit(['sessions']));
    flush();

    expect(invalidatedKeys()).toEqual([...SCOPE_KEYS.get('sessions')!].sort());
  });

  it('leaves the unrelated namespaces alone when a transcript is appended', () => {
    mount();

    // The regression #148 fixed: an append during a live chat used to re-read
    // skills, agents, plugins and MCP on every watcher burst.
    act(() => bridge.channels.dataChanged.emit(['sessions', 'cost']));
    flush();

    const touched = invalidatedKeys();
    for (const key of ['skills:global', 'agents:global', 'plugins:all', 'mcp:global']) {
      expect(touched).not.toContain(key);
    }
  });

  it('collapses a burst into a single pass', () => {
    mount();

    act(() => {
      for (let i = 0; i < 25; i++) bridge.channels.dataChanged.emit(['sessions']);
    });
    // Still inside the window: nothing has run yet.
    expect(invalidate).not.toHaveBeenCalled();

    flush();
    expect(invalidate).toHaveBeenCalledTimes(SCOPE_KEYS.get('sessions')!.length);
  });

  it('keeps deferring while events keep arriving', () => {
    mount();

    act(() => bridge.channels.dataChanged.emit(['sessions']));
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS - 20);
    });
    act(() => bridge.channels.dataChanged.emit(['sessions']));
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS - 20);
    });

    // The trailing timer restarted on the second event, so the window has not
    // closed yet even though more than DEBOUNCE_MS elapsed overall.
    expect(invalidate).not.toHaveBeenCalled();

    flush();
    expect(invalidate).toHaveBeenCalled();
  });

  it('invalidates the union of the scopes seen during the window', () => {
    mount();

    act(() => {
      bridge.channels.dataChanged.emit(['sessions']);
      bridge.channels.dataChanged.emit(['plans']);
      bridge.channels.dataChanged.emit(['tasks']);
      bridge.channels.dataChanged.emit(['plans']);
    });
    flush();

    expect(invalidatedKeys()).toEqual(
      [
        ...SCOPE_KEYS.get('sessions')!,
        ...SCOPE_KEYS.get('plans')!,
        ...SCOPE_KEYS.get('tasks')!,
      ].sort()
    );
  });

  it('falls back to every scope when the payload cannot be vouched for', () => {
    const everyKey = [...new Set(ALL_SCOPES.flatMap(s => SCOPE_KEYS.get(s)!))].sort();

    for (const payload of [undefined, null, 'sessions', ['sessions', 'not-a-scope']]) {
      invalidate.mockClear();
      const view = mount();

      act(() => bridge.channels.dataChanged.emit(payload));
      flush();

      // A silently stale view is the worse failure, so anything we do not fully
      // understand widens back to what the hook did before it was scoped at all.
      expect(invalidatedKeys(), `payload ${JSON.stringify(payload)}`).toEqual(everyKey);
      view.unmount();
    }
  });

  it('does not invalidate after unmount', () => {
    const { unmount } = mount();

    act(() => bridge.channels.dataChanged.emit(['sessions']));
    unmount();
    flush();

    expect(invalidate).not.toHaveBeenCalled();
    expect(bridge.channels.dataChanged.listenerCount).toBe(0);
  });
});
