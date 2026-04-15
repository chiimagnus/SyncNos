import { describe, expect, it } from 'vitest';

import {
  computeOutlineCenterY,
  pickActiveOutlineIndex,
  type OutlineIndexCandidate,
} from '../../src/ui/conversations/chat-outline/active-index';

function candidate(index: number, top: number, bottom: number): OutlineIndexCandidate {
  return { index, top, bottom };
}

describe('chat-outline active-index', () => {
  it('picks the visible item whose center is closest to the viewport center line', () => {
    const active = pickActiveOutlineIndex({
      centerY: 200,
      visibleCandidates: [candidate(1, 24, 64), candidate(2, 162, 218), candidate(3, 240, 300)],
    });

    expect(active).toBe(2);
  });

  it('handles visible set changes and keeps previous active when no visible candidates', () => {
    const withVisible = pickActiveOutlineIndex({
      centerY: 260,
      visibleCandidates: [candidate(3, 250, 310), candidate(4, 318, 372)],
      previousActiveIndex: 2,
    });
    expect(withVisible).toBe(3);

    const noVisibleKeepPrevious = pickActiveOutlineIndex({
      centerY: 260,
      visibleCandidates: [],
      previousActiveIndex: 3,
    });
    expect(noVisibleKeepPrevious).toBe(3);
  });

  it('falls back to viewport rect when root is null', () => {
    const centerY = computeOutlineCenterY({
      rootRect: null,
      viewportRect: { top: 0, bottom: 600 },
      messagesRect: { top: 120, bottom: 900 },
    });
    expect(centerY).toBe(360);

    const active = pickActiveOutlineIndex({
      centerY,
      visibleCandidates: [],
      allCandidates: [candidate(1, 80, 140), candidate(2, 300, 380), candidate(3, 500, 560)],
    });
    expect(active).toBe(2);
  });
});
