import { describe, expect, it } from 'vitest';
import { toComparableString } from './value-normalization';

describe('toComparableString', () => {
  it('omits nullish values and stringifies other primitives', () => {
    expect(toComparableString(null)).toBeUndefined();
    expect(toComparableString(undefined)).toBeUndefined();
    expect(toComparableString(false)).toBe('false');
    expect(toComparableString(42)).toBe('42');
  });
});
