import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectWorkflowWatchSync,
  projectHashForRegistryEvent,
} from '../electron/modules/studio-watch-sync';

afterEach(() => {
  vi.useRealTimers();
});

describe('project workflow watcher sync', () => {
  it('refreshes once after a newly created transcript receives its cwd record', () => {
    vi.useFakeTimers();
    const invalidate = vi.fn();
    const notifyAfterSync = vi.fn();
    const sync = vi.fn(() => notifyAfterSync());
    const coordinator = createProjectWorkflowWatchSync({
      projectsDir: '/claude/projects',
      invalidate,
      sync,
      delayMs: 100,
    });
    const transcript = '/claude/projects/-Users-me-SARA2-0/session.jsonl';

    coordinator.onEvent(transcript); // add: the file may still be empty
    vi.advanceTimersByTime(50);
    coordinator.onEvent(transcript); // change: cwd is now readable

    vi.advanceTimersByTime(99);
    expect(invalidate).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith('-Users-me-SARA2-0');
    expect(sync).toHaveBeenCalledTimes(1);
    expect(notifyAfterSync).toHaveBeenCalledTimes(1);
  });

  it('stays silent while a live session appends to a resolved project', () => {
    // The regression: a transcript append is shaped exactly like a new
    // project's first write, so every one of them used to arm the timer and
    // fire the sync — whose `notify()` carries no scopes and therefore drops
    // every React Query cache (#148 inert during a live chat).
    vi.useFakeTimers();
    const invalidate = vi.fn();
    const sync = vi.fn();
    const coordinator = createProjectWorkflowWatchSync({
      projectsDir: '/claude/projects',
      invalidate,
      sync,
      isResolved: hash => hash === '-Users-me-repo',
      delayMs: 100,
    });

    for (let i = 0; i < 40; i++) {
      coordinator.onEvent('/claude/projects/-Users-me-repo/session.jsonl');
      vi.advanceTimersByTime(30); // appends land faster than the debounce
    }
    vi.advanceTimersByTime(500);

    expect(invalidate).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it('still reacts for a project whose cwd is not resolved yet', () => {
    vi.useFakeTimers();
    const invalidate = vi.fn();
    const sync = vi.fn();
    // A project appears; its cwd becomes readable only after the first record.
    const resolved = new Set<string>();
    const coordinator = createProjectWorkflowWatchSync({
      projectsDir: '/claude/projects',
      invalidate,
      sync: () => {
        resolved.add('-Users-me-new');
        sync();
      },
      isResolved: hash => resolved.has(hash),
      delayMs: 100,
    });

    coordinator.onEvent('/claude/projects/-Users-me-new'); // addDir
    coordinator.onEvent('/claude/projects/-Users-me-new/session.jsonl'); // add, still empty
    vi.advanceTimersByTime(100);
    expect(invalidate).toHaveBeenCalledWith('-Users-me-new');
    expect(sync).toHaveBeenCalledTimes(1);

    // Once resolved, the session's own appends no longer cost anything.
    coordinator.onEvent('/claude/projects/-Users-me-new/session.jsonl');
    vi.advanceTimersByTime(500);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('ignores paths outside the project registry and nested transcript artifacts', () => {
    expect(projectHashForRegistryEvent('/claude/projects', '/elsewhere/session.jsonl')).toBeNull();
    expect(
      projectHashForRegistryEvent(
        '/claude/projects',
        '/claude/projects/-Users-me-repo/session/subagents/agent.jsonl'
      )
    ).toBeNull();
  });
});
