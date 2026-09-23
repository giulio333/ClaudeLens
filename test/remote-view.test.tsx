// @vitest-environment jsdom
//
// The Remote page (#242). The connect script is run for real in
// `remote-ssh.test.ts`; what only this side can prove is what the page does
// with it:
//
//   1. a host is saved only when ssh would read it as a host — a destination
//      that starts with "-" never reaches the store;
//   2. Connect asks for the host, the folder and the Claude Code version this
//      build requires, and the connected frame says the session is remote and
//      how its Lens reaches the host (`remote-lens-view.test.tsx` covers the
//      Lens itself);
//   3. a refusal of the script (an outdated CLI) is named under the terminal,
//      whose output stays uncovered, and the update it offers runs on the host
//      and then leads back to a session.

import { StrictMode, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeCodeVersion } from '../package.json';
import { ThemeContext } from '../src/hooks/useTheme';
import { RemoteView } from '../src/components/project/remote/RemoteView';
import { REMOTE_EXIT, type RemoteHost } from '../electron/shared/remote-host';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';

const HOST: RemoteHost = {
  id: 'h1',
  name: 'Build',
  target: 'user@build.example.com',
  defaultDir: '~/projects',
};

let bridge: FakeBridge;
let queryClient: QueryClient;
let exitListeners: Set<(id: string, code: number) => void>;
let lastId: string | null;
let createRemote: ReturnType<typeof vi.fn>;
let createLocal: ReturnType<typeof vi.fn>;

beforeEach(() => {
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
  localStorage.clear();
  bridge = installFakeElectronAPI();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  exitListeners = new Set();
  lastId = null;
  let n = 0;
  // Every connection is a new PTY with its own id, as in the main process —
  // StrictMode's rehearsal mount creates one too, and kills it as stale.
  createRemote = vi.fn(async () => {
    lastId = `pty-${++n}`;
    return ok({ id: lastId, pid: n });
  });
  createLocal = vi.fn();
  Object.assign(bridge.api, {
    terminal: {
      create: createLocal,
      createRemote,
      write: vi.fn(async () => ok(null)),
      resize: vi.fn(async () => ok(null)),
      kill: vi.fn(async () => ok(null)),
      onData: () => () => {},
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
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeContext.Provider
          value={{ preference: 'dark', resolved: 'dark', setPreference: vi.fn() }}
        >
          {children}
        </ThemeContext.Provider>
      </QueryClientProvider>
    </StrictMode>
  );
  return render(<RemoteView onBack={() => {}} />, { wrapper });
}

function exit(code: number) {
  act(() => exitListeners.forEach(listener => listener(lastId!, code)));
}

async function connected() {
  bridge.api.remote.listHosts.mockResolvedValue(ok([HOST]));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
  await waitFor(() => expect(createRemote).toHaveBeenCalled());
}

describe('saving a host', () => {
  it('opens on the form when no host is saved, and saves what was typed', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Build' } });
    fireEvent.change(screen.getByLabelText('ssh destination'), {
      target: { value: 'user@build.example.com' },
    });
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '2222' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save host' }));
    await waitFor(() =>
      expect(bridge.api.remote.saveHost).toHaveBeenCalledWith({
        name: 'Build',
        target: 'user@build.example.com',
        port: 2222,
        os: 'posix',
        defaultDir: '',
      })
    );
  });

  it('never saves a destination ssh would read as an option', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('ssh destination'), {
      target: { value: '-oProxyCommand=id' },
    });
    expect(screen.getByText(/cannot start with "-"/)).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save host' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(bridge.api.remote.saveHost).not.toHaveBeenCalled();
  });
});

describe('a Windows host', () => {
  const WIN: RemoteHost = { id: 'w1', name: 'Win', target: 'win-box', os: 'windows' };

  it('is saved as one, and its folder is judged by Windows rules', async () => {
    mount();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Win' } });
    fireEvent.change(screen.getByLabelText('ssh destination'), { target: { value: 'win-box' } });
    fireEvent.change(screen.getByLabelText('Default folder'), { target: { value: 'C:\\src' } });
    // A POSIX host refuses a drive-letter path…
    expect(screen.getByText(/absolute path/)).toBeTruthy();
    // …which is exactly what a Windows one takes.
    fireEvent.click(screen.getByRole('radio', { name: 'Windows' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save host' }));
    await waitFor(() =>
      expect(bridge.api.remote.saveHost).toHaveBeenCalledWith(
        expect.objectContaining({ os: 'windows', defaultDir: 'C:\\src' })
      )
    );
  });

  it('connects to a drive-letter folder and names the Windows install when claude is missing', async () => {
    bridge.api.remote.listHosts.mockResolvedValue(ok([WIN]));
    mount();
    fireEvent.change(await screen.findByLabelText('Folder on the host'), {
      target: { value: 'C:\\src\\app' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(createRemote).toHaveBeenLastCalledWith(
        expect.objectContaining({ hostId: 'w1', dir: 'C:\\src\\app' })
      )
    );
    exit(REMOTE_EXIT.notFound);
    expect(screen.getByRole('status').textContent).toContain('%USERPROFILE%');
  });
});

describe('connecting', () => {
  it('asks for the host, its folder and the version this build requires', async () => {
    await connected();
    expect(createRemote).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hostId: 'h1',
        mode: 'claude',
        dir: '~/projects',
        minVersion: claudeCodeVersion,
      })
    );
    // Never the local path: a remote session must not start a local claude.
    expect(createLocal).not.toHaveBeenCalled();
  });

  it('says on screen that the session runs on the host, and how Lens reaches it', async () => {
    await connected();
    const banner = screen.getByRole('note');
    expect(banner.textContent).toContain('Remote · user@build.example.com');
    expect(banner.textContent).toContain('This session runs on Build');
    // A macOS/Linux client rides the terminal's own connection (#294).
    expect(banner.textContent).toContain("over this terminal's own ssh connection");
    expect(banner.textContent).toContain('Nothing of it is saved on this machine');
  });

  it('refuses a folder the script could not carry, before any connection', async () => {
    bridge.api.remote.listHosts.mockResolvedValue(ok([HOST]));
    mount();
    fireEvent.change(await screen.findByLabelText('Folder on the host'), {
      target: { value: '~/$(id)' },
    });
    const connect = screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement;
    expect(connect.disabled).toBe(true);
    expect(createRemote).not.toHaveBeenCalled();
  });
});

describe('when the script refuses the host', () => {
  it('names an outdated Claude Code under an uncovered terminal and offers the update', async () => {
    await connected();
    exit(REMOTE_EXIT.outdated);
    expect(screen.getByRole('status').textContent).toContain('Claude Code on Build is too old');
    // The terminal keeps the script's own message on screen: no overlay over it.
    expect(screen.queryByText('SESSION ENDED')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Update Claude Code on Build' }));
    await waitFor(() =>
      expect(createRemote).toHaveBeenLastCalledWith(
        expect.objectContaining({ hostId: 'h1', mode: 'update' })
      )
    );
    expect(screen.queryByRole('status')).toBeNull();

    exit(0);
    expect(screen.getByRole('status').textContent).toContain('Claude Code on Build is updated');
    fireEvent.click(screen.getByRole('button', { name: 'Connect again' }));
    await waitFor(() =>
      expect(createRemote).toHaveBeenLastCalledWith(
        expect.objectContaining({ mode: 'claude', dir: '~/projects' })
      )
    );
  });

  it('tells a missing folder apart from a failed login', async () => {
    await connected();
    exit(REMOTE_EXIT.noDir);
    expect(screen.getByRole('status').textContent).toContain('~/projects does not exist on Build');

    fireEvent.click(screen.getByRole('button', { name: 'Back to hosts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(lastId).not.toBeNull());
    exit(255);
    expect(screen.getByRole('status').textContent).toContain(
      'Could not connect to user@build.example.com'
    );
  });
});
