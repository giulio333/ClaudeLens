import { describe, it, expect } from 'vitest';
import {
  compareVersions,
  parseClaudeCliVersion,
  parseLatestRelease,
  RELEASES_PAGE_URL,
} from '../electron/modules/update-checker';

describe('compareVersions', () => {
  it('orders plain semver triples', () => {
    expect(compareVersions('2.1.5', '2.1.6')).toBeLessThan(0);
    expect(compareVersions('2.2.0', '2.1.9')).toBeGreaterThan(0);
    expect(compareVersions('2.1.5', '2.1.5')).toBe(0);
  });

  it('compares parts numerically, not lexically', () => {
    expect(compareVersions('2.1.10', '2.1.9')).toBeGreaterThan(0);
    expect(compareVersions('2.10.0', '2.9.0')).toBeGreaterThan(0);
  });

  it('tolerates a leading v on either side', () => {
    expect(compareVersions('v2.2.0', '2.1.5')).toBeGreaterThan(0);
    expect(compareVersions('2.1.5', 'V2.1.5')).toBe(0);
  });

  it('treats missing parts as zero', () => {
    expect(compareVersions('2.1', '2.1.0')).toBe(0);
    expect(compareVersions('2.1', '2.1.1')).toBeLessThan(0);
  });

  it('sorts a pre-release before its release', () => {
    expect(compareVersions('2.2.0-beta.1', '2.2.0')).toBeLessThan(0);
    expect(compareVersions('2.2.0', '2.2.0-rc.1')).toBeGreaterThan(0);
    expect(compareVersions('2.2.0-alpha', '2.2.0-beta')).toBeLessThan(0);
  });
});

describe('parseLatestRelease', () => {
  const release = {
    tag_name: 'v2.2.0',
    name: 'ClaudeLens 2.2.0',
    html_url: 'https://github.com/giulio333/ClaudeLens/releases/tag/v2.2.0',
    published_at: '2026-07-01T10:00:00Z',
  };

  it('maps a newer release to updateAvailable=true', () => {
    const info = parseLatestRelease(release, '2.1.5');
    expect(info).not.toBeNull();
    expect(info!.updateAvailable).toBe(true);
    expect(info!.latestVersion).toBe('2.2.0'); // v prefix stripped
    expect(info!.currentVersion).toBe('2.1.5');
    expect(info!.releaseName).toBe('ClaudeLens 2.2.0');
    expect(info!.releaseUrl).toBe(release.html_url);
    expect(info!.publishedAt).toBe(release.published_at);
  });

  it('reports up-to-date when running the latest (or a newer dev) build', () => {
    expect(parseLatestRelease(release, '2.2.0')!.updateAvailable).toBe(false);
    expect(parseLatestRelease(release, '2.3.0')!.updateAvailable).toBe(false);
  });

  it('rejects payloads without a version-shaped tag', () => {
    expect(parseLatestRelease(null, '2.1.5')).toBeNull();
    expect(parseLatestRelease({}, '2.1.5')).toBeNull();
    expect(parseLatestRelease({ tag_name: 'latest' }, '2.1.5')).toBeNull();
    expect(parseLatestRelease('v2.2.0', '2.1.5')).toBeNull();
  });

  it('falls back to the releases page for a missing/non-https html_url', () => {
    const noUrl = parseLatestRelease({ tag_name: 'v2.2.0' }, '2.1.5');
    expect(noUrl!.releaseUrl).toBe(RELEASES_PAGE_URL);
    const badUrl = parseLatestRelease(
      { tag_name: 'v2.2.0', html_url: 'javascript:alert(1)' },
      '2.1.5'
    );
    expect(badUrl!.releaseUrl).toBe(RELEASES_PAGE_URL);
  });

  it('normalizes a blank release name to null', () => {
    const info = parseLatestRelease({ tag_name: 'v2.2.0', name: '  ' }, '2.1.5');
    expect(info!.releaseName).toBeNull();
  });
});

describe('parseClaudeCliVersion', () => {
  it('reads the version out of `claude --version`', () => {
    expect(parseClaudeCliVersion('2.1.232 (Claude Code)\n')).toBe('2.1.232');
    expect(parseClaudeCliVersion('  2.1.232 (Claude Code)  ')).toBe('2.1.232');
    expect(parseClaudeCliVersion('2.2.0-beta.1 (Claude Code)')).toBe('2.2.0-beta.1');
  });

  it('returns null when the output carries no version', () => {
    expect(parseClaudeCliVersion('')).toBeNull();
    expect(parseClaudeCliVersion('command not found: claude')).toBeNull();
  });

  it('feeds a comparison that flags an outdated CLI', () => {
    const installed = parseClaudeCliVersion('2.1.190 (Claude Code)')!;
    expect(compareVersions(installed, '2.1.232')).toBeLessThan(0);
    expect(
      compareVersions(parseClaudeCliVersion('2.2.0 (Claude Code)')!, '2.1.232')
    ).toBeGreaterThan(0);
  });
});
