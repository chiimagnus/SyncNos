import { describe, expect, it } from 'vitest';
import { formatStorageSize } from '@ui/settings/format-storage-size';

describe('storage size labels', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1000, '1 KB'],
    [1500, '1.5 KB'],
    [1024, '1 KB'],
    [1_000_000, '1 MB'],
    [1_500_000, '1.5 MB'],
    [1_000_000_000, '1 GB'],
    [1_000_000_000_000, '1,000 GB'],
  ])('uses decimal units for %i bytes', (bytes, expected) => {
    expect(formatStorageSize(bytes)).toBe(expected);
  });
  it('does not turn invalid or missing usage into a fake zero', () => {
    expect(formatStorageSize(null)).toBe('—');
    expect(formatStorageSize(NaN)).toBe('—');
    expect(formatStorageSize(-1)).toBe('—');
  });
});
