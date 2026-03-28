import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

import { geminiContentEditableAdapter } from '../../src/services/integrations/item-mention/content/editor-gemini';

let dom: JSDOM | null = null;

function setCaretToEnd(el: HTMLElement) {
  const sel = globalThis.getSelection?.();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div role="textbox" contenteditable="true"></div></body></html>', {
    url: 'https://gemini.google.com/',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: dom.window.location });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'getSelection', {
    configurable: true,
    value: dom.window.getSelection.bind(dom.window),
  });
});

afterEach(() => {
  dom = null;
  // @ts-expect-error cleanup
  delete (globalThis as any).window;
  // @ts-expect-error cleanup
  delete (globalThis as any).document;
  // @ts-expect-error cleanup
  delete (globalThis as any).location;
});

describe('item-mention gemini contenteditable adapter', () => {
  it('replaces a range and restores caret', () => {
    const el = document.querySelector('div[role="textbox"]') as HTMLElement;
    el.textContent = '$ab';
    (el as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });

    setCaretToEnd(el);
    const editor = geminiContentEditableAdapter.detectActiveEditor();
    expect(editor).toBeTruthy();

    const range = geminiContentEditableAdapter.getSelectionRange(editor!);
    expect(range).toEqual({ start: 3, end: 3 });

    const after = geminiContentEditableAdapter.replaceRange(editor!, { start: 0, end: 3 }, 'MD');
    expect(el.textContent).toBe('MD');
    expect(after).toEqual({ start: 2, end: 2 });
  });
});
