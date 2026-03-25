import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { inpageButtonApi } from '../../src/ui/inpage/inpage-button-shadow';

function setViewportSize(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

function installFixedLayoutMock({ width, height }: { width: number; height: number }) {
  const proto = window.HTMLElement.prototype;
  const original = proto.getBoundingClientRect;

  proto.getBoundingClientRect = function () {
    const style = (this as HTMLElement).style;
    const leftRaw = style?.left;
    const rightRaw = style?.right;
    const topRaw = style?.top;
    const bottomRaw = style?.bottom;

    const leftValue = leftRaw && leftRaw !== 'auto' ? Number.parseFloat(leftRaw) : null;
    const rightValue = rightRaw && rightRaw !== 'auto' ? Number.parseFloat(rightRaw) : null;
    const topValue = topRaw && topRaw !== 'auto' ? Number.parseFloat(topRaw) : null;
    const bottomValue = bottomRaw && bottomRaw !== 'auto' ? Number.parseFloat(bottomRaw) : null;

    const left =
      leftValue != null && Number.isFinite(leftValue)
        ? leftValue
        : rightValue != null && Number.isFinite(rightValue)
          ? window.innerWidth - width - rightValue
          : 0;
    const top =
      topValue != null && Number.isFinite(topValue)
        ? topValue
        : bottomValue != null && Number.isFinite(bottomValue)
          ? window.innerHeight - height - bottomValue
          : 0;

    const rect = {
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON() {
        return this;
      },
    };
    return rect as unknown as DOMRect;
  };

  return () => {
    proto.getBoundingClientRect = original;
  };
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://chatgpt.com/',
    pretendToBeVisual: true,
  });

  // @ts-expect-error test global
  global.window = dom.window;
  // @ts-expect-error test global
  global.document = dom.window.document;
  // @ts-expect-error test global
  global.localStorage = dom.window.localStorage;

  return dom;
}

function loadInpageButton() {
  return inpageButtonApi;
}

describe('inpage-button ratio position persistence', () => {
  let cleanupLayoutMock: null | (() => void) = null;

  beforeEach(() => {
    vi.useFakeTimers();
    setupDom();
    setViewportSize(1000, 800);
    cleanupLayoutMock = installFixedLayoutMock({ width: 28, height: 28 });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanupLayoutMock && cleanupLayoutMock();
    cleanupLayoutMock = null;
    // @ts-expect-error cleanup
    delete global.window;
    // @ts-expect-error cleanup
    delete global.document;
    // @ts-expect-error cleanup
    delete global.localStorage;
  });

  it('keeps relative (ratio) position on resize', () => {
    const api = loadInpageButton();
    const onPositionChange = vi.fn();

    api.ensureInpageButton({ collectorId: 'gemini', positionState: { edge: 'right', ratio: 0.5 }, onPositionChange });
    const btn = document.getElementById('webclipper-inpage-btn') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.style.position).toBe('fixed');
    expect(btn.style.right).toBe('0px');
    expect(onPositionChange).not.toHaveBeenCalled();

    // maxTop = innerHeight - height = 772; 0.5 => 386
    expect(Number.parseFloat(btn.style.top)).toBeCloseTo(386, 5);

    setViewportSize(1000, 600);
    window.dispatchEvent(new window.Event('resize'));

    // maxTop = 572; 0.5 => 286
    expect(Number.parseFloat(btn.style.top)).toBeCloseTo(286, 5);
  });

  // Legacy per-origin `localStorage` positions were removed when switching to a global position source of truth.
});
