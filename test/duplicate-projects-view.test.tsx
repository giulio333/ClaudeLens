// @vitest-environment jsdom
//
// The Duplicates page. The grouping is unit tested (`duplicate-detector.test.ts`);
// what only this side can prove is what the page says about it:
//
//   1. it is read-only — the folders are rows to read, with no control on them,
//      because the merge that used to sit here was removed on purpose;
//   2. the primary comes first and says so, a path rebuilt from the folder name
//      says it is estimated, and the path head the group shares is printed once
//      rather than on every folder;
//   3. a scan still running, or one that failed, is never reported as "no
//      duplicates".

import { StrictMode, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, within } from '@testing-library/react';

import { DuplicateProjectsView } from '../src/components/project/overview/DuplicateProjectsNotice';
import { installFakeElectronAPI, ok, fail, type FakeBridge } from './helpers/fake-electron-api';
import type { DuplicateGroup } from '../src/hooks/useIPC';

const GROUP: DuplicateGroup = {
  key: 'acme',
  name: 'acme',
  folders: [
    {
      hash: '-Users-alice-Projects-acme',
      realPath: '/Users/alice/Projects/acme',
      realPathAuthoritative: true,
      sessionCount: 12,
      lastActivity: '2026-09-01T10:00:00Z',
      memoryTopicCount: 4,
      hasMemoryIndex: true,
    },
    {
      hash: '-Users-alice-Desktop-acme',
      realPath: '/Users/alice/Desktop/acme',
      realPathAuthoritative: false,
      sessionCount: 0,
      lastActivity: null,
      memoryTopicCount: 2,
      hasMemoryIndex: false,
    },
  ],
};

let bridge: FakeBridge;
let queryClient: QueryClient;

beforeEach(() => {
  bridge = installFakeElectronAPI();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  bridge.restore();
});

function mount() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </StrictMode>
  );
  return render(<DuplicateProjectsView onBack={() => {}} />, { wrapper });
}

describe('DuplicateProjectsView', () => {
  it('lists every folder of a group, primary first, with nothing to click', async () => {
    bridge.api.projects.detectDuplicates.mockResolvedValue(ok([GROUP]));

    const { container } = mount();

    expect(await screen.findByRole('heading', { name: 'acme' })).toBeTruthy();
    const rows = container.querySelectorAll('.cl-dup-folder');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('primary')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByText('primary')).toBeNull();

    // The only control on the page is the TopBar's back button.
    const list = container.querySelector('.cl-dup-folders') as HTMLElement;
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText(/merge into/i)).toBeNull();
  });

  it('flags a rebuilt path as estimated, and only that one', async () => {
    bridge.api.projects.detectDuplicates.mockResolvedValue(ok([GROUP]));

    const { container } = mount();

    await screen.findByRole('heading', { name: 'acme' });
    const rows = container.querySelectorAll('.cl-dup-folder');
    expect(within(rows[0] as HTMLElement).queryByText('estimated')).toBeNull();
    expect(within(rows[1] as HTMLElement).getByText('estimated')).toBeTruthy();
  });

  it('prints the path head the group shares once, and only the part that differs per folder', async () => {
    bridge.api.projects.detectDuplicates.mockResolvedValue(ok([GROUP]));

    const { container } = mount();

    await screen.findByRole('heading', { name: 'acme' });
    const heads = [...container.querySelectorAll('.cl-dup-prefix')].map(d => d.textContent);
    expect(heads).toEqual(['~/']);
    const tails = [...container.querySelectorAll('.cl-dup-folder .path')].map(d => d.textContent);
    expect(tails).toEqual(['Projects/acme', 'Desktop/acme']);
  });

  it('counts only what the duplicate folders hold in the hero', async () => {
    bridge.api.projects.detectDuplicates.mockResolvedValue(ok([GROUP]));

    const { container } = mount();

    await screen.findByRole('heading', { name: 'acme' });
    const meta = container.querySelector('.cl-h-meta') as HTMLElement;
    expect(meta.textContent).toContain('0 sessions');
    expect(meta.textContent).toContain('2 memory topics outside the primary');
  });

  it('says it is loading while the scan runs, not that there is nothing', () => {
    bridge.api.projects.detectDuplicates.mockReturnValue(new Promise(() => {}));

    mount();

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('No duplicates detected.')).toBeNull();
  });

  it('says the scan failed instead of reporting no duplicates', async () => {
    bridge.api.projects.detectDuplicates.mockResolvedValue(fail('EACCES'));

    mount();

    expect(await screen.findByText(/Could not scan ~\/\.claude\/projects: EACCES/)).toBeTruthy();
    expect(screen.queryByText('No duplicates detected.')).toBeNull();
  });

  it('says so when there is nothing to report', async () => {
    mount();

    expect(await screen.findByText('No duplicates detected.')).toBeTruthy();
  });
});
