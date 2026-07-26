import {
  scopesFromPayload,
  keysForScope,
  SCOPE_KEYS,
  ALL_SCOPES,
} from '../src/hooks/dataChangeScopes';
import { scopesForPath, type DataScope } from '../electron/modules/data-change-scope';
import { join } from 'path';

describe('scopesFromPayload', () => {
  it('passes a fully recognized payload through untouched', () => {
    expect(scopesFromPayload(['sessions', 'cost'])).toEqual(['sessions', 'cost']);
  });

  it('falls back to every scope when the payload is absent or not an array', () => {
    expect(scopesFromPayload(undefined)).toEqual(ALL_SCOPES);
    expect(scopesFromPayload(null)).toEqual(ALL_SCOPES);
    expect(scopesFromPayload('sessions')).toEqual(ALL_SCOPES);
    expect(scopesFromPayload({ 0: 'sessions' })).toEqual(ALL_SCOPES);
  });

  it('falls back to every scope when a single entry is unknown', () => {
    // Narrowing on a payload we don't fully understand would leave a view
    // silently stale — the worse failure.
    expect(scopesFromPayload(['sessions', 'not-a-scope'])).toEqual(ALL_SCOPES);
    expect(scopesFromPayload([42])).toEqual(ALL_SCOPES);
  });

  it('does not accept Object.prototype keys as scopes', () => {
    // The regression this module exists for: with a plain object lookup table,
    // `'constructor' in table` is true, so the payload validated and the caller
    // then tried to iterate a function.
    for (const proto of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(SCOPE_KEYS.has(proto)).toBe(false);
      expect(scopesFromPayload([proto])).toEqual(ALL_SCOPES);
      expect(keysForScope(proto)).toEqual([]);
    }
  });

  it('returns no keys for an unknown scope', () => {
    expect(keysForScope('nope')).toEqual([]);
  });
});

describe('scope table vs the main-process classifier', () => {
  const CLAUDE = join('/Users', 'tester', '.claude');
  const PROJECT = join(CLAUDE, 'projects', '-Users-tester-app');

  it('has a key group for every scope the classifier can emit', () => {
    // Guards the split brain: a new DataScope in the main process with no entry
    // here would silently invalidate nothing.
    const emitted = new Set<DataScope>();
    for (const p of [
      join(PROJECT, 'a.jsonl'),
      join(PROJECT, 'a', 'subagents', 'agent-1.jsonl'),
      join(PROJECT, 'a', 'workflows', 'wf.json'),
      join(CLAUDE, 'tasks', 'a', '1.json'),
      join(CLAUDE, 'plans', 'p.md'),
      join(CLAUDE, 'teams', 't', 'config.json'),
      join(CLAUDE, 'workflows', 'w.js'),
      join(CLAUDE, 'plugins', 'installed_plugins.json'),
    ]) {
      for (const s of scopesForPath(p, CLAUDE) ?? []) emitted.add(s);
    }
    expect(emitted.size).toBeGreaterThan(0);
    for (const scope of emitted) {
      expect(keysForScope(scope).length).toBeGreaterThan(0);
    }
  });

  it('never maps two scopes onto the same query key', () => {
    const seen = new Map<string, string>();
    for (const [scope, keys] of SCOPE_KEYS) {
      for (const key of keys) {
        expect(seen.has(key), `${key} claimed by both ${seen.get(key)} and ${scope}`).toBe(false);
        seen.set(key, scope);
      }
    }
  });
});
