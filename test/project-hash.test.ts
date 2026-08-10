import { describe, it, expect } from 'vitest';
import { provisionalProjectHash } from '../src/components/project/shared/projectHash';

describe('provisionalProjectHash', () => {
  it('folds a POSIX cwd the way Claude Code names its project folder', () => {
    expect(provisionalProjectHash('/Users/foo/Projects/Bar')).toBe('-Users-foo-Projects-Bar');
  });

  it('folds dots, which the folder name collapses too', () => {
    expect(provisionalProjectHash('/Users/foo/Projects/SARA2.0')).toBe(
      '-Users-foo-Projects-SARA2-0'
    );
  });

  // The main process rejects any hash carrying a path separator (assertValidHash),
  // so a Windows cwd has to come out fully folded or every query for that project
  // fails outright instead of reading empty.
  it('leaves no path separator in a Windows cwd', () => {
    const hash = provisionalProjectHash('C:\\Users\\foo\\Projects\\Bar');
    expect(hash).not.toMatch(/[/\\]/);
    expect(hash).toBe('C--Users-foo-Projects-Bar');
  });

  it('leaves no path separator in a UNC cwd', () => {
    expect(provisionalProjectHash('\\\\server\\share\\proj')).not.toMatch(/[/\\]/);
  });
});
