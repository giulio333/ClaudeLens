import { describe, expect, it } from 'vitest';
import { composerModelOptions, resolveAlias } from '../src/components/project/chat/model-options';
import type { InitModel } from '../src/types';

// The shape the SDK's `initialize` answered with (0.3.235): the aliases are not
// all listed verbatim — `opus` comes as `opus[1m]`, Fable only under its full id.
const MODELS: InitModel[] = [
  { value: 'default', resolvedModel: 'claude-sonnet-5', displayName: 'Default (recommended)' },
  { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet' },
  { value: 'claude-fable-5-1[1m]', resolvedModel: 'claude-fable-5-1', displayName: 'Fable' },
  { value: 'opus[1m]', resolvedModel: 'claude-opus-5[1m]', displayName: 'Opus (1M context)' },
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku' },
];

describe('resolveAlias — which model an alias means today', () => {
  it.each([
    ['sonnet', 'claude-sonnet-5'],
    // matched without its context marker, and resolved without it too
    ['opus', 'claude-opus-5'],
    // no row carries `fable` as its value: found by the display name's family
    ['fable', 'claude-fable-5-1'],
    ['haiku', 'claude-haiku-4-5-20251001'],
  ])('resolves %s to %s', (alias, expected) => {
    expect(resolveAlias(alias, MODELS)).toBe(expected);
  });

  it('answers nothing for an alias the list does not know, or a row with no resolution', () => {
    expect(resolveAlias('mythos', MODELS)).toBeUndefined();
    expect(resolveAlias('opus', [{ value: 'opus', displayName: 'Opus' }])).toBeUndefined();
  });
});

describe('composerModelOptions — the choices the composer offers', () => {
  const init = { model: 'claude-opus-5[1m]', models: MODELS };

  it('names every alias with the version it resolves to', () => {
    expect(composerModelOptions(undefined, init)).toEqual([
      { value: 'sonnet', label: 'Sonnet 5' },
      { value: 'opus', label: 'Opus 5' },
      { value: 'haiku', label: 'Haiku 4.5' },
      { value: 'fable', label: 'Fable 5.1' },
      { value: '', label: 'Default · Opus 5' },
    ]);
  });

  // A session on Opus 5.5 next to an `opus` that means Opus 5: the two rows used
  // to read "Opus 5.5" and "Opus", the second saying nothing about which one.
  it('keeps the session model on top, apart from the alias of its family', () => {
    const options = composerModelOptions('claude-opus-5-5', init);
    expect(options[0]).toEqual({ value: 'claude-opus-5-5', label: 'Opus 5.5' });
    expect(options).toContainEqual({ value: 'opus', label: 'Opus 5' });
  });

  it('drops an alias that resolves to the session model, which would repeat its label', () => {
    const options = composerModelOptions('claude-sonnet-5', init);
    expect(options.map(o => o.value)).toEqual(['claude-sonnet-5', 'opus', 'haiku', 'fable', '']);
  });

  // A reply sent on `opus` makes the session's model `claude-opus-5`: dropping
  // the alias then would leave the chip showing a value no option names.
  it('keeps the selected alias and drops the session row it duplicates instead', () => {
    const options = composerModelOptions('claude-opus-5', init, 'opus');
    expect(options.map(o => o.value)).toEqual(['sonnet', 'opus', 'haiku', 'fable', '']);
    expect(options).toContainEqual({ value: 'opus', label: 'Opus 5' });
  });

  it('falls back to the bare aliases when the handshake gave no model list', () => {
    expect(composerModelOptions(undefined, null)).toEqual([
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'opus', label: 'Opus' },
      { value: 'haiku', label: 'Haiku' },
      { value: 'fable', label: 'Fable' },
      { value: '', label: 'Default' },
    ]);
  });
});
