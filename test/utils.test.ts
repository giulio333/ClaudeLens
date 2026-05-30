import { describe, it, expect } from 'vitest';
import { isAbsolutePath } from '../electron/utils';

describe('isAbsolutePath', () => {
  it('accepts POSIX absolute paths', () => {
    expect(isAbsolutePath('/Users/foo/bar')).toBe(true);
    expect(isAbsolutePath('/')).toBe(true);
  });

  it('accepts Windows drive-letter paths (backslash and forward slash)', () => {
    expect(isAbsolutePath('C:\\Users\\foo\\bar')).toBe(true);
    expect(isAbsolutePath('C:/Users/foo/bar')).toBe(true);
    expect(isAbsolutePath('d:\\projects')).toBe(true);
  });

  it('accepts Windows UNC paths', () => {
    expect(isAbsolutePath('\\\\server\\share\\dir')).toBe(true);
  });

  it('rejects relative and non-path strings', () => {
    expect(isAbsolutePath('foo/bar')).toBe(false);
    expect(isAbsolutePath('./foo')).toBe(false);
    expect(isAbsolutePath('C:')).toBe(false);
    expect(isAbsolutePath('')).toBe(false);
  });
});
