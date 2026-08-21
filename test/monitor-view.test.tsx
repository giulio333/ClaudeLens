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
import { buildTape } from '../src/components/project/monitor/trace';
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
    context: null,
    spend: null,
    spendEstimated: false,
    tokens: 0,
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
    // The pid has a field of its own in the machine row — it is what you need to
    // `kill`, and nothing there truncates it.
    expect(screen.getByText('pid 4242')).toBeTruthy();
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('npm test')).toBeTruthy();
    expect(view.container.querySelector('[data-state="working"]')).toBeTruthy();
  });

  // Three sessions of one project used to read `ClaudeLens · pid 63833` three
  // times over, and a user reported on the wrong card. The conversation title
  // Claude writes into the transcript is the name a person recognises; the
  // registry's derived `name` still is not, and the pid lives in its own field.
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
    const view = mount();
    await screen.findByText('Monitor rewrite');

    // The title is the whole ident: nothing is glued to it, because a title long
    // enough to need the CSS ellipsis ate whatever followed. The pid and the
    // model are their own fields, one row down.
    const idents = [...view.container.querySelectorAll('.cl-mx-who .ident')].map(
      n => n.textContent
    );
    expect(idents).toEqual(['Sessione di test', 'Monitor rewrite']);
    expect(screen.getByText('pid 111')).toBeTruthy();
    expect(screen.getByText('pid 222')).toBeTruthy();
    expect(screen.queryByText('acme-7c')).toBeNull();
  });

  // The pid used to be the fallback ident. It cannot be any more: it now has a
  // permanent field of its own, so printing it here too said the same thing
  // twice on every session Claude has not named yet. The honest fallback is to
  // report the absence.
  it('reports a session with no title as unnamed rather than repeating its pid', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession()]));
    bridge.api.live.getActivity.mockResolvedValue(ok([activity({ title: null })]));
    const view = mount();

    expect(await screen.findByText('not named yet')).toBeTruthy();
    expect(view.container.querySelectorAll('.cl-mx-who .ident')).toHaveLength(1);
    // …and it is still one pid on the lane, in the machine row.
    expect(screen.getByText('pid 4242')).toBeTruthy();
    expect(screen.getByText('Opus 5')).toBeTruthy();
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

    const names = [...view.container.querySelectorAll('.cl-mx-who h3')].map(n => n.textContent);
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

  // The header carries the whole machine in one sentence — it replaced a 132px
  // page title on the one page that is about the next ninety seconds. What it
  // must never get wrong is the clause that asks for something.
  it('leads the header with the count that is waiting on you', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([
        activeSession({ sessionId: 'a', pid: 1 }),
        activeSession({ sessionId: 'b', pid: 2, status: 'waiting', waitingFor: 'a prompt' }),
        activeSession({ sessionId: 'c', pid: 3 }),
      ])
    );
    const view = mount();
    await screen.findByText('a prompt');

    const say = view.container.querySelector('.cl-mxtop-say');
    expect(say?.textContent).toBe('1 waiting on you, 2 working');
    // Only that clause is coloured: it is the only figure on the page asking for
    // anything.
    expect(view.container.querySelector('.cl-mxtop-say .alert')?.textContent).toBe(
      '1 waiting on you'
    );
  });

  it('says nothing is running in the header too, not only in the body', async () => {
    const view = mount();
    await screen.findByText(/Nothing is running\./);
    expect(view.container.querySelector('.cl-mxtop-say')?.textContent).toBe('Nothing is running');
  });

  // The machine row is why the pid came back and why the lane is wide: four
  // facts that a 320px card had no room for, each in a field of its own.
  it('prints the machine facts as their own fields', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([activeSession({ startedAt: Date.now() - 7_620_000 })])
    );
    bridge.api.live.getActivity.mockResolvedValue(ok([activity()]));
    const view = mount();
    await screen.findByText('acme');

    const machine = view.container.querySelector('.cl-mx-who .machine');
    expect(machine?.textContent).toBe('pid 4242·Opus 5·up 2h07');
  });

  // `projectForCwd` deliberately maps a monorepo subdirectory to the repo, so
  // the lane title says `acme` for a session started in `packages/api`. Without
  // this field two lanes of one repo would look like the same shell — and at the
  // repo root the same field would only repeat the title, so it is not printed.
  it('locates a session started below the project root, and only then', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([
        activeSession({ sessionId: 'root', pid: 1, startedAt: undefined }),
        activeSession({
          sessionId: 'sub',
          pid: 2,
          cwd: PROJECT.realPath + '/packages/api',
          startedAt: undefined,
        }),
      ])
    );
    bridge.api.live.getActivity.mockResolvedValue(ok([]));
    const view = mount();
    await waitFor(() =>
      expect(view.container.querySelectorAll('.cl-mx-who .machine')).toHaveLength(2)
    );

    const rows = [...view.container.querySelectorAll('.cl-mx-who .machine')].map(
      n => n.textContent
    );
    expect(rows).toContain('pid 2·./packages/api');
    expect(rows).toContain('pid 1');
  });

  // The figure under the strip's newest end says what the flat run there means.
  it('spells out the silence the strip draws, once it is worth saying', async () => {
    const now = Date.now();
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([
        activeSession({ sessionId: 'quiet', pid: 1 }),
        activeSession({ sessionId: 'busy', pid: 2 }),
      ])
    );
    bridge.api.live.getActivity.mockResolvedValue(
      ok([
        activity({ sessionId: 'quiet', lastActivityAt: now - 245_000 }),
        activity({ sessionId: 'busy', lastActivityAt: now - 2_000 }),
      ])
    );
    mount();

    expect(await screen.findByText('quiet 4m')).toBeTruthy();
    // Two seconds of silence is the gap between two tool calls, not a signal.
    expect(screen.queryByText('quiet 2s')).toBeNull();
  });

  // And when a sub-agent is running, the silence is explained rather than
  // reported: the parent transcript is quiet BECAUSE the work moved to a sidecar
  // this tail cannot see.
  it('lets a running sub-agent take the slot the silence would have had', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession({ status: 'busy' })]));
    bridge.api.live.getActivity.mockResolvedValue(
      ok([
        activity({
          activity: 'idle',
          lastTool: null,
          lastActivityAt: Date.now() - 148_000,
          delegates: [{ id: 'toolu_1', name: 'Explore', at: Date.now() - 148_000 }],
        }),
      ])
    );
    mount();

    expect(await screen.findByText('2m in flight')).toBeTruthy();
    expect(screen.queryByText('quiet 2m')).toBeNull();
  });

  // A background agent's work lives in the roster, not in a transcript this page
  // can tail. Drawing 42 empty buckets for it would read as a hung session.
  it('says a background agent has no strip instead of drawing an empty one', async () => {
    bridge.api.live.getSessions.mockResolvedValue(ok([bgSession()]));
    const view = mount();
    await screen.findByText('agent docs-sweeper');

    expect(screen.getByText('no transcript to tail')).toBeTruthy();
    expect(screen.getByText('open in Agent View ↗')).toBeTruthy();
    // The note takes a slot row; the rest stay ruled, so the card is the same
    // height as one that has a transcript to show.
    expect(view.container.querySelectorAll('.cl-mx-slot li')).toHaveLength(3);
    expect(view.container.querySelectorAll('.cl-mx-slot li.rule')).toHaveLength(2);
  });

  // The card says what the session is doing NOW in its own block, and what it
  // did in the slot below it. The in-flight call must never appear in both.
  it('prints the tape of what it did, with subjects, and never twice', async () => {
    const now = Date.now();
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession()]));
    bridge.api.live.getActivity.mockResolvedValue(
      ok([
        activity({
          lastTool: { name: 'Bash', arg: 'npm test' },
          recent: [
            { at: now - 50_000, kind: 'tool', tool: 'Read', arg: 'src/index.css' },
            { at: now - 40_000, kind: 'tool', tool: 'Edit', arg: 'trace.ts' },
            {
              at: now - 30_000,
              kind: 'tool',
              tool: 'Bash',
              arg: 'npm run typecheck',
              failed: true,
            },
            { at: now - 2_000, kind: 'tool', tool: 'Bash', arg: 'npm test' },
          ],
        }),
      ])
    );
    const view = mount();
    await screen.findByText('acme');

    const label = (n: Element) =>
      [...n.querySelectorAll('b, .arg')].map(c => c.textContent).join(' ');
    // NOW is its own block, not the first row of the history.
    expect(label(view.container.querySelector('.cl-mx-now')!)).toBe('Bash npm test');
    // The history, newest first — and `Bash npm test` is not repeated in it.
    expect([...view.container.querySelectorAll('.cl-mx-slot li:not(.rule)')].map(label)).toEqual([
      'Bash npm run typecheck',
      'Edit trace.ts',
      'Read src/index.css',
    ]);
    // Only the call whose result came back an error.
    expect(view.container.querySelectorAll('.cl-mx-slot li.failed')).toHaveLength(1);
  });

  // The whole point of the fixed form. A session that has run ten tools and one
  // that has run one are the same size on the page: the slot is three rows
  // either way, and the empty ones are ruled rather than left out.
  it('draws the same three rows whether the session did ten things or one', async () => {
    const now = Date.now();
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([
        activeSession({ sessionId: 'busy', pid: 1 }),
        activeSession({ sessionId: 'calm', pid: 2 }),
      ])
    );
    bridge.api.live.getActivity.mockResolvedValue(
      ok([
        activity({
          sessionId: 'busy',
          lastTool: null,
          recent: Array.from({ length: 10 }, (_, i) => ({
            at: now - (10 - i) * 5_000,
            kind: 'tool' as const,
            tool: 'Edit',
            arg: `f${i}.ts`,
          })),
        }),
        activity({
          sessionId: 'calm',
          lastTool: null,
          recent: [{ at: now - 4_000, kind: 'tool', tool: 'Read', arg: 'a.ts' }],
        }),
      ])
    );
    const view = mount();
    await screen.findAllByText('acme');

    const slots = [...view.container.querySelectorAll('.cl-mx-slot')];
    expect(slots.map(slot => slot.querySelectorAll('li').length)).toEqual([3, 3]);
    // The busy one fills its three; the calm one rules the two it cannot fill.
    expect(slots.map(slot => slot.querySelectorAll('li.rule').length)).toEqual([0, 2]);
  });

  // Three of eleven actions, printed silently, would read as a calm session.
  it('says how many actions it is not showing', async () => {
    const now = Date.now();
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession()]));
    bridge.api.live.getActivity.mockResolvedValue(
      ok([
        activity({
          lastTool: null,
          recent: Array.from({ length: 11 }, (_, i) => ({
            at: now - (11 - i) * 5_000,
            kind: 'tool' as const,
            tool: 'Edit',
            arg: `f${i}.ts`,
          })),
        }),
      ])
    );
    const view = mount();
    await screen.findByText('acme');

    expect(screen.getByText('+8')).toBeTruthy();
    // On the last row, where it reads as the end of the list — not the top.
    const rows = [...view.container.querySelectorAll('.cl-mx-slot li')];
    expect(rows[2].querySelector('.more')?.textContent).toBe('+8');
  });

  // CONTEXT is the one fact on this page you can only act on while the session
  // runs: past ~90% it is about to compact and lose fidelity. Three bands,
  // because the question is "how worried", not "how full".
  it('escalates the context gauge only when the window starts to matter', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([
        activeSession({ sessionId: 'calm', pid: 1 }),
        activeSession({ sessionId: 'tight', pid: 2 }),
        activeSession({ sessionId: 'full', pid: 3 }),
      ])
    );
    bridge.api.live.getActivity.mockResolvedValue(
      ok([
        activity({ sessionId: 'calm', context: { used: 60_000, max: 200_000 } }),
        activity({ sessionId: 'tight', context: { used: 160_000, max: 200_000 } }),
        activity({ sessionId: 'full', context: { used: 190_000, max: 200_000 } }),
      ])
    );
    const view = mount();
    await waitFor(() =>
      expect(view.container.querySelectorAll('.cl-mx-vitals .ctx')).toHaveLength(3)
    );

    const loads = [...view.container.querySelectorAll('.cl-mx-vitals .ctx')].map(n => [
      n.getAttribute('data-load'),
      n.querySelector('.v')?.textContent,
    ]);
    expect(loads).toEqual([
      ['ok', '30%'],
      ['high', '80%'],
      ['critical', '95%'],
    ]);
  });

  it('names the window in the gauge tooltip, since the bar only shows the share', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession()]));
    bridge.api.live.getActivity.mockResolvedValue(
      ok([activity({ context: { used: 278_231, max: 1_000_000 } })])
    );
    const view = mount();
    await screen.findByText('28%');
    expect(view.container.querySelector('.cl-mx-vitals .ctx')?.getAttribute('title')).toBe(
      'Context window: 278,231 of 1,000,000 tokens'
    );
  });

  it('prints what the session has spent, and says when the price is a guess', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(
      ok([
        activeSession({ sessionId: 'exact', pid: 1 }),
        activeSession({ sessionId: 'guess', pid: 2 }),
      ])
    );
    bridge.api.live.getActivity.mockResolvedValue(
      ok([
        activity({ sessionId: 'exact', spend: 1.239, tokens: 412_000 }),
        activity({ sessionId: 'guess', spend: 4.07, tokens: 1_200_000, spendEstimated: true }),
      ])
    );
    mount();

    expect(await screen.findByText('$1.24')).toBeTruthy();
    // A figure the pricing table cannot stand behind is marked, not quoted flat.
    expect(screen.getByText('~$4.07')).toBeTruthy();
    // The token tally is deliberately NOT on the card: it is the same fact in a
    // unit nobody budgets in, competing with the one figure that means something.
    expect(screen.queryByText(/412k/)).toBeNull();
  });

  // Absent, not zero. `$0.00` next to a worker burning tokens would be the one
  // wrong figure on the board, and the roster carries no usage at all.
  it('leaves the vitals of a background agent empty rather than inventing them', async () => {
    bridge.api.live.getSessions.mockResolvedValue(ok([bgSession()]));
    const view = mount();
    await screen.findByText('agent docs-sweeper');

    expect(view.container.querySelector('.cl-mx-vitals .ctx.is-none')).toBeTruthy();
    expect(view.container.querySelector('.cl-mx-vitals .money')).toBeNull();
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  // A session that has not had a turn yet has no reading, and saying 0% would
  // claim the window is empty when the truth is that nobody has looked.
  it('shows no context reading before the first turn', async () => {
    bridge.api.live.getActiveSessions.mockResolvedValue(ok([activeSession()]));
    bridge.api.live.getActivity.mockResolvedValue(ok([activity({ context: null })]));
    const view = mount();
    await screen.findByText('acme');

    expect(view.container.querySelector('.cl-mx-vitals .ctx.is-none')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
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

// The tape is the card's body and the reason the form is not empty: it says what
// the session DID, with the subject of each action. Worth pinning: what counts as
// one step, which end survives the cap, and that the in-flight call is never
// printed twice.
describe('buildTape', () => {
  const NOW = 1_800_000_000_000;
  const mark = (secondsAgo: number, tool: string, arg = '', failed = false) => ({
    at: NOW - secondsAgo * 1000,
    kind: 'tool' as const,
    tool,
    arg,
    ...(failed ? { failed } : {}),
  });

  it('reads newest first, with the subject of each action', () => {
    const tape = buildTape([mark(40, 'Read', 'src/index.css'), mark(10, 'Edit', 'trace.ts')], NOW);
    expect(tape.map(s => [s.tool, s.arg])).toEqual([
      ['Edit', 'trace.ts'],
      ['Read', 'src/index.css'],
    ]);
  });

  // The newest mark IS the call the card is already printing as its `now` row.
  // Without this the card shows the same action twice, once as "now" and once as
  // the top of its own history.
  it('drops the in-flight call when the card is already printing it', () => {
    const marks = [mark(30, 'Read', 'a.ts'), mark(2, 'Bash', 'npm test')];
    expect(buildTape(marks, NOW, { dropNewest: true }).map(s => s.tool)).toEqual(['Read']);
    expect(buildTape(marks, NOW).map(s => s.tool)).toEqual(['Bash', 'Read']);
  });

  // A retry loop is one thing happening three times, not three pieces of work.
  it('collapses an exact repeat and dates the row by its oldest call', () => {
    const tape = buildTape(
      [mark(30, 'Bash', 'npm test'), mark(20, 'Bash', 'npm test'), mark(10, 'Bash', 'npm test')],
      NOW
    );
    expect(tape).toHaveLength(1);
    expect(tape[0].count).toBe(3);
    // The row says when the loop started, not when it last spun.
    expect(tape[0].at).toBe(NOW - 30_000);
  });

  it('keeps two different subjects apart even for the same tool', () => {
    const tape = buildTape([mark(20, 'Edit', 'a.ts'), mark(10, 'Edit', 'b.ts')], NOW);
    expect(tape.map(s => s.arg)).toEqual(['b.ts', 'a.ts']);
  });

  it('carries a failure onto its row', () => {
    const tape = buildTape([mark(10, 'Bash', 'npm test', true)], NOW);
    expect(tape[0].failed).toBe(true);
  });

  // Prose marks the trace but is not a step of the story: a `text` mark between
  // two edits would break the sequence in half without adding anything to act on.
  it('leaves prose off the tape', () => {
    const tape = buildTape(
      [
        mark(30, 'Edit', 'a.ts'),
        { at: NOW - 20_000, kind: 'text' as const },
        mark(10, 'Edit', 'b.ts'),
      ],
      NOW
    );
    expect(tape.map(s => s.tool)).toEqual(['Edit', 'Edit']);
  });

  it('ignores marks outside the window instead of clamping them into it', () => {
    expect(
      buildTape(
        [
          mark(9_000, 'Read', 'old.ts'), // long before the window starts
          { at: NOW + 5_000, kind: 'tool' as const, tool: 'Bash' }, // clock skew
        ],
        NOW
      )
    ).toEqual([]);
  });

  // The cap lives on the card, not here: the slot prints three and has to say
  // how many it is leaving out, which it can only do if this hands over the
  // whole story. Newest first, so the rows the card keeps are the newest.
  it('returns the whole window, newest first, and caps nothing', () => {
    const marks = Array.from({ length: 10 }, (_, i) => mark(90 - i * 5, 'Edit', `f${i}.ts`));
    const tape = buildTape(marks, NOW);
    expect(tape).toHaveLength(10);
    expect(tape[0].arg).toBe('f9.ts');
    expect(tape[9].arg).toBe('f0.ts');
  });
});
