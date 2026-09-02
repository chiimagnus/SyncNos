import { describe, expect, it } from 'vitest';

import { normalizeSyncConversationId, normalizeSyncConversationIds } from '@services/sync/sync-conversation-ids';

describe('sync conversation ids', () => {
  it('accepts only positive safe integers and keeps first-seen order', () => {
    expect(normalizeSyncConversationIds([2, '1', 2, 1.5, 0, -1, Infinity, Number.MAX_SAFE_INTEGER + 1])).toEqual([
      2, 1,
    ]);
  });

  it('does not coerce a fractional id to another conversation', () => {
    expect(normalizeSyncConversationId(1.5)).toBeNull();
    expect(normalizeSyncConversationIds([1.5])).toEqual([]);
  });
});
