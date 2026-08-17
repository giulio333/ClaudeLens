// @vitest-environment jsdom
//
// The Monitor page. Its two data sources are unit tested on the main side
// (`session-tails.test.ts`, `sessions-registry-reader.test.ts`); what only this
// side can prove is the join and the triage that follow from it:
//
//   1. the registry decides a cell's STATE (a `waiting` session is blocked on
//      you and sorts to the front), the transcript tail decides what it SAYS;
//   2. a session the registry no longer lists is not gone from the grid — it
//      becomes an `ended` cell via its retained digest, which is the only
//      reason that digest is retained at all;
//   3. a live background agent appears here but routes to Agent View instead of
//      growing a second copy of its controls.

import { createElement, type ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

import { MonitorView } from '../src/components/project/monitor/MonitorView';
import { buildTrace } from '../src/components/project/monitor/trace';
import { installFakeElectronAPI, ok, type FakeBridge } from './helpers/fake-electron-api';
import type { ActiveSession, SessionActivity, BgSession } from '../src/types';

const PROJECT = { hash: '-Users-alice-Projects-acme', realPath: '/Users/alice/Projects/acme' };

function activeSession(over: Partial<ActiveSession> = {}): ActiveSession {
  return {
    pid: 4242,
    sessionId: 'sess-1',
    cwd: PROJECT.realPath,
    name: 'acme-7c',
    kind: 'interactive',
    status: 'busy',
    startedAt: Date.now() - 60_000,
    source: 'registry',
    ...over,
  };
}

function activity(over: Partial<SessionActivity> = {}): SessionActivity {
  return {
    sessionId: 'sess-1',
    title: null,
    cwd: PROJECT.realPath,
    recent: [],
    transcriptPath: '/Users/alice/.claude/projects/-Users-alice-Projects-acme/sess-1.jsonl',
    activity: 'busy',
    lastTool: { name: 'Bash', arg: 'npm test' },
    delegates: [],
    lastActivityAt: Date.now() - 5_000,
    toolCount: 3,
    errorCount: 0,
    model: 'claude-opus-5',
    endedAt: null,
    ...over,
  };
}

function bgSession(over: Partial<BgSession> = {}): BgSession {
  return {
    id: 'job-9',
    sessionId: 'sess-agent',
    name: 'docs-sweeper',
    state: 'running',
    tempo: 'busy',
    detail: 'rewriting the README',
    intent: 'sweep the docs',
    result: null,
    cwd: PROJECT.realPath,
    projectName: 'acme',
    template: 'bg',
    inFlightTasks: 1,
    alive: true,
    pid: 5150,
    createdAt: new Date(Date.now() - 120_000).toISOString(),
    updatedAt: new Date(Date.now() - 30_000).toISOString(),
    needs: null,
    hasPendingQuestion: false,
    ...over,
  };
}

let bridge: FakeBridge;
let queryClient: QueryClient;
const onOpenSession = vi.fn();
const onOpenAgents = vi.fn();

beforeEach(() => {
  bridge = installFakeElectronAPI();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  bridge.api.memory.listProjects.mockResolvedValue(ok([PROJECT]));
  onOpenSession.mockClear();
  onOpenAgents.mockClear();
});

afterEach(() => {
  cleanup();
  bridge.restore();
});

function mount() {
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MonitorView, {
        onBack: () => {},
        onOpenSession,
        onOpenAgents,
        embedded: true,
      })
    ) as ReactNode
  );
}

describe('MonitorView', () => {
  it('says what a running session is doing, from the tail and not the registry', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession()]));
    bridge.api.live.getActivity.mockResolvedValue(ok([activity()]));
    const view = mount();

    // Titled by the project a person recognises. The CLI's derived session name
    // ("acme-7c") is deliberately never shown: it is the project name plus two
    // random characters, so beside the project it said nothing.
    expect(await screen.findByText('acme')).toBeTruthy();
    expect(screen.queryByText('acme-7c')).toBeNull();
    // The pid is what tells two sessions of one project apart.
    expect(screen.getByText(/pid 4242/)).toBeTruthy();
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('npm test')).toBeTruthy();
    expect(view.container.querySelector('[data-state="working"]')).toBeTruthy();
  });

  // Three sessions of one project used to read `ClaudeLens · pid 63833` three
  // times over, and a user reported on the wrong card. The conversation title
  // Claude writes into the transcript is the name a person recognises; the
  // registry's derived `name` still is not, and the pid is now only a fallback.
  it('tells two sessions of one project apart by their titles', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([
        activeSession({ sessionId: 'sess-1', pid: 111 }),
        activeSession({ sessionId: 'sess-2', pid: 222 }),
      ])
    );
    bridge.api.live.getActivity.mockResolvedValue(
      ok([
        activity({ sessionId: 'sess-1', title: 'Sessione di test' }),
        activity({ sessionId: 'sess-2', title: 'Monitor rewrite' }),
      ])
    );
    mount();

    // The title is the whole ident; the pid is not carried alongside it.
    // The ident span also holds the model, so match within it.
    expect(await screen.findByText(/Sessione di test/)).toBeTruthy();
    expect(screen.getByText(/Monitor rewrite/)).toBeTruthy();
    expect(screen.queryByText(/pid 111/)).toBeNull();
    expect(screen.queryByText('acme-7c')).toBeNull();
  });

  it('falls back to the pid when no title has been seen', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession()]));
    bridge.api.live.getActivity.mockResolvedValue(ok([activity({ title: null })]));
    mount();

    const ident = await screen.findByText(/pid 4242/);
    expect(ident.textContent).toBe('pid 4242 · Opus 5');
  });

  // A title is a sentence Claude wrote, so the 380px row clips it: the tooltip is
  // where the whole of it stays reachable.
  it('keeps a long title recoverable in the tooltip', async () => {
    const long = 'Test Monitor per cambi di stato processo e tail dei sidecar';
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession()]));
    bridge.api.live.getActivity.mockResolvedValue(ok([activity({ title: long })]));
    mount();

    const ident = await screen.findByText(new RegExp(long.slice(0, 20)));
    expect(ident.getAttribute('title')).toBe(long);
  });

  // The clock is the card's biggest number and answers one question in every
  // state: how long it has been in THIS state. It used to count from the last
  // append, so a working card reset it at every tool — measuring the silence the
  // pulse strip already draws, and never the length of the turn.
  it('counts the clock from the state transition, not from the last append', async () => {
    const now = Date.now();
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([activeSession({ status: 'busy', statusUpdatedAt: now - 185_000 })])
    );
    bridge.api.live.getActivity.mockResolvedValue(ok([activity({ lastActivityAt: now - 4_000 })]));
    mount();

    // 3:05 since the turn began, not 0:04 since the last tool.
    expect(await screen.findByText('3:05')).toBeTruthy();
    expect(screen.queryByText('0:04')).toBeNull();
  });

  it('marks a waiting session as blocked and says what it waits on', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([activeSession({ status: 'waiting', waitingFor: 'permission prompt' })])
    );
    // The tail still reports its last tool: the registry decides the state.
    bridge.api.live.getActivity.mockResolvedValue(ok([activity()]));
    const view = mount();

    expect(await screen.findByText('permission prompt')).toBeTruthy();
    expect(screen.getByText('NEEDS YOU')).toBeTruthy();
    expect(view.container.querySelector('[data-state="blocked"]')).toBeTruthy();
    expect(view.container.querySelector('[data-state="working"]')).toBeNull();
  });

  it('sorts what needs you ahead of what is merely running', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([
        activeSession({ sessionId: 'busy-one', pid: 1 }),
        activeSession({
          sessionId: 'blocked-one',
          pid: 2,
          cwd: '/Users/alice/Projects/beta',
          status: 'waiting',
          waitingFor: 'permission prompt',
        }),
      ])
    );
    const view = mount();
    await screen.findByText('beta');

    const names = [...view.container.querySelectorAll('.cl-mx-head h3')].map(n => n.textContent);
    expect(names).toEqual(['beta', 'acme']);
  });

  // The bug this pins: a finished turn reading as if it were still running.
  it('calls a session that finished its turn ready, not working', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession({ status: 'idle' })]));
    bridge.api.live.getActivity.mockResolvedValue(
      ok([activity({ activity: 'idle', lastTool: null })])
    );
    const view = mount();

    expect(await screen.findByText('READY')).toBeTruthy();
    expect(screen.getByText('waiting for your next prompt')).toBeTruthy();
    expect(view.container.querySelector('[data-state="working"]')).toBeNull();
  });

  // Regression, observed live on 2.1.233: an async `Agent` dispatch gets its ack
  // in 31ms and the assistant closes the turn with `end_turn`, so the TAIL reads
  // idle while the sub-agent runs for minutes. The registry, which stays `busy`,
  // is the only source that still knows. Reading the tail alone told the user to
  // type at a session that was working.
  it('does not call a session ready while the registry still says busy', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession({ status: 'busy' })]));
    bridge.api.live.getActivity.mockResolvedValue(
      ok([activity({ activity: 'idle', lastTool: null })])
    );
    const view = mount();

    expect(await screen.findByText('WORKING')).toBeTruthy();
    expect(screen.queryByText('waiting for your next prompt')).toBeNull();
    expect(view.container.querySelector('[data-state="ready"]')).toBeNull();
  });

  it('names the sub-agent a session is waiting on, without borrowing its tools', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession({ status: 'busy' })]));
    bridge.api.live.getActivity.mockResolvedValue(
      ok([
        activity({
          activity: 'idle',
          lastTool: null,
          toolCount: 13,
          delegates: [{ id: 'toolu_1', name: 'Explore', at: Date.now() - 148_000 }],
        }),
      ])
    );
    const view = mount();

    expect(await screen.findByText('Explore')).toBeTruthy();
    expect(screen.getByText('sub-agent running')).toBeTruthy();
    expect(view.container.querySelector('[data-state="working"]')).toBeTruthy();
    // The session's own tally, not the sub-agent's work.
    expect(screen.getByText('13 tools')).toBeTruthy();
  });

  it('counts the agents when more than one is in flight', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession({ status: 'busy' })]));
    bridge.api.live.getActivity.mockResolvedValue(
      ok([
        activity({
          activity: 'idle',
          lastTool: null,
          delegates: [
            { id: 'a', name: 'Explore', at: Date.now() - 60_000 },
            { id: 'b', name: 'Plan', at: Date.now() - 30_000 },
          ],
        }),
      ])
    );
    mount();

    expect(await screen.findByText('Explore +1')).toBeTruthy();
    expect(screen.getByText('sub-agents running')).toBeTruthy();
  });

  it("lets the session's own tool win over a delegate still in flight", async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession({ status: 'busy' })]));
    bridge.api.live.getActivity.mockResolvedValue(
      ok([
        activity({
          lastTool: { name: 'Bash', arg: 'npm test' },
          delegates: [{ id: 'toolu_1', name: 'Explore', at: Date.now() - 10_000 }],
        }),
      ])
    );
    mount();

    // What it is doing right now is more current than what it is waiting on.
    expect(await screen.findByText('Bash')).toBeTruthy();
    expect(screen.queryByText('sub-agent running')).toBeNull();
  });

  // A registry file written before its first status transition: observed on a
  // session that lived 2.4s. Reading the absence as "working" put a card that
  // had never done anything above the sessions that were actually running.
  it('treats a registry entry with no status yet as ready, not working', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession({ status: 'unknown' })]));
    bridge.api.live.getActivity.mockResolvedValue(ok([]));
    const view = mount();

    expect(await screen.findByText('READY')).toBeTruthy();
    expect(view.container.querySelector('[data-state="working"]')).toBeNull();
  });

  it('never claims a state the transcript has not shown', async () => {
    // A brand-new session: the registry file exists, the transcript does not yet.
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession({ status: 'busy' })]));
    bridge.api.live.getActivity.mockResolvedValue(ok([]));
    mount();

    expect(await screen.findByText('starting up')).toBeTruthy();
  });

  it('follows a push instead of waiting for a refetch', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession()]));
    bridge.api.live.getActivity.mockResolvedValue(ok([activity()]));
    mount();
    expect(await screen.findByText('npm test')).toBeTruthy();

    bridge.channels.sessionActivity.emit([
      activity({ lastTool: { name: 'Edit', arg: '…/src/main.ts' } }),
    ]);

    expect(await screen.findByText('…/src/main.ts')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('keeps an ended session in the rack, with what it did', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession()]));
    bridge.api.live.getActivity.mockResolvedValue(ok([activity()]));
    const view = mount();
    await screen.findByText('npm test');

    // The session leaves the registry; its digest survives, marked ended.
    bridge.channels.activeSessions.emit([]);
    bridge.channels.sessionActivity.emit([
      activity({ endedAt: Date.now(), toolCount: 12, errorCount: 2 }),
    ]);

    expect(await screen.findByText('finished with 2 failed')).toBeTruthy();
    expect(screen.getByText(/12 tools/)).toBeTruthy();
    await waitFor(() => expect(view.container.querySelector('[data-state="ended"]')).toBeTruthy());
    expect(view.container.querySelector('[data-state="working"]')).toBeNull();
  });

  it('lets the registry win when an ended id is live again', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession()]));
    // A stale digest still carrying endedAt for a session that is running.
    bridge.api.live.getActivity.mockResolvedValue(ok([activity({ endedAt: Date.now() })]));
    const view = mount();

    await screen.findByText('acme');
    expect(view.container.querySelector('[data-state="working"]')).toBeTruthy();
    expect(view.container.querySelector('[data-state="ended"]')).toBeNull();
  });

  it('opens a session card in its Mission Control', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession()]));
    bridge.api.live.getActivity.mockResolvedValue(ok([activity()]));
    mount();

    fireEvent.click(await screen.findByText('acme'));

    expect(onOpenSession).toHaveBeenCalledWith(PROJECT, 'sess-1');
  });

  it('shows a live background agent but routes it to Agent View', async () => {
    bridge.api.live.getSessions.mockResolvedValue(ok([bgSession()]));
    mount();

    fireEvent.click(await screen.findByText('agent docs-sweeper'));

    expect(onOpenAgents).toHaveBeenCalled();
    // Routing only: the Monitor never grows its own stop/respawn controls.
    expect(screen.queryByText('Stop')).toBeNull();
    expect(screen.queryByText('Respawn')).toBeNull();
  });

  it('leaves finished background agents to Agent View entirely', async () => {
    bridge.api.live.getSessions.mockResolvedValue(
      ok([bgSession({ alive: false, state: 'done', name: 'finished-worker' })])
    );
    mount();

    await waitFor(() => expect(bridge.api.live.getSessions).toHaveBeenCalled());
    expect(screen.queryByText('agent finished-worker')).toBeNull();
  });

  it('says nothing is running rather than showing empty lanes', async () => {
    mount();
    expect(
      await screen.findByText(/Nothing is running\. Start a session in a terminal/)
    ).toBeTruthy();
  });

  it('unsubscribes from both live channels when it unmounts', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession()]));
    const view = mount();
    await screen.findByText('acme');

    expect(bridge.channels.sessionActivity.listenerCount).toBe(1);
    expect(bridge.channels.activeSessions.listenerCount).toBe(1);

    view.unmount();

    expect(bridge.channels.sessionActivity.listenerCount).toBe(0);
    expect(bridge.channels.activeSessions.listenerCount).toBe(0);
  });
});

// The pulse strip is what separates a session mid-tool from a hung one, so its
// bucketing is worth pinning: marks land where their timestamp says, silence is
// silence, and the run AFTER the last mark is the part a blocked card paints in
// the accent.
describe('buildTrace', () => {
  const NOW = 1_800_000_000_000;

  it('drops a mark into the bucket its timestamp falls in', () => {
    const bars = buildTrace([{ at: NOW - 1_000, kind: 'tool' }], NOW);
    expect(bars).toHaveLength(42);
    // Newest marks sit at the right edge: the strip ends at now.
    expect(bars[41].quiet).toBe(false);
    expect(bars[0].quiet).toBe(true);
  });

  it('ignores marks outside the window instead of clamping them into it', () => {
    const bars = buildTrace(
      [
        { at: NOW - 500_000, kind: 'tool' }, // long before the strip starts
        { at: NOW + 5_000, kind: 'tool' }, // clock skew, in the future
      ],
      NOW
    );
    expect(bars.every(b => b.quiet)).toBe(true);
  });

  it('stacks marks in one bucket and flags a failure', () => {
    const busy = buildTrace(
      [
        { at: NOW - 1_000, kind: 'tool' },
        { at: NOW - 900, kind: 'tool' },
        { at: NOW - 800, kind: 'tool' },
      ],
      NOW
    );
    expect(busy[41].h).toBeCloseTo(1);
    expect(busy[41].failed).toBe(false);

    const failed = buildTrace([{ at: NOW - 1_000, kind: 'error' }], NOW);
    expect(failed[41].failed).toBe(true);
  });

  it('weighs an answer lighter than a tool call', () => {
    const talking = buildTrace([{ at: NOW - 1_000, kind: 'text' }], NOW);
    const working = buildTrace([{ at: NOW - 1_000, kind: 'tool' }], NOW);
    expect(talking[41].h).toBeLessThan(working[41].h);
  });

  it('leaves the run after the last mark quiet — the silence a blocked card paints', () => {
    // One action 60s ago, nothing since: two thirds of the strip is the wait.
    const bars = buildTrace([{ at: NOW - 60_000, kind: 'tool' }], NOW);
    const lastLoud = bars.reduce((last, bar, i) => (bar.quiet ? last : i), -1);
    expect(lastLoud).toBeGreaterThan(0);
    expect(bars.slice(lastLoud + 1).every(b => b.quiet)).toBe(true);
    expect(bars.length - lastLoud - 1).toBeGreaterThan(20);
  });
});
