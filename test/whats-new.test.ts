import { describe, it, expect } from 'vitest';
import {
  latestWhatsNew,
  releasesBefore,
  releasesBetween,
  shouldShowWhatsNew,
  whatsNewFor,
  WHATS_NEW,
  type WhatsNewRelease,
} from '../src/data/whats-new';
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

// The releases around the one on screen. The list is passed in, so these hold
// whatever the real one says by the next release.
describe('releases around the one on screen', () => {
  const entry = (version: string): WhatsNewRelease => ({
    version,
    highlights: [{ title: version, description: '' }],
  });
  const LIST = ['2.3.0', '2.2.27', '2.2.26', '2.2.24', '2.2.10'].map(entry);
  const versions = (rs: WhatsNewRelease[]) => rs.map(r => r.version);

  it('names what was skipped between the last one seen and the one on screen, both excluded', () => {
    expect(versions(releasesBetween('2.2.24', '2.2.27', LIST))).toEqual(['2.2.26']);
    expect(versions(releasesBetween('2.2.9', '2.3.0', LIST))).toEqual([
      '2.2.27',
      '2.2.26',
      '2.2.24',
      '2.2.10',
    ]);
  });

  it('compares versions as numbers, never as strings', () => {
    // '2.2.10' < '2.2.9' as a string; as a version it is the newer one.
    expect(versions(releasesBetween('2.2.9', '2.2.24', LIST))).toEqual(['2.2.10']);
  });

  it('skipped nothing when the last one seen is the one right before', () => {
    expect(releasesBetween('2.2.26', '2.2.27', LIST)).toEqual([]);
  });

  it('lists every entry before a version, newest first', () => {
    expect(versions(releasesBefore('2.2.26', LIST))).toEqual(['2.2.24', '2.2.10']);
  });

  it('reopens the newest entry no newer than the running app', () => {
    expect(latestWhatsNew('2.2.27', LIST)?.version).toBe('2.2.27');
    // a fix-only release reopens the last one that had something to show
    expect(latestWhatsNew('2.2.25', LIST)?.version).toBe('2.2.24');
    expect(latestWhatsNew('2.2.1', LIST)).toBeUndefined();
  });
});
