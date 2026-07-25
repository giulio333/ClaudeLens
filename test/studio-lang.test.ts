import { describe, it, expect } from 'vitest';
import {
  buildRefIndex,
  compactExpr,
  isSimpleRef,
  resolveRef,
  stepRefKeys,
} from '../src/components/project/studio/studioLang';

const TERNARY =
  "forcedIssue ? `Lavora sull'issue #${forcedIssue}: leggila e riassumila.` : `Scegli UNA issue da risolvere.`";

describe('isSimpleRef — data reference vs computed prompt text', () => {
  it('accepts identifiers, step-id slugs and property paths', () => {
    expect(isSimpleRef('args')).toBe(true);
    expect(isSimpleRef('security-check')).toBe(true);
    expect(isSimpleRef('picked.number')).toBe(true);
    expect(isSimpleRef('item.sourcePath')).toBe(true);
  });

  it('rejects anything that computes — those build text, they do not read data', () => {
    expect(isSimpleRef(TERNARY)).toBe(false);
    expect(isSimpleRef('files.join(", ")')).toBe(false);
    expect(isSimpleRef('a + b')).toBe(false);
    expect(isSimpleRef('JSON.stringify({ a: 1 })')).toBe(false);
  });
});

describe('ref index', () => {
  it('reaches a step by id, compiled variable and the variable the script binds', () => {
    expect(stepRefKeys({ id: 'pick-issue', resultVar: 'picked' })).toEqual([
      'pick-issue',
      'pickIssue',
      'picked',
    ]);
    const index = buildRefIndex([
      { id: 'pick-issue', resultVar: 'picked' },
      { id: 'security-check' },
    ]);
    expect(resolveRef(index, 'pick-issue')).toBe('pick-issue');
    expect(resolveRef(index, 'pickIssue')).toBe('pick-issue');
    expect(resolveRef(index, 'picked')).toBe('pick-issue');
    // a property path resolves through its base identifier
    expect(resolveRef(index, 'picked.number')).toBe('pick-issue');
    expect(resolveRef(index, 'security-check')).toBe('security-check');
    expect(resolveRef(index, 'branch')).toBeNull();
  });

  it('keeps the first step that claims a name', () => {
    const index = buildRefIndex([{ id: 'first', resultVar: 'shared' }, { id: 'shared' }]);
    expect(resolveRef(index, 'shared')).toBe('first');
  });
});

describe('compactExpr', () => {
  it('elides string bodies so a ternary reads as its shape', () => {
    expect(compactExpr(TERNARY)).toBe('forcedIssue ? `…` : `…`');
  });

  it('collapses whitespace and clamps long expressions', () => {
    expect(compactExpr('a\n  +\n  b')).toBe('a + b');
    const long = compactExpr('someVeryLongIdentifier.someOtherLongProperty + anotherOne.value', 20);
    expect(long).toHaveLength(20);
    expect(long.endsWith('…')).toBe(true);
  });

  it('keeps empty string literals distinguishable from elided ones', () => {
    expect(compactExpr('x || ""')).toBe('x || ""');
  });
});
