#!/usr/bin/env node
// Run before creating a GitHub Release:
//   node scripts/prepare-release.js
// Reads `claude --version`, updates claudeCodeVersion in package.json.

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PKG_PATH = resolve(__dirname, '../package.json')

/** Extract semver string from `claude --version` output, e.g. "2.1.191 (Claude Code)" → "2.1.191" */
export function parseClaudeVersion(raw) {
  const m = raw.trim().match(/^(\d+\.\d+\.\d+)/)
  if (!m) throw new Error(`Unexpected claude --version output: ${JSON.stringify(raw)}`)
  return m[1]
}

/** Read package.json, set claudeCodeVersion, write back. Returns updated object. */
export function updatePackageJson(pkgPath, version) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.claudeCodeVersion = version
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  return pkg
}

// CLI entry point — only runs when invoked directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const raw = execSync('claude --version', { encoding: 'utf8' })
  const version = parseClaudeVersion(raw)
  const pkg = updatePackageJson(PKG_PATH, version)
  console.log(`✓ claudeCodeVersion set to ${version} (app version: ${pkg.version})`)
  console.log(`  Next: bump package.json "version", commit, then create the GitHub Release.`)
}
