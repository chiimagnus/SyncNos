import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, createRef } from 'react';
import ReactDOM from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { computePosition } from '@floating-ui/dom';

import { DEFAULT_READER_PREFS } from '../../src/services/protocols/reader-prefs';

vi.mock('@floating-ui/dom', () => ({
  autoUpdate: (_anchor: Element, _floating: Element, update: () => void) => {
    update();
    return () => {};
  },
  computePosition: vi.fn().mockResolvedValue({ x: 24, y: 40 }),
  flip: () => ({ name: 'flip' }),
  offset: () => ({ name: 'offset' }),
  shift: () => ({ name: 'shift' }),
  size: () => ({ name: 'size' }),
}));

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
import { MenuPopover } from '../../src/ui/shared/MenuPopover';

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

function pointerEvent(
  type: 'pointerover' | 'pointerout',
  relatedTarget: EventTarget | null = null,
  pointerType = 'mouse',
) {
  const event = new window.MouseEvent(type, { bubbles: true, relatedTarget });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
}

function cleanupDom() {
  // React and floating-position promises can finish after an act scope.
  // The next setup replaces JSDOM globals; don't revoke them under pending React work.
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

  afterEach(async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => root?.unmount());
    root = null;
    cleanupDom();
  });

  it('opens only one side submenu on hover and keeps panel buttons clickable', async () => {
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
          narrationShortcut: '⌥ + ⇧ + R',
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
    expect(document.querySelector('[data-reader-submenu]')).toBeNull();
    expect(document.querySelector('[data-reader-header-trigger="text"] svg')).toBeTruthy();
    expect(document.querySelector('[data-reader-header-trigger="theme"] svg')).toBeTruthy();
    expect(document.querySelector('[data-reader-header-trigger="narration"] svg')).toBeTruthy();
    expect((document.querySelector('[data-reader-header-trigger="text"]') as HTMLElement | null)?.className).toContain(
      'tw-justify-between',
    );

    act(() => {
      (document.querySelector('[data-reader-header-trigger="text"]') as HTMLButtonElement).dispatchEvent(
        pointerEvent('pointerover'),
      );
    });
    const textPanel = document.querySelector(
      '[role="dialog"][aria-label="readerTextLayoutButton"]',
    ) as HTMLElement | null;
    expect(textPanel).toBeTruthy();
    expect(textPanel?.className.includes('menu-panel')).toBe(true);
    expect(textPanel?.className.includes('tw-fixed')).toBe(true);
    expect(textPanel?.parentElement).toBe(document.body);
    expect(textPanel?.textContent).toBe('text-layout-action');
    expect(textPanel?.querySelector('[data-reader-submenu-back]')).toBeNull();
    expect(document.querySelectorAll('[data-reader-submenu]')).toHaveLength(1);
    expect(document.querySelector('[data-testid="text-layout-action"]')).toBeTruthy();
    act(() => {
      (document.querySelector('[data-testid="text-layout-action"]') as HTMLButtonElement).click();
    });
    expect(mocks.update).toHaveBeenCalledWith({ fontSize: 24 });

    act(() => {
      (document.querySelector('[data-reader-header-trigger="theme"]') as HTMLButtonElement).dispatchEvent(
        pointerEvent('pointerover'),
      );
    });
    expect(document.querySelector('[data-testid="theme-action"]')).toBeTruthy();
    expect(document.querySelector('[data-reader-submenu="theme"]')?.textContent).toBe('theme-action');
    act(() => {
      (document.querySelector('[data-testid="theme-action"]') as HTMLButtonElement).click();
    });
    expect(mocks.updateThemeMode).toHaveBeenCalledWith('black');
    expect(mocks.commitPreview).toHaveBeenCalledTimes(1);

    act(() => {
      (document.querySelector('[data-reader-header-trigger="narration"]') as HTMLButtonElement).dispatchEvent(
        pointerEvent('pointerover'),
      );
    });
    expect(document.querySelector('[data-testid="narration-action"]')).toBeTruthy();
    expect(document.querySelector('[data-reader-submenu="narration"]')?.textContent).toBe('narration-action');
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
    const playPause = document.querySelector('[data-reader-narration-play-pause="true"]');
    expect(playPause?.getAttribute('data-tooltip-content')).toBe('readerNarrationPlay\n⌥ + ⇧ + R');
    expect(playPause?.getAttribute('data-tooltip-shortcut')).toBe('⌥ + ⇧ + R');
  });

  it('keeps the parent menu open for portal clicks and dismisses one level at a time', async () => {
    const insideRef = createRef<HTMLDivElement>();
    const onMainOpenChange = vi.fn();
    await act(async () => {
      root!.render(
        createElement(
          MenuPopover,
          {
            open: true,
            onOpenChange: onMainOpenChange,
            ariaLabel: 'More',
            insideRef,
            trigger: (props) => createElement('button', { ...props, 'data-main-menu-trigger': true }, 'More'),
          },
          createElement(ReaderHeaderToolbar, {
            features: { textLayout: true, theme: true, narration: false },
            prefs: DEFAULT_READER_PREFS,
            update: mocks.update,
            preview: mocks.preview,
            commitPreview: mocks.commitPreview,
            themeMode: 'system',
            updateThemeMode: mocks.updateThemeMode,
            narration: {
              state: 'idle',
              isPlaying: false,
              error: null,
              webSpeechAvailable: true,
              pause: vi.fn(),
              stop: mocks.stop,
              toggle: mocks.toggle,
            },
            submenuRef: insideRef,
          }),
        ),
      );
      await Promise.resolve();
    });

    const trigger = document.querySelector('[data-reader-header-trigger="theme"]') as HTMLButtonElement;
    await act(async () => {
      trigger.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(document.querySelector('[data-reader-submenu="theme"]')).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(insideRef.current?.parentElement).toBe(document.body);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);

    await act(async () => {
      (document.querySelector('[data-testid="theme-action"]') as HTMLElement).dispatchEvent(
        new window.Event('pointerdown', { bubbles: true }),
      );
      (document.querySelector('[data-testid="theme-action"]') as HTMLElement).click();
      await Promise.resolve();
    });
    expect(mocks.updateThemeMode).toHaveBeenCalledWith('black');
    expect(onMainOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      insideRef.current?.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(insideRef.current).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(onMainOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onMainOpenChange).toHaveBeenCalledWith(false);
  });

  it('retains hover-open submenu while the pointer moves from its trigger into the floating panel', async () => {
    await act(async () => {
      root!.render(
        createElement(ReaderHeaderToolbar, {
          features: { textLayout: true, theme: true, narration: false },
          prefs: DEFAULT_READER_PREFS,
          update: mocks.update,
          preview: mocks.preview,
          commitPreview: mocks.commitPreview,
          themeMode: 'system',
          updateThemeMode: mocks.updateThemeMode,
          narration: {
            state: 'idle',
            isPlaying: false,
            error: null,
            webSpeechAvailable: true,
            pause: vi.fn(),
            stop: mocks.stop,
            toggle: mocks.toggle,
          },
        }),
      );
      await Promise.resolve();
    });
    const trigger = document.querySelector('[data-reader-header-trigger="theme"]') as HTMLButtonElement;
    await act(async () => {
      trigger.dispatchEvent(pointerEvent('pointerover'));
      await Promise.resolve();
    });
    const panel = document.querySelector('[data-reader-submenu="theme"]') as HTMLElement;
    expect(panel).toBeTruthy();
    await act(async () => {
      trigger.dispatchEvent(pointerEvent('pointerout', document.body));
      panel.dispatchEvent(pointerEvent('pointerover'));
      await new Promise<void>((resolve) => setTimeout(resolve, 230));
    });
    expect(document.querySelector('[data-reader-submenu="theme"]')).toBeTruthy();

    await act(async () => {
      panel.dispatchEvent(pointerEvent('pointerout', document.body));
      await new Promise<void>((resolve) => setTimeout(resolve, 230));
    });
    expect(document.querySelector('[data-reader-submenu]')).toBeNull();
  });

  it.each([
    { width: 1100, left: 800, right: 1040, placement: 'left-start' },
    { width: 900, left: 20, right: 260, placement: 'left-start' },
    { width: 420, left: 140, right: 400, placement: 'bottom-end' },
    { width: 320, left: 40, right: 300, placement: 'bottom-end' },
  ])('places a submenu without covering its trigger at $width px', async ({ width, left, right, placement }) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    const getRect = vi.spyOn(window.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-reader-submenu')
        ? new window.DOMRect(0, 0, Math.min(320, width - 24), 200)
        : new window.DOMRect(left, 100, right - left, 36);
    });
    vi.mocked(computePosition).mockClear();
    try {
      await act(async () => {
        root!.render(
          createElement(ReaderHeaderToolbar, {
            features: { textLayout: true, theme: true, narration: false },
            prefs: DEFAULT_READER_PREFS,
            update: mocks.update,
            preview: mocks.preview,
            commitPreview: mocks.commitPreview,
            themeMode: 'system',
            updateThemeMode: mocks.updateThemeMode,
            narration: {
              state: 'idle',
              isPlaying: false,
              error: null,
              webSpeechAvailable: true,
              stop: mocks.stop,
              toggle: mocks.toggle,
            },
          }),
        );
      });
      const trigger = document.querySelector<HTMLButtonElement>('[data-reader-header-trigger="theme"]')!;
      // Touch must not hover-open and immediately close on its first tap.
      act(() => trigger.dispatchEvent(pointerEvent('pointerover', null, 'touch')));
      expect(document.querySelector('[data-reader-submenu]')).toBeNull();
      await act(async () => trigger.click());
      expect(vi.mocked(computePosition)).toHaveBeenCalledWith(
        trigger,
        expect.any(HTMLElement),
        expect.objectContaining({ placement }),
      );
      expect(document.querySelector('[data-reader-submenu]')).toBeTruthy();
      act(() => trigger.click());
      expect(document.querySelector('[data-reader-submenu]')).toBeNull();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
    } finally {
      getRect.mockRestore();
    }
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
          narrationShortcut: '⌥ + ⇧ + R',
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
        (document.querySelector(`[data-reader-header-trigger="${panel}"]`) as HTMLButtonElement).dispatchEvent(
          pointerEvent('pointerover'),
        );
      });
    };

    clickTrigger('theme');
    clickTrigger('text');
    expect(mocks.commitPreview).toHaveBeenCalledTimes(0);

    clickTrigger('narration');
    expect(mocks.commitPreview).toHaveBeenCalledTimes(1);

    clickTrigger('text');
    expect(mocks.commitPreview).toHaveBeenCalledTimes(2);

    act(() => {
      (document.querySelector('[data-reader-header-trigger="text"]') as HTMLButtonElement).click();
    });
    expect(mocks.commitPreview).toHaveBeenCalledTimes(3);

    clickTrigger('narration');
    clickTrigger('theme');
    expect(mocks.commitPreview).toHaveBeenCalledTimes(4);
  });
});
