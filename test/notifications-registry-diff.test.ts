import {
  createRegistryDiffState,
  diffRegistry,
  type DiffDeps,
} from '../electron/modules/notifications/registry-diff';
import type { ActiveSession } from '../electron/modules/sessions-registry-reader';

let counter: number;
const deps: DiffDeps = {
  now: () => 1000,
  mkId: () => `id-${counter++}`,
};

function session(over: Partial<ActiveSession> = {}): ActiveSession {
  return {
    pid: 1,
    sessionId: 's1',
    cwd: '/Users/foo/proj',
    status: 'busy',
    source: 'registry',
    ...over,
  };
}

beforeEach(() => {
  counter = 0;
});

describe('diffRegistry', () => {
  it('emits nothing on the first (warm-up) snapshot, even for waiting sessions', () => {
    const state = createRegistryDiffState();
    const events = diffRegistry([session({ status: 'waiting' })], state, deps);
    expect(events).toEqual([]);
    expect(state.primed).toBe(true);
  });

  it('emits needs-attention on the busy -> waiting transition', () => {
    const state = createRegistryDiffState();
    diffRegistry([session({ status: 'busy' })], state, deps); // warm-up
    const events = diffRegistry(
      [session({ status: 'waiting', waitingFor: 'permission prompt' })],
      state,
      deps
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'needs-attention',
      sessionId: 's1',
      cwd: '/Users/foo/proj',
      body: 'permission prompt',
      source: 'registry',
    });
  });

  it('emits completed on the busy -> idle transition (turn finished)', () => {
    const state = createRegistryDiffState();
    diffRegistry([session({ status: 'busy' })], state, deps); // warm-up
    const events = diffRegistry([session({ status: 'idle' })], state, deps);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'completed',
      sessionId: 's1',
      body: 'proj', // last segment of /Users/foo/proj
      source: 'registry',
    });
  });

  it('does not emit completed for an idle session that was never busy', () => {
    const state = createRegistryDiffState();
    diffRegistry([session({ status: 'idle' })], state, deps); // warm-up (idle)
    const events = diffRegistry([session({ status: 'idle' })], state, deps);
    expect(events).toEqual([]);
  });

  it('does not re-emit while the session stays waiting (dedup by transition)', () => {
    const state = createRegistryDiffState();
    diffRegistry([session({ status: 'busy' })], state, deps); // warm-up
    diffRegistry([session({ status: 'waiting' })], state, deps); // first flip -> 1 event
    const again = diffRegistry([session({ status: 'waiting' })], state, deps);
    expect(again).toEqual([]);
  });

  it('re-emits after the session leaves and re-enters waiting', () => {
    const state = createRegistryDiffState();
    diffRegistry([session({ status: 'busy' })], state, deps); // warm-up
    diffRegistry([session({ status: 'waiting' })], state, deps);
    diffRegistry([session({ status: 'busy' })], state, deps); // back to work
    const events = diffRegistry([session({ status: 'waiting' })], state, deps);
    expect(events).toHaveLength(1);
  });

  it('ignores fallback (process-scan) entries with no session id', () => {
    const state = createRegistryDiffState();
    diffRegistry([], state, deps); // warm-up
    const events = diffRegistry(
      [session({ sessionId: '', status: 'waiting', source: 'process-scan' })],
      state,
      deps
    );
    expect(events).toEqual([]);
  });

  it('tracks multiple sessions independently', () => {
    const state = createRegistryDiffState();
    const a = session({ sessionId: 'a', status: 'busy' });
    const b = session({ sessionId: 'b', status: 'busy' });
    diffRegistry([a, b], state, deps); // warm-up
    const events = diffRegistry(
      [{ ...a, status: 'waiting' }, b],
      state,
      deps
    );
    expect(events).toHaveLength(1);
    expect(events[0].sessionId).toBe('a');
  });
});
