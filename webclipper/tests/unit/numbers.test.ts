import { describe, expect, it } from 'vitest';

import { normalizePositiveInt } from '@services/shared/numbers';

describe('normalizePositiveInt', () => {
  it('normalizes valid positive numbers to int', () => {
    expect(normalizePositiveInt(1)).toBe(1);
    expect(normalizePositiveInt('42')).toBe(42);
    expect(normalizePositiveInt(7.9)).toBe(7);
  });

  it('returns null for invalid or non-positive values', () => {
    expect(normalizePositiveInt(0)).toBeNull();
    expect(normalizePositiveInt(-1)).toBeNull();
    expect(normalizePositiveInt('nope')).toBeNull();
    expect(normalizePositiveInt(null)).toBeNull();
  });
});
