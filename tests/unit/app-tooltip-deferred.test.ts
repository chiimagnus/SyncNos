import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

const mocks = vi.hoisted(() => ({
  implementationLoads: vi.fn(),
}));

vi.mock('../../src/ui/shared/AppTooltipImpl', async () => {
  mocks.implementationLoads();
  const { createElement } = await import('react');
  return {
    default: ({ id }: { id: string }) => createElement('div', { 'data-tooltip-implementation': id }),
  };
});

import { AppTooltipHost, tooltipAttrs } from '../../src/ui/shared/AppTooltip';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: dom.window.Event });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).Event;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

let activeRoot: ReactDOM.Root | null = null;

afterEach(async () => {
  if (activeRoot) {
    await act(async () => {
      activeRoot?.unmount();
      await flushImmediate();
    });
    activeRoot = null;
  }
  cleanupDom();
});

describe('AppTooltip deferred implementation', () => {
  it('keeps tooltipAttrs lightweight and preserves the anchor contract without loading the implementation', () => {
    expect(mocks.implementationLoads).not.toHaveBeenCalled();
    expect(tooltipAttrs('  Open settings  ', 'right')).toEqual({
      'data-tooltip-id': 'webclipper-tooltip',
      'data-tooltip-content': 'Open settings',
      'data-tooltip-place': 'right',
    });
    expect(tooltipAttrs('')).toEqual({});
    expect(mocks.implementationLoads).not.toHaveBeenCalled();
  });

  it('loads the heavy implementation once after the host passive effect', async () => {
    setupDom();
    activeRoot = ReactDOM.createRoot(document.getElementById('root')!);

    await act(async () => {
      activeRoot!.render(createElement(AppTooltipHost));
      await flushImmediate();
      await import('../../src/ui/shared/AppTooltipImpl');
      await flushImmediate();
    });

    expect(mocks.implementationLoads).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-tooltip-implementation="webclipper-tooltip"]')).toBeTruthy();

    await act(async () => {
      activeRoot!.render(createElement(AppTooltipHost));
      await flushImmediate();
    });
    expect(mocks.implementationLoads).toHaveBeenCalledTimes(1);
  });

  it('owns tooltip-only CSS in the lazy implementation rather than either entrypoint', () => {
    const popupRender = readFileSync(new URL('../../src/entrypoints/popup/render.tsx', import.meta.url), 'utf8');
    const appMain = readFileSync(new URL('../../src/entrypoints/app/main.tsx', import.meta.url), 'utf8');
    const implementation = readFileSync(new URL('../../src/ui/shared/AppTooltipImpl.tsx', import.meta.url), 'utf8');

    for (const source of [popupRender, appMain]) {
      expect(source).not.toContain('react-tooltip/dist/react-tooltip.css');
      expect(source).not.toContain('@ui/styles/tooltip.css');
    }
    expect(implementation).toContain("import 'react-tooltip/dist/react-tooltip.css'");
    expect(implementation).toContain("import '@ui/styles/tooltip.css'");
  });
});
