import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

import { createDockController } from '@ui/comments/dock';

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
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'addEventListener', {
    configurable: true,
    value: dom.window.addEventListener.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'removeEventListener', {
    configurable: true,
    value: dom.window.removeEventListener.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    },
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(globalThis, 'innerWidth', {
    configurable: true,
    writable: true,
    value: 1440,
  });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).addEventListener;
  delete (globalThis as any).removeEventListener;
  delete (globalThis as any).requestAnimationFrame;
  delete (globalThis as any).cancelAnimationFrame;
  delete (globalThis as any).innerWidth;
}

function setViewportWidth(width: number) {
  Object.defineProperty(globalThis, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
}

describe('threaded comments panel responsive layout', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    cleanupDom();
  });

  it('docks only on wide viewports and releases page padding on narrow viewports', () => {
    const panelEl = document.createElement('webclipper-threaded-comments-panel');
    panelEl.setAttribute('data-open', '1');
    panelEl.style.width = '420px';
    document.body.appendChild(panelEl);

    const controller = createDockController({ enabled: true, panelEl });

    controller.setOpen(true);

    expect(document.documentElement.getAttribute('data-webclipper-comments-dock')).toBe('1');
    expect(document.documentElement.style.getPropertyValue('--webclipper-comments-dock-width')).toBe('420px');

    setViewportWidth(640);
    window.dispatchEvent(new window.Event('resize'));

    expect(document.documentElement.getAttribute('data-webclipper-comments-dock')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--webclipper-comments-dock-width')).toBe('');

    setViewportWidth(1280);
    window.dispatchEvent(new window.Event('resize'));

    expect(document.documentElement.getAttribute('data-webclipper-comments-dock')).toBe('1');
    expect(document.documentElement.style.getPropertyValue('--webclipper-comments-dock-width')).toBe('420px');

    controller.cleanup();
  });

  it('includes the narrow floating overlay rules in the shadow css bundle', () => {
    const css = readFileSync(new URL('../../src/ui/styles/inpage-comments-panel.css', import.meta.url), 'utf8');

    expect(css).toContain('@media (max-width: 767px)');
    expect(css).toContain(":host([data-overlay='1']) {");
    expect(css).toContain('top: auto;');
    expect(css).toContain('right: 8px;');
    expect(css).toContain('bottom: 8px;');
    expect(css).toContain('width: min(420px, calc(100vw - 32px));');
    expect(css).toContain('height: min(40vh, calc(100vh - 32px));');
    expect(css).toContain('border-radius: var(--radius-card);');
    expect(css).toContain('.webclipper-inpage-comments-panel__resize-handle');
  });
});
