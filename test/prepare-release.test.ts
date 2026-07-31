import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseClaudeVersion, updatePackageJson } from '../scripts/prepare-release.js';

describe('parseClaudeVersion', () => {
  it('extracts semver from normal output', () => {
    expect(parseClaudeVersion('2.1.191 (Claude Code)')).toBe('2.1.191');
  });

  it('handles bare semver with no suffix', () => {
    expect(parseClaudeVersion('1.0.0')).toBe('1.0.0');
  });

  it('handles leading/trailing whitespace', () => {
    expect(parseClaudeVersion('  2.1.191 (Claude Code)\n')).toBe('2.1.191');
  });

  it('throws on unrecognised output', () => {
    expect(() => parseClaudeVersion('not a version')).toThrow(/Unexpected claude --version/);
    expect(() => parseClaudeVersion('')).toThrow();
  });
});

describe('updatePackageJson', () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = join(tmpdir(), `pkg-test-${Date.now()}.json`);
    writeFileSync(tmpPath, JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2) + '\n');
  });

  afterEach(() => {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* already gone */
    }
  });

  it('writes claudeCodeVersion into package.json', () => {
    updatePackageJson(tmpPath, '2.1.191');
    const pkg = JSON.parse(readFileSync(tmpPath, 'utf8'));
    expect(pkg.claudeCodeVersion).toBe('2.1.191');
  });

  it('preserves existing fields', () => {
    updatePackageJson(tmpPath, '2.1.191');
    const pkg = JSON.parse(readFileSync(tmpPath, 'utf8'));
    expect(pkg.name).toBe('test');
    expect(pkg.version).toBe('1.0.0');
  });

  it('overwrites a stale claudeCodeVersion', () => {
    writeFileSync(
      tmpPath,
      JSON.stringify({ name: 'test', version: '1.0.0', claudeCodeVersion: '2.0.0' }, null, 2)
    );
    updatePackageJson(tmpPath, '2.1.191');
    const pkg = JSON.parse(readFileSync(tmpPath, 'utf8'));
    expect(pkg.claudeCodeVersion).toBe('2.1.191');
  });

  it('returns the updated package object', () => {
    const pkg = updatePackageJson(tmpPath, '3.0.0');
    expect(pkg.claudeCodeVersion).toBe('3.0.0');
  });
});
