import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { readerOutlineLevelToMinimapWidth } from '../../src/services/protocols/reader-outline';
import { ChatOutlinePanel } from '../../src/ui/conversations/chat-outline/ChatOutlinePanel';
import type { ChatOutlineEntry } from '../../src/ui/conversations/chat-outline/outline-entries';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element });
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: dom.window.MouseEvent });
  Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: dom.window.KeyboardEvent });
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
  delete (globalThis as any).Element;
  delete (globalThis as any).MouseEvent;
  delete (globalThis as any).KeyboardEvent;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

const entries: ChatOutlineEntry[] = [
  {
    index: 1,
    messageId: 101,
    messageKey: 'u-101',
    previewText: '解释这篇文章的核心观点',
  },
  {
    index: 2,
    messageId: 102,
    messageKey: 'u-102',
    previewText: '给我一个行动清单',
  },
];

function makeEntries(count: number): ChatOutlineEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const entryIndex = index + 1;
    return {
      index: entryIndex,
      messageId: 1000 + entryIndex,
      messageKey: `u-${entryIndex}`,
      previewText: `User prompt ${entryIndex}`,
    };
  });
}

describe('ChatOutlinePanel', () => {
  let root: ReactDOM.Root | null = null;

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

  it('does not render an outline entry point when there are no entries', () => {
    act(() => {
      root!.render(createElement(ChatOutlinePanel, { entries: [] }));
    });

    expect(document.querySelector('[data-reader-rail-wrap="chat-outline"]')).toBeNull();
    expect(document.getElementById('root')?.innerHTML).toBe('');
  });

  it('uses the shared rail panel without visible chat-specific directory copy', async () => {
    const onPickEntry = vi.fn();
    const longPreview = '请总结这篇文章的核心观点，并按照背景、论点、证据、结论四个部分展开说明';
    const panelEntries = [{ ...entries[0], previewText: longPreview }, entries[1]];
    act(() => {
      root!.render(createElement(ChatOutlinePanel, { entries: panelEntries, activeIndex: 2, onPickEntry }));
    });

    const wrap = document.querySelector('[data-reader-rail-wrap="chat-outline"]') as HTMLElement | null;
    expect(wrap).toBeTruthy();
    expect(wrap?.querySelectorAll('[data-chat-outline-trigger-bar]')).toHaveLength(panelEntries.length);
    expect(
      wrap?.querySelector('[data-chat-outline-trigger-active="true"]')?.getAttribute('data-chat-outline-trigger-bar'),
    ).toBe('u-102');

    act(() => {
      wrap!.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    });

    const panel = document.querySelector('[data-reader-rail-panel="chat-outline"]') as HTMLElement | null;
    const triggerShell = wrap?.querySelector('[data-reader-rail-trigger-shell="chat-outline"]') as HTMLElement | null;
    expect(panel).toBeTruthy();
    expect(panel?.style.right).toBe('0px');
    expect(panel?.style.top).toBe('0px');
    expect(triggerShell?.getAttribute('aria-hidden')).toBe('true');
    expect(triggerShell?.style.visibility).toBe('hidden');
    expect(triggerShell?.style.pointerEvents).toBe('none');
    expect(document.body.textContent).not.toContain('目录');
    expect(document.body.textContent).not.toContain('用户消息');
    expect(panel?.querySelector('[data-chat-outline-active="true"]')?.textContent).toBe('2. 给我一个行动清单');

    const firstEntry = panel?.querySelector('[data-chat-outline-entry="u-101"]') as HTMLButtonElement | null;
    expect(firstEntry?.textContent).toBe(`1. ${longPreview}`);
    const firstEntryLabel = panel?.querySelector('[data-chat-outline-entry-label="u-101"]') as HTMLElement | null;
    expect(firstEntryLabel?.getAttribute('style')).toContain('-webkit-line-clamp: 2');
    expect(firstEntryLabel?.getAttribute('style')).toContain('line-height: 1.35');
    expect(firstEntryLabel?.getAttribute('style')).toContain('overflow-wrap: anywhere');
    expect(firstEntry?.className).toContain('tw-min-h-[50px]');
    expect(firstEntry?.classList.contains('webclipper-btn')).toBe(true);
    expect(firstEntry?.classList.contains('webclipper-btn--menu-item')).toBe(true);
    expect(firstEntry?.classList.contains('webclipper-btn--tone-muted')).toBe(true);
    expect(panel?.querySelector('[data-chat-outline-active="true"]')?.getAttribute('aria-checked')).toBe('true');

    act(() => {
      firstEntry!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onPickEntry).toHaveBeenCalledWith(panelEntries[0]);

    act(() => {
      wrap!.dispatchEvent(
        new window.MouseEvent('mouseout', { bubbles: true, cancelable: true, relatedTarget: document.body }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });

    expect(document.querySelector('[data-reader-rail-panel="chat-outline"]')).toBeNull();
    expect(triggerShell?.getAttribute('aria-hidden')).toBeNull();
    expect(triggerShell?.style.visibility).toBe('');
    expect(triggerShell?.style.pointerEvents).toBe('');
  });

  it('consumes Escape while the hover outline is open instead of leaking it to the popup', async () => {
    act(() => {
      root!.render(createElement(ChatOutlinePanel, { entries, activeIndex: 1 }));
    });

    const wrap = document.querySelector('[data-reader-rail-wrap="chat-outline"]') as HTMLElement | null;
    expect(wrap).toBeTruthy();

    act(() => {
      wrap!.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[data-reader-rail-panel="chat-outline"]')).toBeTruthy();

    const escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => {
      document.dispatchEvent(escape);
      await Promise.resolve();
    });

    expect(escape.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-reader-rail-panel="chat-outline"]')).toBeNull();
  });

  it('keeps the trigger visible for large chat outlines while preserving the active marker', () => {
    const manyEntries = makeEntries(50);
    act(() => {
      root!.render(createElement(ChatOutlinePanel, { entries: manyEntries, activeIndex: 37 }));
    });

    const wrap = document.querySelector('[data-reader-rail-wrap="chat-outline"]') as HTMLElement | null;
    const barsRoot = wrap?.querySelector('[data-chat-outline-trigger-bars]') as HTMLElement | null;
    const bars = Array.from(wrap?.querySelectorAll('[data-chat-outline-trigger-bar]') || []);

    expect(barsRoot?.getAttribute('data-chat-outline-trigger-bars')).toBe('50');
    expect(barsRoot?.tagName).toBe('NAV');
    expect(barsRoot?.className).toContain('tw-gap-2');
    expect(barsRoot?.className).toContain('tw-py-1');
    expect(barsRoot?.className).toContain('tw-pr-1');
    expect(bars).toHaveLength(7);
    expect(bars.every((bar) => (bar as HTMLElement).className.includes('tw-h-[2px]'))).toBe(true);
    expect(bars.every((bar) => (bar as HTMLElement).className.includes('tw-rounded-[var(--radius-inline)]'))).toBe(
      true,
    );
    expect(
      Array.from(wrap?.querySelectorAll('[data-chat-outline-trigger-bars] button') || []).every((button) =>
        (button as HTMLElement).className.includes('tw-leading-none'),
      ),
    ).toBe(true);
    expect((wrap?.querySelector('[data-chat-outline-trigger-bar="u-37"]') as HTMLElement | null)?.style.width).toBe(
      `${readerOutlineLevelToMinimapWidth(1)}px`,
    );
    expect((wrap?.querySelector('[data-chat-outline-trigger-bar="u-1"]') as HTMLElement | null)?.style.width).toBe(
      `${readerOutlineLevelToMinimapWidth(2)}px`,
    );
    expect(wrap?.querySelector('[data-chat-outline-trigger-bar="u-37"]')).toBeTruthy();
    expect(
      wrap?.querySelector('[data-chat-outline-trigger-active="true"]')?.getAttribute('data-chat-outline-trigger-bar'),
    ).toBe('u-37');
  });
});
