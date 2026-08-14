import { describe, it, expect } from 'vitest';
import { describeError, redactPaths } from '../electron/shared/error-redact';

const CTX = { home: '/Users/anna', appRoot: '/Applications/ClaudeLens.app/Contents/Resources/app' };

describe('redactPaths', () => {
  it('collapses a user path, username included', () => {
    expect(redactPaths("ENOENT: open '/Users/anna/Projects/acme/src/index.ts'", CTX)).toBe(
      "ENOENT: open '<path>'"
    );
  });

  it('keeps app-bundle frames readable, line and column included', () => {
    const stack =
      'at read (/Applications/ClaudeLens.app/Contents/Resources/app/dist-electron/modules/x.js:42:9)';
    expect(redactPaths(stack, CTX)).toBe('at read (<app>/dist-electron/modules/x.js:42:9)');
  });

  it('scrubs a ~/.claude path and a Windows path', () => {
    expect(redactPaths('read /Users/anna/.claude/projects/-Users-anna-acme/s.jsonl', CTX)).toBe(
      'read <path>'
    );
    expect(redactPaths('read C:\\Users\\anna\\Projects\\acme', { home: 'C:\\Users\\anna' })).toBe(
      'read <path>'
    );
  });

  it('scrubs a username that is not part of a path', () => {
    expect(redactPaths('user anna is not in the sudoers file', CTX)).toBe(
      'user <user> is not in the sudoers file'
    );
  });

  it('leaves prose and non-path slashes alone', () => {
    expect(redactPaths('read and/or write failed for node:internal/fs', CTX)).toBe(
      'read and/or write failed for node:internal/fs'
    );
  });

  it('is a no-op without a context', () => {
    expect(redactPaths('plain failure')).toBe('plain failure');
  });
});

describe('describeError', () => {
  it('carries the error code into the type', () => {
    const e = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    expect(describeError(e)).toMatchObject({
      errorType: 'Error:ENOENT',
      errorMessage: 'no such file',
    });
  });

  it('handles a plain object and a thrown non-error', () => {
    expect(describeError({ name: 'IpcError', message: 'boom' })).toMatchObject({
      errorType: 'IpcError',
      errorMessage: 'boom',
    });
    expect(describeError('just a string')).toMatchObject({
      errorType: 'NonError',
      errorMessage: 'just a string',
    });
  });

  it('caps oversized fields at the documented limits', () => {
    const e = new Error('x'.repeat(9000));
    e.stack = 'y'.repeat(20_000);
    const d = describeError(e);
    expect(d.errorMessage).toHaveLength(5000);
    expect(d.stackTrace).toHaveLength(10_000);
  });
});
