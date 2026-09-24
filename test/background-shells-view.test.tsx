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
import { BackgroundShellSheet } from '../src/components/project/terminal/BackgroundShellSheet';
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

  it('opens a row onto a window over the session, and closes the list', () => {
    const { getByRole, queryByRole, getByLabelText, container } = mount([
      shell({ toolUseId: 'a' }),
    ]);
    fireEvent.click(getByRole('button', { name: /1 in background/ }));
    fireEvent.click(getByRole('button', { name: /Wait for the PR checks/ }));
    expect(queryByRole('dialog', { name: 'Background work' })).toBeNull();
    const win = getByRole('dialog');
    expect(win.getAttribute('aria-modal')).toBe('true');
    expect(win.textContent).toContain('gh pr checks 12 --watch');
    // It floats over the page: portalled, not drawn in the pill's place.
    expect(container.contains(win)).toBe(false);
    fireEvent.click(getByLabelText('Close'));
    expect(queryByRole('dialog')).toBeNull();
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

describe('BackgroundShellSheet', () => {
  function sheet(s: BackgroundShell, onClose: () => void = () => {}) {
    return render(
      <StrictMode>
        <BackgroundShellSheet shell={s} onClose={onClose} />
      </StrictMode>
    );
  }

  it('states what the transcript holds about an ended shell', () => {
    const { getByText, getByRole } = sheet(
      shell({
        toolUseId: 'a',
        state: 'done',
        exitCode: 0,
        startedAt: ago(20),
        endedAt: ago(4),
      })
    );
    const win = getByRole('dialog');
    expect(getByText('Wait for the PR checks')).toBeTruthy();
    expect(getByText('Finished 4 min ago · ran 16 min')).toBeTruthy();
    expect(win.textContent).toContain('gh pr checks 12 --watch');
    expect(getByText('16 min')).toBeTruthy();
    expect(getByText('Started in the background by Claude')).toBeTruthy();
    expect(getByRole('button', { name: 'Copy command' })).toBeTruthy();
  });

  it('says how a shell reached the background and who stopped it', () => {
    const { getByText, queryByText } = sheet(
      shell({
        toolUseId: 'b',
        via: 'timeout',
        timeoutS: 120,
        state: 'stopped',
        stoppedByClaude: true,
        endedAt: ago(1),
      })
    );
    expect(getByText('Moved to the background after its 120 s timeout')).toBeTruthy();
    expect(getByText('Claude, with TaskStop')).toBeTruthy();
    // No exit code is on record for a stopped shell, so none is shown.
    expect(queryByText('Exit code')).toBeNull();
  });

  it('shows a running shell as running, with no end', () => {
    const { getAllByText, queryByText } = sheet(shell({ toolUseId: 'c' }));
    expect(getAllByText(/12 min/).length).toBeGreaterThan(0);
    expect(queryByText('Ended')).toBeNull();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    sheet(shell({ toolUseId: 'd' }), onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
