import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

import { writeTextToClipboard } from '../../src/services/shared/clipboard';

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
}

function cleanupDom() {
  delete (globalThis as any).window;
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
}

describe('writeTextToClipboard', () => {
  beforeEach(() => setupDom());
  afterEach(() => cleanupDom());

  it('uses Clipboard API for non-empty text', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await expect(writeTextToClipboard('exact text')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('exact text');
  });

  it('falls back to execCommand when Clipboard API throws', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied');
    });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(globalThis.document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    await expect(writeTextToClipboard('fallback text')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('fallback text');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();

    execCommand.mockReturnValue(false);
    await expect(writeTextToClipboard('fallback failed')).resolves.toBe(false);
  });

  it('rejects empty text without touching browser clipboard APIs', async () => {
    const writeText = vi.fn(async () => undefined);
    const execCommand = vi.fn(() => true);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(globalThis.document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    await expect(writeTextToClipboard('')).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });
});
