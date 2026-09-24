// @vitest-environment jsdom
//
// The background-shells pill in a session's top bar: how many commands Claude
// left running and for how long, in words, and the list behind a click. It is
// a pill because it is state, not an event — so what is asserted is that it
// says the current state, and says nothing when there is none to say.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { BackgroundShells } from '../src/components/project/terminal/BackgroundShells';
import type { BackgroundShell } from '../src/components/project/terminal/background-shells';

const NOW = Date.parse('2026-08-11T11:00:00.000Z');
const ago = (min: number) => NOW - min * 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function shell(
  over: Partial<BackgroundShell> & Pick<BackgroundShell, 'toolUseId'>
): BackgroundShell {
  return {
    taskId: over.toolUseId,
    title: 'Wait for the PR checks',
    command: 'gh pr checks 12 --watch',
    state: 'running',
    startedAt: ago(12),
    via: 'requested',
    ...over,
  };
}

function mount(
  shells: BackgroundShell[],
  // When the CLI process running the session started; null = none runs it.
  liveSince: number | null = ago(60)
) {
  return render(
    <StrictMode>
      <BackgroundShells shells={shells} liveSince={liveSince} />
    </StrictMode>
  );
}

describe('BackgroundShells', () => {
  it('draws nothing for a session with no background shell', () => {
    const { container } = mount([]);
    expect(container.textContent).toBe('');
  });

  it('says one running shell and how long it has run, never the command', () => {
    const { getByRole, container } = mount([shell({ toolUseId: 'a' })]);
    const pill = getByRole('button', { name: /1 in background/ });
    expect(pill.textContent).toContain('12 min');
    expect(container.textContent).not.toContain('gh pr checks');
  });

  it('counts several running shells without a time', () => {
    const { getByRole } = mount([
      shell({ toolUseId: 'a' }),
      shell({ toolUseId: 'b', startedAt: ago(3) }),
      shell({ toolUseId: 'c', startedAt: ago(40) }),
    ]);
    expect(getByRole('button', { name: /3 in background/ }).textContent).not.toContain('min');
  });

  it('draws nothing once the session is gone', () => {
    const { container } = mount([shell({ toolUseId: 'a' })], null);
    expect(container.textContent).toBe('');
  });

  it('ignores a shell left by the process before a resume', () => {
    // Resumed 5 minutes ago; the shell is from the process that exited.
    const { container } = mount([shell({ toolUseId: 'a', startedAt: ago(12) })], ago(5));
    expect(container.textContent).toBe('');
  });

  it('reports the latest ending when nothing runs any more', () => {
    const { getByRole } = mount([
      shell({ toolUseId: 'a', state: 'done', exitCode: 0, endedAt: ago(8) }),
      shell({ toolUseId: 'b', state: 'failed', exitCode: 1, endedAt: ago(2) }),
    ]);
    expect(getByRole('button', { name: /Failed/ }).textContent).toContain('2 min ago');
  });

  it('opens the list on click, with each outcome said in words', () => {
    const { getByRole, getByText } = mount([
      shell({ toolUseId: 'a' }),
      shell({
        toolUseId: 'b',
        title: 'Package the app',
        state: 'failed',
        exitCode: 1,
        startedAt: ago(5),
        endedAt: ago(3),
      }),
    ]);
    fireEvent.click(getByRole('button', { name: /1 in background/ }));
    expect(getByRole('dialog', { name: 'Background work' })).toBeTruthy();
    expect(getByText('Running for 12 min')).toBeTruthy();
    expect(getByText('Failed 3 min ago · ran 2 min · exit code 1')).toBeTruthy();
  });

  it('opens a row onto what the transcript holds about the shell', () => {
    const { getByRole, getByText, queryByText } = mount([
      shell({
        toolUseId: 'a',
        state: 'done',
        exitCode: 0,
        startedAt: ago(20),
        endedAt: ago(4),
        outputFile: '/tmp/x/tasks/a.output',
      }),
      shell({
        toolUseId: 'b',
        title: 'Build',
        via: 'timeout',
        timeoutS: 120,
        stoppedByClaude: true,
        state: 'stopped',
        endedAt: ago(1),
      }),
    ]);
    fireEvent.click(getByRole('button', { name: /Finished|Stopped/ }));
    // Closed rows keep the command out of sight.
    expect(queryByText('gh pr checks 12 --watch')).toBeNull();
    const row = getByRole('button', { name: /Wait for the PR checks/ });
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(getByText('gh pr checks 12 --watch')).toBeTruthy();
    expect(getByText('16 min')).toBeTruthy();
    expect(getByText('Started there by Claude')).toBeTruthy();
    expect(getByText('a.output')).toBeTruthy();
    // One row open at a time.
    fireEvent.click(getByRole('button', { name: /^Build/ }));
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(getByText('Moved there after its 120 s timeout')).toBeTruthy();
    expect(getByText('By Claude, with TaskStop')).toBeTruthy();
  });

  it('closes on Escape and on a click outside', () => {
    const { getByRole, queryByRole } = mount([shell({ toolUseId: 'a' })]);
    const pill = getByRole('button', { name: /1 in background/ });
    fireEvent.click(pill);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByRole('dialog')).toBeNull();
    fireEvent.click(pill);
    fireEvent.mouseDown(document.body);
    expect(queryByRole('dialog')).toBeNull();
  });
});
