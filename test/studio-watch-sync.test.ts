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
