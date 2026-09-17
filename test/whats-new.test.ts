import { describe, it, expect } from 'vitest';
import { shouldShowWhatsNew, whatsNewFor, WHATS_NEW } from '../src/data/whats-new';

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
