// @vitest-environment jsdom
//
// The results half of conversation search. The scan itself is unit tested
// (`session-search.test.ts`); what only this side can prove is what the page
// promises about a result:
//
//   1. the scan is SUBMITTED, never streamed — typing must not put a pass over
//      the whole history behind every keystroke;
//   2. the highlight is drawn at the offsets the scan reported, not re-found
//      here, so the two can never disagree about which run matched;
//   3. opening a hit resolves the REAL `SessionSummary` from the project's own
//      list, and refuses when the session is no longer there — a transcript
//      deleted since the scan is not a session that can be opened, and
//      fabricating a summary would put invented cost figures in the header.

import { type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

import { SearchView } from '../src/components/project/search/SearchView';
import {
  installFakeElectronAPI,
  ok,
  sessionSummary,
  type FakeBridge,
} from './helpers/fake-electron-api';
import type { ConversationSearchResult, SessionSummary } from '../src/types';

const PROJECT = { hash: '-Users-alice-acme', realPath: '/Users/alice/acme' };

function outcome(over: Partial<ConversationSearchResult> = {}): ConversationSearchResult {
  return {
    results: [],
    scanned: 3,
    parsed: 1,
    truncated: false,
    prefiltered: true,
    elapsedMs: 12,
    ...over,
  };
}

/** One session with one hit; `snippet` offsets are the scan's, not re-derived. */
function oneHit(over: Partial<ConversationSearchResult['results'][0]> = {}) {
  return {
    projectHash: PROJECT.hash,
    projectPath: PROJECT.realPath,
    sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
    sessionTitle: 'Fixing the pty spawn',
    mtime: Date.parse('2026-02-03T10:00:00Z'),
    hitCount: 1,
    hits: [
      {
        messageUuid: 'msg-1',
        role: 'user' as const,
        timestamp: '2026-02-03T10:00:00Z',
        kind: 'text' as const,
        snippet: '…so I fixed the spawn helper today…',
        matchStart: 16,
        matchLength: 5,
      },
    ],
    ...over,
  };
}

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

type MountProps = Omit<Parameters<typeof SearchView>[0], 'onBack' | 'onOpenHit'>;

function mount(props: Partial<MountProps> = {}) {
  const onOpenHit = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const view = render(
    <SearchView initialQuery="" onBack={() => {}} {...props} onOpenHit={onOpenHit} />,
    { wrapper }
  );
  return { ...view, onOpenHit };
}

describe('SearchView', () => {
  it('runs the seeded query on open, so arriving with words shows results', async () => {
    bridge.api.search.conversations.mockResolvedValue(ok(outcome({ results: [oneHit()] })));

    mount({ initialQuery: 'spawn' });

    await waitFor(() => expect(bridge.api.search.conversations).toHaveBeenCalled());
    expect(bridge.api.search.conversations.mock.calls[0][0]).toMatchObject({ text: 'spawn' });
    expect(await screen.findByText('Fixing the pty spawn')).toBeTruthy();
  });

  it('does not scan while the query is being typed', async () => {
    mount({ initialQuery: '' });

    const input = screen.getByLabelText('Search conversations') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'spa' } });
    fireEvent.change(input, { target: { value: 'spawn' } });

    // A pass over every transcript on disk is not a keystroke's worth of work.
    expect(bridge.api.search.conversations).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(bridge.api.search.conversations).toHaveBeenCalledTimes(1));
  });

  it('starts scoped to the project it was opened from, and can be widened', async () => {
    bridge.api.search.conversations.mockResolvedValue(ok(outcome()));

    mount({ initialQuery: 'spawn', scope: PROJECT });

    await waitFor(() => expect(bridge.api.search.conversations).toHaveBeenCalled());
    expect(bridge.api.search.conversations.mock.calls[0][0]).toMatchObject({
      projectHash: PROJECT.hash,
    });

    fireEvent.click(screen.getByLabelText('Search conversations')); // focus is enough to settle
    fireEvent.click(
      screen.getByText('Search every project').closest('label')!.querySelector('input')!
    );

    await waitFor(() => expect(bridge.api.search.conversations).toHaveBeenCalledTimes(2));
    expect(bridge.api.search.conversations.mock.calls[1][0].projectHash).toBeUndefined();
  });

  it('marks the run the scan reported, at the scan’s own offsets', async () => {
    bridge.api.search.conversations.mockResolvedValue(ok(outcome({ results: [oneHit()] })));

    mount({ initialQuery: 'spawn' });

    const mark = await screen.findByLabelText('match for spawn');
    // The snippet says `…so I fixed the spawn helper today…`; offset 16, length 5.
    expect(mark.textContent).toBe('spawn');
  });

  it('opens a hit with the real session summary from the project list', async () => {
    bridge.api.search.conversations.mockResolvedValue(ok(outcome({ results: [oneHit()] })));
    const real: SessionSummary = sessionSummary({
      filename: 'aaaaaaaa-1111-2222-3333-444444444444.jsonl',
      estimatedCost: 1.25,
      messageCount: 42,
    });
    bridge.api.sessions.listByProject.mockResolvedValue(ok([real]));

    const { onOpenHit } = mount({ initialQuery: 'spawn' });

    fireEvent.click(await screen.findByText('Fixing the pty spawn'));

    await waitFor(() => expect(onOpenHit).toHaveBeenCalled());
    const [project, session, uuid] = onOpenHit.mock.calls[0];
    expect(project).toMatchObject({ hash: PROJECT.hash, realPath: PROJECT.realPath });
    // The summary carries the session's own figures, never zeroes we made up.
    expect(session).toBe(real);
    expect(uuid).toBe('msg-1');
  });

  it('refuses a hit whose session is no longer listed, and says why', async () => {
    bridge.api.search.conversations.mockResolvedValue(ok(outcome({ results: [oneHit()] })));
    bridge.api.sessions.listByProject.mockResolvedValue(ok([])); // deleted since the scan

    const { onOpenHit } = mount({ initialQuery: 'spawn' });

    fireEvent.click(await screen.findByText('Fixing the pty spawn'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/no longer/i);
    expect(onOpenHit).not.toHaveBeenCalled();
  });

  it('says how many matches there are when it is showing a sample', async () => {
    bridge.api.search.conversations.mockResolvedValue(
      ok(outcome({ results: [oneHit({ hitCount: 17 })] }))
    );

    mount({ initialQuery: 'spawn' });

    expect(await screen.findByText(/1 of 17 matches/)).toBeTruthy();
  });

  it('declares an empty result against what it actually read', async () => {
    bridge.api.search.conversations.mockResolvedValue(ok(outcome({ scanned: 128 })));

    mount({ initialQuery: 'spawn' });

    expect(await screen.findByText(/128 transcripts/)).toBeTruthy();
  });

  it('declares a truncated scan instead of presenting it as the whole answer', async () => {
    bridge.api.search.conversations.mockResolvedValue(
      ok(outcome({ results: [oneHit()], truncated: true }))
    );

    mount({ initialQuery: 'spawn' });

    expect(await screen.findByText(/older conversations were not read/i)).toBeTruthy();
  });
});
