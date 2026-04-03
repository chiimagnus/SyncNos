import { describe, expect, it } from 'vitest';

import {
  resolvePendingFocusTarget,
  resolveTargetRootIdForReply,
  resolveTargetRootIdFromSaveResult,
} from '../../src/ui/comments/react/focus-rules';

describe('focus rules', () => {
  it('resolves createdRootId from save result', () => {
    expect(resolveTargetRootIdFromSaveResult({ createdRootId: 12 })).toBe(12);
    expect(resolveTargetRootIdFromSaveResult({ createdRootId: 12.8 })).toBe(13);
    expect(resolveTargetRootIdFromSaveResult({ createdRootId: 0 })).toBeNull();
    expect(resolveTargetRootIdFromSaveResult({})).toBeNull();
    expect(resolveTargetRootIdFromSaveResult(null)).toBeNull();
  });

  it('resolves reply target root id', () => {
    expect(resolveTargetRootIdForReply(9)).toBe(9);
    expect(resolveTargetRootIdForReply('9')).toBe(9);
    expect(resolveTargetRootIdForReply(0)).toBeNull();
    expect(resolveTargetRootIdForReply('x')).toBeNull();
  });

  it('returns null when panel focus is outside', () => {
    const target = resolvePendingFocusTarget({
      pendingFocusRootId: 8,
      fallbackPendingFocusRootId: 7,
      hasFocusWithinPanel: false,
      existingRootIds: [7, 8],
    });
    expect(target).toBeNull();
  });

  it('prefers explicit pending focus id when available', () => {
    const target = resolvePendingFocusTarget({
      pendingFocusRootId: 8,
      fallbackPendingFocusRootId: 7,
      hasFocusWithinPanel: true,
      existingRootIds: [7, 8],
    });
    expect(target).toBe(8);
  });

  it('falls back to local pending id and requires existing root', () => {
    expect(
      resolvePendingFocusTarget({
        pendingFocusRootId: null,
        fallbackPendingFocusRootId: 7,
        hasFocusWithinPanel: true,
        existingRootIds: [7, 8],
      }),
    ).toBe(7);

    expect(
      resolvePendingFocusTarget({
        pendingFocusRootId: 999,
        fallbackPendingFocusRootId: 7,
        hasFocusWithinPanel: true,
        existingRootIds: [7, 8],
      }),
    ).toBeNull();
  });
});
