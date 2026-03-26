import { describe, expect, it } from 'vitest';

import { clampSidebarWidthPxForViewport } from '@ui/comments/threaded-comments-panel/resize';

describe('clampSidebarWidthPxForViewport', () => {
  it('clamps to min width for tiny viewports', () => {
    expect(clampSidebarWidthPxForViewport(100, { isOverlay: false, viewportWidth: 600 })).toBe(320);
    expect(clampSidebarWidthPxForViewport(100, { isOverlay: true, viewportWidth: 340 })).toBe(320);
  });

  it('clamps to max width respecting overlay/non-overlay caps', () => {
    expect(clampSidebarWidthPxForViewport(900, { isOverlay: false, viewportWidth: 1200 })).toBe(720);
    expect(clampSidebarWidthPxForViewport(900, { isOverlay: true, viewportWidth: 800 })).toBe(720);
  });

  it('keeps width when already in allowed range', () => {
    expect(clampSidebarWidthPxForViewport(500, { isOverlay: false, viewportWidth: 1200 })).toBe(500);
    expect(clampSidebarWidthPxForViewport(420, { isOverlay: true, viewportWidth: 900 })).toBe(420);
  });
});
