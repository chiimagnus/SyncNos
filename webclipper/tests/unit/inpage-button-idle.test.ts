import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

import { inpageButtonApi } from '../../src/ui/inpage/inpage-button-shadow';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: dom.window.MutationObserver });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });

  (dom.window.HTMLElement.prototype as any).attachEvent ||= () => {};
  (dom.window.HTMLElement.prototype as any).detachEvent ||= () => {};

  inpageButtonApi.initRuntime(null);
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).MutationObserver;
  delete (globalThis as any).getComputedStyle;
}

describe('inpage button idle fade', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupDom();
  });

  afterEach(() => {
    try {
      inpageButtonApi.cleanupButtons('');
    } catch (_e) {
      // ignore
    }
    vi.clearAllTimers();
    vi.useRealTimers();
    cleanupDom();
  });

  it('fades after 10s without button interaction and only button interaction restores it', () => {
    inpageButtonApi.ensureInpageButton({ collectorId: 'chatgpt' });

    const btn = document.getElementById('webclipper-inpage-btn') as HTMLElement | null;
    expect(btn).toBeTruthy();
    expect(btn!.shadowRoot).toBeTruthy();
    expect(btn!.classList.contains('is-idle')).toBe(false);

    vi.advanceTimersByTime(9_999);
    expect(btn!.classList.contains('is-idle')).toBe(false);

    vi.advanceTimersByTime(1);
    expect(btn!.classList.contains('is-idle')).toBe(true);

    // Non-button activity should not reset idle state.
    document.body.dispatchEvent(new window.Event('pointermove', { bubbles: true }));
    expect(btn!.classList.contains('is-idle')).toBe(true);

    // Direct button interaction should restore visibility and restart idle timer.
    btn!.dispatchEvent(new window.Event('pointermove', { bubbles: true }));
    expect(btn!.classList.contains('is-idle')).toBe(false);

    vi.advanceTimersByTime(10_000);
    expect(btn!.classList.contains('is-idle')).toBe(true);
  });
});
