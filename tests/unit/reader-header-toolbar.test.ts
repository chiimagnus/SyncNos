import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { DEFAULT_READER_PREFS } from '../../src/services/protocols/reader-prefs';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  preview: vi.fn(),
  commitPreview: vi.fn().mockResolvedValue(undefined),
  updateThemeMode: vi.fn(),
  toggle: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('../../src/ui/shared/SelectMenu', () => ({
  SelectMenu: ({
    ariaLabel,
    value,
    options,
  }: {
    ariaLabel: string;
    value: string;
    options: Array<{ value: string; label: string; disabled?: boolean }>;
  }) =>
    createElement(
      'div',
      {
        'data-select-aria': ariaLabel,
        'data-value': value,
      },
      options.map((option) =>
        createElement(
          'div',
          {
            key: option.value,
            'data-option-value': option.value,
          },
          option.label,
        ),
      ),
    ),
}));

vi.mock('../../src/ui/shared/button-styles', async () => {
  const actual = await vi.importActual('../../src/ui/shared/button-styles');
  return {
    ...actual,
    buttonTintClassName: () => 'btn-tint',
    buttonFilledClassName: () => 'btn-filled',
    headerButtonClassName: () => 'btn-header',
    menuPopoverPanelClassName: () => 'menu-panel',
  };
});

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('../../src/ui/reader/TextLayoutPanel', () => ({
  TextLayoutPanel: ({ update }: { update: (patch: unknown) => void }) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'text-layout-action',
        onClick: () => update({ fontSize: 24 }),
      },
      'text-layout-action',
    ),
}));

vi.mock('../../src/ui/reader/ThemePanel', () => ({
  ThemePanel: ({ update }: { update: (mode: string) => void }) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'theme-action',
        onClick: () => update('black'),
      },
      'theme-action',
    ),
}));

vi.mock('../../src/ui/reader/NarrationPanel', () => ({
  NarrationPanel: ({ update }: { update: (patch: unknown) => void }) =>
    createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'narration-action',
        onClick: () => update({ tts: { rate: 1.5 } }),
      },
      'narration-action',
    ),
}));

import { ReaderHeaderToolbar } from '../../src/ui/reader/ReaderHeaderToolbar';

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
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'PointerEvent', {
    configurable: true,
    value: dom.window.PointerEvent ?? dom.window.MouseEvent,
  });
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
  delete (globalThis as any).PointerEvent;
  delete (globalThis as any).MouseEvent;
  delete (globalThis as any).KeyboardEvent;
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

describe('ReaderHeaderToolbar', () => {
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    setupDom();
    mocks.update.mockReset();
    mocks.preview.mockReset();
    mocks.commitPreview.mockReset().mockResolvedValue(undefined);
    mocks.updateThemeMode.mockReset();
    mocks.toggle.mockReset();
    mocks.stop.mockReset();
    root = ReactDOM.createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('renders the reader controls as vertical menu items and keeps panel buttons clickable', async () => {
    act(() => {
      root!.render(
        createElement(ReaderHeaderToolbar, {
          features: { textLayout: true, theme: true, narration: true },
          prefs: DEFAULT_READER_PREFS,
          update: mocks.update,
          preview: mocks.preview,
          commitPreview: mocks.commitPreview,
          themeMode: 'system',
          updateThemeMode: mocks.updateThemeMode,
          narration: {
            state: 'paused',
            isPlaying: false,
            error: null,
            webSpeechAvailable: true,
            pause: vi.fn(),
            stop: mocks.stop,
            toggle: mocks.toggle,
          },
        }),
      );
    });

    const toolbar = document.querySelector('[data-reader-header-toolbar="true"]') as HTMLElement | null;
    expect(toolbar).toBeTruthy();
    expect(toolbar?.getAttribute('role')).toBe('group');
    expect(toolbar?.className).toContain('tw-flex-col');
    expect(document.querySelector('[data-reader-header-trigger="text"] svg')).toBeTruthy();
    expect(document.querySelector('[data-reader-header-trigger="theme"] svg')).toBeTruthy();
    expect(document.querySelector('[data-reader-header-trigger="narration"] svg')).toBeTruthy();
    expect((document.querySelector('[data-reader-header-trigger="text"]') as HTMLElement | null)?.className).toContain(
      'tw-justify-between',
    );

    act(() => {
      (document.querySelector('[data-reader-header-trigger="text"]') as HTMLButtonElement).click();
    });
    const textPanel = document.querySelector(
      '[role="menu"][aria-label="readerTextLayoutButton"]',
    ) as HTMLElement | null;
    expect(textPanel).toBeTruthy();
    expect(textPanel?.className.includes('menu-panel')).toBe(true);
    expect(textPanel?.className.includes('tw-p-3')).toBe(false);
    expect(document.querySelector('[data-testid="text-layout-action"]')).toBeTruthy();
    act(() => {
      (document.querySelector('[data-testid="text-layout-action"]') as HTMLButtonElement).click();
    });
    expect(mocks.update).toHaveBeenCalledWith({ fontSize: 24 });

    act(() => {
      (document.querySelector('[data-reader-header-trigger="theme"]') as HTMLButtonElement).click();
    });
    expect(document.querySelector('[data-testid="theme-action"]')).toBeTruthy();
    act(() => {
      (document.querySelector('[data-testid="theme-action"]') as HTMLButtonElement).click();
    });
    expect(mocks.updateThemeMode).toHaveBeenCalledWith('black');
    expect(mocks.commitPreview).toHaveBeenCalledTimes(1);

    act(() => {
      (document.querySelector('[data-reader-header-trigger="narration"]') as HTMLButtonElement).click();
    });
    expect(document.querySelector('[data-testid="narration-action"]')).toBeTruthy();
    expect(mocks.commitPreview).toHaveBeenCalledTimes(1);
    act(() => {
      (document.querySelector('[data-testid="narration-action"]') as HTMLButtonElement).click();
    });
    act(() => {
      (document.querySelector('[aria-label="readerNarrationPlay"]') as HTMLButtonElement).click();
      (document.querySelector('[aria-label="readerNarrationStop"]') as HTMLButtonElement).click();
    });
    expect(mocks.update).toHaveBeenCalledWith({ tts: { rate: 1.5 } });
    expect(mocks.toggle).toHaveBeenCalledTimes(1);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it('commits dirty-capable panels on every exit and skips theme-only transitions', () => {
    act(() => {
      root!.render(
        createElement(ReaderHeaderToolbar, {
          features: { textLayout: true, theme: true, narration: true },
          prefs: DEFAULT_READER_PREFS,
          update: mocks.update,
          preview: mocks.preview,
          commitPreview: mocks.commitPreview,
          themeMode: 'system',
          updateThemeMode: mocks.updateThemeMode,
          narration: {
            state: 'paused',
            isPlaying: false,
            error: null,
            webSpeechAvailable: true,
            pause: vi.fn(),
            stop: mocks.stop,
            toggle: mocks.toggle,
          },
        }),
      );
    });

    const clickTrigger = (panel: 'text' | 'theme' | 'narration') => {
      act(() => {
        (document.querySelector(`[data-reader-header-trigger="${panel}"]`) as HTMLButtonElement).click();
      });
    };

    clickTrigger('theme');
    clickTrigger('text');
    expect(mocks.commitPreview).toHaveBeenCalledTimes(0);

    clickTrigger('narration');
    expect(mocks.commitPreview).toHaveBeenCalledTimes(1);

    clickTrigger('text');
    expect(mocks.commitPreview).toHaveBeenCalledTimes(2);

    clickTrigger('text');
    expect(mocks.commitPreview).toHaveBeenCalledTimes(3);

    clickTrigger('narration');
    clickTrigger('theme');
    expect(mocks.commitPreview).toHaveBeenCalledTimes(4);
  });
});
