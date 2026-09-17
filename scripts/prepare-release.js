#!/usr/bin/env node
// Run before creating a GitHub Release:
//   node scripts/prepare-release.js
// Reads `claude --version`, updates claudeCodeVersion in package.json.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = resolve(__dirname, '../package.json');
const WHATS_NEW_PATH = resolve(__dirname, '../src/data/whats-new.ts');

/** Compare two "x.y.z" strings: -1/0/1, like Array.sort's comparator. */
function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/** The newest `version: '...'` entry in whats-new.ts's source, or null if none
 * parse. This script runs BEFORE package.json's `version` is bumped for the
 * release (see the CLI entry point below), so "an entry exists for the
 * upcoming release" can only ever be checked as "the newest authored entry is
 * newer than what's installed right now" — never an exact match. */
export function newestWhatsNewVersion(whatsNewSource) {
  const versions = [...whatsNewSource.matchAll(/version:\s*'([\d.]+)'/g)].map(m => m[1]);
  return versions.reduce(
    (best, v) => (best === null || compareSemver(v, best) > 0 ? v : best),
    null
  );
}

/** Extract semver string from `claude --version` output, e.g. "2.1.191 (Claude Code)" → "2.1.191" */
export function parseClaudeVersion(raw) {
  const m = raw.trim().match(/^(\d+\.\d+\.\d+)/);
  if (!m) throw new Error(`Unexpected claude --version output: ${JSON.stringify(raw)}`);
  return m[1];
}

/** Read package.json, set claudeCodeVersion, write back. Returns updated object. */
export function updatePackageJson(pkgPath, version) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.claudeCodeVersion = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return pkg;
}

// CLI entry point — only runs when invoked directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const raw = execSync('claude --version', { encoding: 'utf8' });
  const version = parseClaudeVersion(raw);
  const pkg = updatePackageJson(PKG_PATH, version);
  console.log(`✓ claudeCodeVersion set to ${version} (app version: ${pkg.version})`);
  console.log(`  Next: bump package.json "version", commit, then create the GitHub Release.`);

  const whatsNewSource = readFileSync(WHATS_NEW_PATH, 'utf8');
  const newest = newestWhatsNewVersion(whatsNewSource);
  if (newest === null || compareSemver(newest, pkg.version) <= 0) {
    console.warn(
      `⚠ src/data/whats-new.ts has no entry newer than the current ${pkg.version} — the ` +
        `"What's new" popup will stay silent on the release you're about to bump to. Add one ` +
        `first if there's anything to show (or ignore this for a fix-only release).`
    );
  }
}
