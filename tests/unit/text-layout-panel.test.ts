import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import {
  DEFAULT_READER_PREFS,
  DEFAULT_READER_TYPOGRAPHY_PRESET,
  READER_PREFS_LIMITS,
} from '../../src/services/protocols/reader-prefs';

vi.mock('../../src/ui/shared/SelectMenu', () => ({
  SelectMenu: ({
    ariaLabel,
    value,
    options,
    onChange,
  }: {
    ariaLabel: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
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
            onClick: () => onChange(option.value),
          },
          option.label,
        ),
      ),
    ),
}));

vi.mock('../../src/ui/shared/button-styles', () => ({
  buttonTintClassName: () => 'btn',
}));

vi.mock('../../src/ui/i18n', () => ({
  t: (key: string) => key,
}));

import { TextLayoutPanel } from '../../src/ui/reader/TextLayoutPanel';

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
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
}

describe('TextLayoutPanel', () => {
  let root: Root | null = null;

  beforeEach(async () => {
    setupDom();
    const { createRoot } = await import('react-dom/client');
    root = createRoot(document.getElementById('root')!);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    cleanupDom();
  });

  it('renders only reset and field controls', () => {
    const update = vi.fn();
    const preview = vi.fn();
    const commitPreview = vi.fn().mockResolvedValue(undefined);
    const prefs = {
      ...DEFAULT_READER_PREFS,
      fontFamily: 'mono' as const,
      fontSize: 24,
      lineHeight: 1.5,
      contentWidth: 1500,
      letterSpacing: 0.02,
      textAlign: 'justify' as const,
    };

    act(() => {
      root!.render(createElement(TextLayoutPanel, { prefs, update, preview, commitPreview }));
    });

    const buttons = Array.from(document.querySelectorAll('button'));
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe('reset');
    expect(document.body.textContent).not.toContain('readerPresetNotion');
    expect(document.body.textContent).not.toContain('readerPresetBook');

    const widthInput = document.querySelector('[aria-label="readerContentWidthAria"]') as HTMLInputElement | null;
    expect(widthInput?.max).toBe(String(READER_PREFS_LIMITS.contentWidth.max));
    expect(widthInput?.value).toBe('1500');

    const letterSpacingInput = document.querySelector(
      '[aria-label="readerLetterSpacingAria"]',
    ) as HTMLInputElement | null;
    expect(letterSpacingInput?.min).toBe('0');
    expect(letterSpacingInput?.value).toBe('0.02');

    const fontSelect = document.querySelector('[data-select-aria="readerFontAria"]');
    expect(fontSelect?.getAttribute('data-value')).toBe('mono');

    const alignSelect = document.querySelector('[data-select-aria="readerAlignAria"]');
    expect(alignSelect?.getAttribute('data-value')).toBe('justify');
  });

  it('resets typography to the canonical default preset', () => {
    const update = vi.fn();
    const preview = vi.fn();
    const commitPreview = vi.fn().mockResolvedValue(undefined);

    act(() => {
      root!.render(
        createElement(TextLayoutPanel, {
          prefs: DEFAULT_READER_PREFS,
          update,
          preview,
          commitPreview,
        }),
      );
    });

    const resetButton = document.querySelector('button');
    expect(resetButton?.textContent).toBe('reset');

    act(() => {
      resetButton?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(DEFAULT_READER_TYPOGRAPHY_PRESET);
  });

  it('previews range changes and commits only at deterministic interaction boundaries', () => {
    const update = vi.fn();
    const preview = vi.fn();
    const commitPreview = vi.fn().mockResolvedValue(undefined);
    act(() => {
      root!.render(createElement(TextLayoutPanel, { prefs: DEFAULT_READER_PREFS, update, preview, commitPreview }));
    });

    const input = document.querySelector('[aria-label="readerFontSizeAria"]') as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    act(() => {
      valueSetter?.call(input, '25');
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(preview).toHaveBeenCalledWith({ fontSize: 25 });
    expect(update).not.toHaveBeenCalled();
    expect(commitPreview).not.toHaveBeenCalled();

    act(() => input.dispatchEvent(new window.Event('pointerup', { bubbles: true })));
    act(() => input.dispatchEvent(new window.Event('pointercancel', { bubbles: true })));
    act(() => input.dispatchEvent(new window.KeyboardEvent('keyup', { bubbles: true, key: 'ArrowRight' })));
    act(() => input.dispatchEvent(new window.KeyboardEvent('keyup', { bubbles: true, key: 'Shift' })));
    act(() => input.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true })));
    expect(commitPreview).toHaveBeenCalledTimes(4);
  });

  it('keeps reset, font, and alignment as immediate durable updates', () => {
    const update = vi.fn();
    const preview = vi.fn();
    const commitPreview = vi.fn().mockResolvedValue(undefined);
    act(() => {
      root!.render(createElement(TextLayoutPanel, { prefs: DEFAULT_READER_PREFS, update, preview, commitPreview }));
    });

    act(() =>
      (document.querySelector('[data-select-aria="readerFontAria"] [data-option-value="mono"]') as HTMLElement).click(),
    );
    act(() =>
      (
        document.querySelector('[data-select-aria="readerAlignAria"] [data-option-value="justify"]') as HTMLElement
      ).click(),
    );
    act(() => (document.querySelector('button') as HTMLButtonElement).click());

    expect(update).toHaveBeenCalledWith({ fontFamily: 'mono' });
    expect(update).toHaveBeenCalledWith({ textAlign: 'justify' });
    expect(update).toHaveBeenCalledWith(DEFAULT_READER_TYPOGRAPHY_PRESET);
    expect(preview).not.toHaveBeenCalled();
  });
});
