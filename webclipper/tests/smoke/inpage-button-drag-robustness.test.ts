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

  return dom;
}

function dragButton(btn: HTMLElement, dy: number) {
  const initialTop = Number.parseFloat(btn.style.top || '0');
  btn.dispatchEvent(
    new window.PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      clientX: 980,
      clientY: initialTop + 10,
      button: 0,
    }),
  );
  window.dispatchEvent(
    new window.PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      clientX: 980,
      clientY: initialTop + 10 + dy,
      buttons: 1,
    }),
  );
  window.dispatchEvent(
    new window.PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      clientX: 980,
      clientY: initialTop + 10 + dy,
      button: 0,
    }),
  );
}

describe('inpage-button drag robustness', () => {
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
  });

  it('still starts dragging when page stops pointerdown propagation in capture phase', () => {
    // Simulate a hostile page that stops pointerdown propagation early.
    window.addEventListener(
      'pointerdown',
      (e) => {
        e.stopPropagation();
      },
      true,
    );

    inpageButtonApi.ensureInpageButton({ collectorId: 'gemini', positionState: { edge: 'right', ratio: 0.1 } });
    const btn = document.getElementById('webclipper-inpage-btn') as HTMLElement | null;
    expect(btn).toBeTruthy();

    const initialTop = Number.parseFloat(btn!.style.top || '0');
    dragButton(btn!, 200);
    const nextTop = Number.parseFloat(btn!.style.top || '0');
    expect(nextTop).toBeGreaterThan(initialTop + 100);
  });

  it('rebinds drag listeners for an existing injected button without handlers', () => {
    const existing = document.createElement('webclipper-inpage-btn');
    existing.id = 'webclipper-inpage-btn';
    existing.className = 'webclipper-inpage-btn';
    existing.dataset.sourceId = 'gemini';
    document.documentElement.appendChild(existing);

    inpageButtonApi.ensureInpageButton({ collectorId: 'gemini', positionState: { edge: 'right', ratio: 0.1 } });
    const btn = document.getElementById('webclipper-inpage-btn') as HTMLElement | null;
    expect(btn).toBe(existing);
    expect(typeof (btn as any).__webclipperCleanup).toBe('function');

    const initialTop = Number.parseFloat(btn!.style.top || '0');
    dragButton(btn!, 200);
    const nextTop = Number.parseFloat(btn!.style.top || '0');
    expect(nextTop).toBeGreaterThan(initialTop + 100);
  });
});

