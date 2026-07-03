import { describe, it, expect } from 'vitest';
import {
  buildDispatchBgArgs,
  buildAiRunArgs,
  BG_MODEL_ALLOWLIST,
} from '../electron/modules/claude-cli-args';

describe('buildDispatchBgArgs', () => {
  it('builds the minimal argv with the prompt behind --', () => {
    expect(buildDispatchBgArgs({ prompt: 'fix the bug' })).toEqual(['--bg', '--', 'fix the bug']);
  });

  it('includes name/agent/model when provided', () => {
    expect(
      buildDispatchBgArgs({ prompt: 'do it', name: 'my task', agent: 'reviewer', model: 'opus' })
    ).toEqual([
      '--bg',
      '--name',
      'my task',
      '--agent',
      'reviewer',
      '--model',
      'opus',
      '--',
      'do it',
    ]);
  });

  it('keeps a flag-looking prompt inert as a positional after --', () => {
    const args = buildDispatchBgArgs({ prompt: '--model injected --add-dir /' });
    const sentinel = args.indexOf('--');
    expect(sentinel).toBeGreaterThan(-1);
    expect(args.slice(sentinel)).toEqual(['--', '--model injected --add-dir /']);
  });

  it('omits empty optional values', () => {
    expect(buildDispatchBgArgs({ prompt: 'p', name: '', agent: '', model: '' })).toEqual([
      '--bg',
      '--',
      'p',
    ]);
  });

  it('rejects a name starting with -', () => {
    expect(() => buildDispatchBgArgs({ prompt: 'p', name: '--dangerously-skip' })).toThrow(
      /session name/
    );
  });

  it('rejects an agent starting with -', () => {
    expect(() => buildDispatchBgArgs({ prompt: 'p', agent: '-x' })).toThrow(/agent name/);
  });

  it('accepts every allowlisted model and rejects anything else', () => {
    for (const model of BG_MODEL_ALLOWLIST) {
      expect(buildDispatchBgArgs({ prompt: 'p', model })).toContain(model);
    }
    expect(() => buildDispatchBgArgs({ prompt: 'p', model: '--model' })).toThrow(/Invalid model/);
    expect(() => buildDispatchBgArgs({ prompt: 'p', model: 'gpt-4' })).toThrow(/Invalid model/);
  });
});

describe('buildAiRunArgs', () => {
  it('binds the instruction as the last positional after --', () => {
    const args = buildAiRunArgs('summarize this');
    expect(args.slice(-2)).toEqual(['--', 'summarize this']);
    expect(args[0]).toBe('-p');
    expect(args).toContain('--no-session-persistence');
  });

  it('keeps a flag-looking instruction inert', () => {
    const args = buildAiRunArgs('--permission-mode bypassPermissions');
    const sentinel = args.indexOf('--');
    expect(args.slice(sentinel)).toEqual(['--', '--permission-mode bypassPermissions']);
  });
});
