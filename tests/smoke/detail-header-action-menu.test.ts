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
              href: 'https://app.notion.com/example',
              onTrigger: vi.fn(async () => {}),
            },
          ],
          buttonClassName,
        }),
      );
    });

    const button = document.querySelector('[aria-label="Open in Notion"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    expect(document.querySelector('[aria-label="Open destinations"]')).toBeFalsy();
    const logo = button?.querySelector('[data-provider-logo="notion"]') as HTMLImageElement | null;
    expect(logo?.getAttribute('src')).toBe('/icons/notion.svg');
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
              href: 'https://app.notion.com/example',
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

  it('renders menu items as vertical flex buttons that can wrap text', async () => {
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
              href: 'https://app.notion.com/example',
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

    const trigger = document.querySelector('[aria-label="Open destinations"]') as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLButtonElement[];
    expect(menuItems).toHaveLength(2);
    expect(menuItems[0]?.className || '').toContain('tw-flex');
    expect(menuItems[0]?.className || '').toContain('tw-whitespace-normal');
    expect(menuItems[0]?.className || '').toContain('tw-break-words');
    expect(menuItems[0]?.querySelector('[data-provider-logo="notion"]')?.getAttribute('src')).toBe('/icons/notion.svg');
    expect(menuItems[1]?.querySelector('[data-provider-logo="obsidian"]')?.getAttribute('src')).toBe(
      '/icons/obsidian.svg',
    );
  });

  it('renders multiple inline menu items without creating a nested popover', async () => {
    const firstTrigger = vi.fn(async () => {});
    const disabledTrigger = vi.fn(async () => {});
    const closeMenu = vi.fn();

    act(() => {
      root!.render(
        createElement(DetailHeaderActionBar, {
          actions: [
            {
              id: 'copy-full-markdown',
              label: 'Copy full Markdown',
              provider: 'local',
              kind: 'copy-text',
              slot: 'tools',
              onTrigger: firstTrigger,
            },
            {
              id: 'open-original',
              label: 'Open original',
              provider: 'source',
              kind: 'external-link',
              slot: 'tools',
              disabled: true,
              onTrigger: disabledTrigger,
            },
          ],
          buttonClassName,
          inlineMenuItems: true,
          closeMenuOnActionTrigger: closeMenu,
        }),
      );
    });

    expect(document.querySelector('[aria-haspopup="menu"]')).toBeFalsy();
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLButtonElement[];
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.textContent)).toEqual(['Copy full Markdown', 'Open original']);
    expect(items[1]?.disabled).toBe(true);

    await act(async () => {
      items[0]!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(firstTrigger).toHaveBeenCalledTimes(1);
    expect(closeMenu).toHaveBeenCalledTimes(1);

    items[1]!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(disabledTrigger).not.toHaveBeenCalled();
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
              href: 'https://app.notion.com/example',
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

  it('shows transient icon-only success status without changing the button into a text action', async () => {
    vi.useFakeTimers();
    try {
      const onTrigger = vi.fn(async () => {});
      act(() => {
        root!.render(
          createElement(DetailHeaderActionBar, {
            actions: [
              {
                id: 'copy-notion-link',
                label: 'Copy Notion link',
                provider: 'notion',
                kind: 'copy-text',
                slot: 'copy',
                afterTriggerLabel: 'Copied',
                onTrigger,
              },
            ],
            buttonClassName,
          }),
        );
      });

      const button = document.querySelector('[aria-label="Copy Notion link"]') as HTMLButtonElement | null;
      expect(button).toBeTruthy();
      expect(button?.textContent || '').not.toContain('Copy Notion link');

      await act(async () => {
        button!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });

      const status = document.querySelector('[role="status"]') as HTMLElement | null;
      expect(status?.textContent).toBe('Copied');
      expect(status?.className || '').toContain('tw-absolute');
      expect(button?.textContent || '').not.toContain('Copied');

      await act(async () => {
        vi.advanceTimersByTime(2_600);
        await Promise.resolve();
      });
      expect(document.querySelector('[role="status"]')).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears stale success feedback before a later action that fails', async () => {
    const alertSpy = vi.fn();
    Object.defineProperty(globalThis.window, 'alert', { configurable: true, value: alertSpy });
    const onTrigger = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('copy denied'));

    act(() => {
      root!.render(
        createElement(DetailHeaderActionBar, {
          actions: [
            {
              id: 'copy-notion-link',
              label: 'Copy Notion link',
              provider: 'notion',
              kind: 'copy-text',
              slot: 'copy',
              afterTriggerLabel: 'Copied',
              onTrigger,
            },
          ],
          buttonClassName,
        }),
      );
    });

    const button = document.querySelector('[aria-label="Copy Notion link"]') as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Copied');

    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(alertSpy).toHaveBeenCalledWith('copy denied');
    expect(document.querySelector('[role="status"]')).toBeFalsy();
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
});
