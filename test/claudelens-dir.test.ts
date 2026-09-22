import { describe, it, expect } from 'vitest';
import os from 'os';
import { join } from 'path';
import { claudelensDir, useDevClaudelensDir } from '../electron/modules/claudelens-dir';

// The dev build must never share the packaged app's state: sharing it is how
// a "What's new" got marked seen by `npm run dev` before the release was
// installed. The switch is a one-way, process-wide choice made at startup.
describe('claudelens-dir', () => {
  it('defaults to ~/.claudelens and moves to ~/.claudelens-dev for a dev build', () => {
    expect(claudelensDir()).toBe(join(os.homedir(), '.claudelens'));
    useDevClaudelensDir();
    expect(claudelensDir()).toBe(join(os.homedir(), '.claudelens-dev'));
  });
});
