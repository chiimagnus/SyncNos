import { describe, expect, it } from 'vitest';

import { moveMentionHighlightIndex } from '../../src/services/integrations/item-mention/content/mention-ui-state';

describe('item-mention ui state', () => {
  it('wraps down and up', () => {
    expect(moveMentionHighlightIndex({ current: 0, count: 3, key: 'ArrowDown' })).toBe(1);
    expect(moveMentionHighlightIndex({ current: 2, count: 3, key: 'ArrowDown' })).toBe(0);
    expect(moveMentionHighlightIndex({ current: 0, count: 3, key: 'ArrowUp' })).toBe(2);
  });

  it('clamps when count shrinks', () => {
    expect(moveMentionHighlightIndex({ current: 10, count: 2, key: 'noop' })).toBe(1);
  });

  it('returns 0 when empty', () => {
    expect(moveMentionHighlightIndex({ current: 1, count: 0, key: 'ArrowDown' })).toBe(0);
  });
});

