import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { DetailHeaderActionBar } from '../../src/ui/conversations/DetailHeaderActionBar';

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
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: dom.window.getComputedStyle.bind(dom.window),
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
  delete (globalThis as any).HTMLElement;
  delete (globalThis as any).Node;
  delete (globalThis as any).localStorage;
  delete (globalThis as any).getComputedStyle;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

describe('DetailHeaderActionBar', () => {
  let root: ReactDOM.Root | null = null;
  const buttonClassName = 'button-class';

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('renders a direct button when only one destination exists', () => {
    act(() => {
      root!.render(
        createElement(DetailHeaderActionBar, {
          actions: [
            {
              id: 'open-in-notion',
              label: 'Open in Notion',
              provider: 'notion',
              kind: 'external-link',
              slot: 'open',
              href: 'https://www.notion.so/example',
              onTrigger: vi.fn(async () => {}),
            },
          ],
          buttonClassName,
        }),
      );
    });

    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Open destinations"]')).toBeFalsy();
  });

  it('renders a menu trigger when multiple destinations exist', () => {
    act(() => {
      root!.render(
        createElement(DetailHeaderActionBar, {
          actions: [
            {
              id: 'open-in-notion',
              label: 'Open in Notion',
              provider: 'notion',
              kind: 'external-link',
              slot: 'open',
              href: 'https://www.notion.so/example',
              onTrigger: vi.fn(async () => {}),
            },
            {
              id: 'open-in-obsidian',
              label: 'Open in Obsidian',
              provider: 'obsidian',
              kind: 'open-target',
              slot: 'open',
              onTrigger: vi.fn(async () => {}),
            },
          ],
          buttonClassName,
        }),
      );
    });

    expect(document.querySelector('[aria-label="Open destinations"]')).toBeTruthy();
    expect(document.querySelector('[aria-label="Open in Notion"]')).toBeFalsy();
  });

  it('reports an error instead of swallowing a failed action trigger', async () => {
    const alertSpy = vi.fn();
    Object.defineProperty(globalThis.window, 'alert', {
      configurable: true,
      value: alertSpy,
    });

    act(() => {
      root!.render(
        createElement(DetailHeaderActionBar, {
          actions: [
            {
              id: 'open-in-notion',
              label: 'Open in Notion',
              provider: 'notion',
              kind: 'external-link',
              slot: 'open',
              href: 'https://www.notion.so/example',
              onTrigger: vi.fn(async () => {
                throw new Error('Failed to open Notion page');
              }),
            },
          ],
          buttonClassName,
        }),
      );
    });

    const button = document.querySelector('[aria-label="Open in Notion"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();

    await act(async () => {
      button!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(alertSpy).toHaveBeenCalledWith('Failed to open Notion page');
  });

  it('renders a disabled direct button for unavailable integrations', () => {
    act(() => {
      root!.render(
        createElement(DetailHeaderActionBar, {
          actions: [
            {
              id: 'open-in-obsidian-unavailable',
              label: 'Obsidian API not connected',
              provider: 'obsidian',
              kind: 'open-target',
              slot: 'open',
              disabled: true,
              onTrigger: vi.fn(async () => {}),
            },
          ],
          buttonClassName,
        }),
      );
    });

    const button = document.querySelector('[aria-label="Obsidian API not connected"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    expect(button?.disabled).toBe(true);
  });

  it('shows busy and done labels for cache action progress state', async () => {
    let resolveTrigger: (() => void) | null = null;
    const onTrigger = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTrigger = resolve;
        }),
    );

    act(() => {
      root!.render(
        createElement(DetailHeaderActionBar, {
          actions: [
            {
              id: 'cache-images',
              label: 'Cache images',
              busyLabel: 'Caching images...',
              showBusyProgress: true,
              afterTriggerLabel: 'Cache complete',
              afterTriggerLabelDurationMs: 0,
              provider: 'local',
              kind: 'open-target',
              slot: 'tools',
              onTrigger,
            },
          ],
          buttonClassName,
        }),
      );
    });

    const button = document.querySelector('[aria-label="Cache images"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    expect(button?.textContent || '').toContain('Cache images');

    await act(async () => {
      button!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(button?.disabled).toBe(true);
    expect(button?.textContent || '').toContain('Caching images...');
    expect(document.querySelector('.tw-animate-pulse')).toBeTruthy();

    await act(async () => {
      resolveTrigger?.();
      await Promise.resolve();
    });

    expect(button?.disabled).toBe(false);
    expect(button?.textContent || '').toContain('Cache complete');
  });
});
