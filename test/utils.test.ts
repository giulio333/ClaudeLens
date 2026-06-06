import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { isAbsolutePath, validateEntityName, assertWithin, isValidSessionId } from '../electron/utils';

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

describe('validateEntityName (issue #58)', () => {
  it('accepts safe names and returns them trimmed', () => {
    expect(validateEntityName('my-skill')).toBe('my-skill');
    expect(validateEntityName('  Code Reviewer  ')).toBe('Code Reviewer');
    expect(validateEntityName('agent_v1.2')).toBe('agent_v1.2');
  });

  it('rejects path-traversal and separator-bearing names', () => {
    expect(() => validateEntityName('../../../tmp/x')).toThrow(/Invalid name/);
    expect(() => validateEntityName('a/b')).toThrow(/Invalid name/);
    expect(() => validateEntityName('a\\b')).toThrow(/Invalid name/);
    expect(() => validateEntityName('.')).toThrow(/Invalid name/);
    expect(() => validateEntityName('..')).toThrow(/Invalid name/);
  });

  it('rejects empty and over-long names', () => {
    expect(() => validateEntityName('')).toThrow(/Invalid name/);
    expect(() => validateEntityName('   ')).toThrow(/Invalid name/);
    expect(() => validateEntityName('x'.repeat(81))).toThrow(/Invalid name/);
  });
});

describe('assertWithin (issue #58)', () => {
  const base = '/Users/foo/.claude/skills';

  it('allows the base dir and paths inside it', () => {
    expect(() => assertWithin(base, base)).not.toThrow();
    expect(() => assertWithin(base, join(base, 'my-skill', 'SKILL.md'))).not.toThrow();
  });

  it('throws for resolved paths that escape the base dir', () => {
    expect(() => assertWithin(base, join(base, '..', '..', 'evil'))).toThrow(/outside/);
    expect(() => assertWithin(base, '/etc/passwd')).toThrow(/outside/);
  });
});

describe('isValidSessionId (issue #57)', () => {
  it('accepts canonical UUIDs', () => {
    expect(isValidSessionId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
  });

  it('rejects ids carrying shell metacharacters or wrong shape', () => {
    expect(isValidSessionId('x"; rm -rf ~; echo "')).toBe(false);
    expect(isValidSessionId('x & calc')).toBe(false);
    expect(isValidSessionId('not-a-uuid')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId(undefined)).toBe(false);
  });
});
