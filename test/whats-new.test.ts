import { describe, it, expect } from 'vitest';
import { shouldShowWhatsNew, whatsNewFor, WHATS_NEW } from '../src/data/whats-new';
import { version as appVersion } from '../package.json';

describe('shouldShowWhatsNew', () => {
  it('shows when the version has content and was never seen', () => {
    expect(shouldShowWhatsNew('2.2.23', null, true)).toBe(true);
  });

  it('shows again after an update, even if a previous version was seen', () => {
    expect(shouldShowWhatsNew('2.2.23', '2.2.22', true)).toBe(true);
  });

  it('stays hidden once this exact version was marked seen', () => {
    expect(shouldShowWhatsNew('2.2.23', '2.2.23', true)).toBe(false);
  });

  it('never shows for a version with no authored content, seen or not', () => {
    expect(shouldShowWhatsNew('2.2.23', null, false)).toBe(false);
    expect(shouldShowWhatsNew('2.2.23', '2.2.22', false)).toBe(false);
  });
});

describe('whatsNewFor', () => {
  it('finds the entry for a version that has one', () => {
    const [first] = WHATS_NEW;
    expect(whatsNewFor(first.version)).toBe(first);
  });

  it('returns undefined for a version nobody authored', () => {
    expect(whatsNewFor('0.0.1-does-not-exist')).toBeUndefined();
  });
});

// The lookup is an exact string match and the popup is silent on a miss, so a
// typo in an entry's version — or an entry written for a version nobody bumped
// to — ships as "nothing new" and no one notices. These are the guards.
describe('WHATS_NEW entries', () => {
  const SEMVER = /^\d+\.\d+\.\d+$/;
  const parse = (v: string) => v.split('.').map(Number);
  const newerThan = (a: string, b: string) => {
    const [x, y] = [parse(a), parse(b)];
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  };

  it('are keyed by a plain semver version', () => {
    for (const r of WHATS_NEW) expect(r.version).toMatch(SEMVER);
  });

  it('never name a version newer than the app itself', () => {
    for (const r of WHATS_NEW) expect(newerThan(r.version, appVersion)).toBe(false);
  });

  it('are unique and listed newest first', () => {
    const versions = WHATS_NEW.map(r => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (let i = 1; i < versions.length; i++)
      expect(newerThan(versions[i - 1], versions[i])).toBe(true);
  });

  it('each carry at least one highlight', () => {
    for (const r of WHATS_NEW) expect(r.highlights.length).toBeGreaterThan(0);
  });
});
