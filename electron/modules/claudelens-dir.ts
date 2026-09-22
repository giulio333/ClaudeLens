// Where ClaudeLens keeps its own state (preferences, playbook, pending crash
// report) — `~/.claudelens`, deliberately separate from `~/.claude`.
//
// A dev build (`npm run dev`) gets a directory of its own, `~/.claudelens-dev`:
// it used to share the packaged app's, so running the repo after a version bump
// marked that version's "What's new" as seen before the release was ever
// installed, and the popup never showed on the real update. The choice is made
// once by main.ts from `app.isPackaged`; this module stays free of Electron so
// the modules reading it are testable as plain Node.

import os from 'os';
import { join } from 'path';

let stateDir = join(os.homedir(), '.claudelens');

export function claudelensDir(): string {
  return stateDir;
}

export function useDevClaudelensDir(): void {
  stateDir = join(os.homedir(), '.claudelens-dev');
}
