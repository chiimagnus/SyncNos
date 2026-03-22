import { describe, expect, it } from 'vitest';

import { buildLocalTimestampForFilename } from '@services/shared/file-timestamp';

describe('buildLocalTimestampForFilename', () => {
  it('formats local time with safe filename characters', () => {
    const d = new Date(2026, 2, 3, 4, 5, 6, 7);
    expect(buildLocalTimestampForFilename(d)).toBe('2026-03-03T04-05-06-007');
  });
});
