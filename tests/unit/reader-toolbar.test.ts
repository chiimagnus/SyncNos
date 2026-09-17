import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import type { ReaderOutlineDomEntry } from '../../src/ui/reader/article-outline-dom';

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('../../src/ui/shared/hooks/useIsNarrowScreen', () => ({
  useIsNarrowScreen: vi.fn(),
}));

import { ReaderToolbar } from '../../src/ui/reader/ReaderToolbar';
import { useIsNarrowScreen } from '../../src/ui/shared/hooks/useIsNarrowScreen';

function setupDom(width = 1024) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });

  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: dom.window.Element });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
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
  delete (globalThis as any).Node;
  delete (globalThis as any).MouseEvent;
  delete (globalThis as any).KeyboardEvent;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

function buildOutlineEntry(): ReaderOutlineDomEntry {
  const element = document.createElement('h2');
  Object.defineProperty(element, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  return {
    index: 0,
    level: 2,
    id: 'outline-1',
    title: 'Outline heading',
    element,
    rect: { top: 24, bottom: 60 },
  };
}

describe('ReaderToolbar', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    root = ReactDOM.createRoot(document.getElementById('root')!);
    vi.mocked(useIsNarrowScreen).mockReturnValue(false);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  function renderToolbar(overrides: Partial<Parameters<typeof ReaderToolbar>[0]> = {}) {
    act(() => {
      root!.render(createElement(ReaderToolbar, { ...overrides }));
    });
  }

  function getWrap(): HTMLElement {
    const wrap = document.querySelector('[data-reader-rail-wrap="outline"]') as HTMLElement | null;
    if (!wrap) throw new Error('missing outline wrap');
    return wrap;
  }

  function getPanel(): HTMLElement | null {
    return document.querySelector('[data-reader-rail-panel="outline"]') as HTMLElement | null;
  }

  async function hoverOpen() {
    await act(async () => {
      getWrap().dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
  }

  async function hoverLeave() {
    await act(async () => {
      getWrap().dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, cancelable: true, relatedTarget: document.body }),
      );
      await Promise.resolve();
    });
  }

  it('renders only the outline rail, keeps strip click non-closing, and closes after list-item clicks', async () => {
    const outlineEntry = buildOutlineEntry();
    const onPickStripEntry = vi.fn((entry: ReaderOutlineDomEntry) => {
      entry.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const onPickPanelEntry = vi.fn((entry: ReaderOutlineDomEntry) => {
      entry.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    renderToolbar({
      outline: {
        entries: [outlineEntry],
        activeIndex: 0,
        onPickStripEntry,
        onPickPanelEntry,
      },
    });

    const toolbar = document.querySelector('[role="toolbar"]') as HTMLElement | null;
    expect(toolbar).toBeTruthy();
    expect(toolbar?.getAttribute('aria-orientation')).toBe('vertical');
    expect(document.querySelector('[data-reader-rail-wrap="text"]')).toBeNull();
    expect(document.querySelector('[data-reader-rail-wrap="theme"]')).toBeNull();
    expect(document.querySelector('[data-reader-rail-wrap="narration"]')).toBeNull();

    await hoverOpen();
    expect(getPanel()).toBeTruthy();

    const stripButton = document.querySelector(
      '[data-reader-rail-wrap="outline"] [data-reader-rail-trigger-shell="outline"] nav button[data-reader-outline-level="lvl-2"]',
    ) as HTMLButtonElement | null;
    expect(stripButton).toBeTruthy();
    act(() => {
      stripButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onPickStripEntry).toHaveBeenCalledTimes(1);
    expect(onPickPanelEntry).toHaveBeenCalledTimes(0);
    expect(getPanel()).toBeTruthy();

    const panelButton = document.querySelector(
      '[data-reader-rail-panel="outline"] button[data-reader-outline-level="lvl-2"]',
    ) as HTMLButtonElement | null;
    expect(panelButton).toBeTruthy();
    act(() => {
      panelButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onPickPanelEntry).toHaveBeenCalledTimes(1);
    expect(getPanel()).toBeNull();
    expect(outlineEntry.element.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('closes the outline panel on hover leave after the delay and on Escape', async () => {
    renderToolbar({
      outline: {
        entries: [buildOutlineEntry()],
        activeIndex: 0,
        onPickStripEntry: vi.fn(),
        onPickPanelEntry: vi.fn(),
      },
    });

    await hoverOpen();
    expect(getPanel()).toBeTruthy();

    await hoverLeave();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(getPanel()).toBeNull();

    await hoverOpen();
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => {
      document.dispatchEvent(escape);
      await Promise.resolve();
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(getPanel()).toBeNull();
  });

  it('uses narrow outline panel geometry when the viewport is narrower than 720px', async () => {
    vi.mocked(useIsNarrowScreen).mockReturnValue(true);
    renderToolbar({
      outline: {
        entries: [buildOutlineEntry()],
        activeIndex: 0,
        onPickStripEntry: vi.fn(),
        onPickPanelEntry: vi.fn(),
      },
    });

    await hoverOpen();
    const panel = getPanel();
    expect(panel).toBeTruthy();
    expect(panel?.style.right).toBe('0px');
    expect(panel?.style.top).toBe('0px');
    expect(panel?.style.width).toBe('300px');
    expect(panel?.style.maxWidth).toBe('calc(100vw - 28px)');
    expect(panel?.style.maxHeight).toBe('70vh');
    expect(panel?.style.overflow).toBe('auto');
  });

  it('returns null when no outline entries are available', () => {
    renderToolbar();
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    expect(document.getElementById('root')?.innerHTML).toBe('');
  });
});
