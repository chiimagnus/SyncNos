import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

import { kimiEditorAdapter } from '../../src/services/integrations/item-mention/content/editor-kimi';

let dom: JSDOM | null = null;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><textarea></textarea></body></html>', {
    url: 'https://kimi.moonshot.cn/',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: dom.window.location });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: dom.window.Node });
  Object.defineProperty(globalThis, 'HTMLTextAreaElement', {
    configurable: true,
    value: (dom.window as any).HTMLTextAreaElement,
  });
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

describe('item-mention kimi editor adapter', () => {
  it('replaces a range in textarea', () => {
    const el = document.querySelector('textarea') as HTMLTextAreaElement;
    (el as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });

    el.value = '$ab';
    el.selectionStart = 3;
    el.selectionEnd = 3;
    (el as any).focus?.();

    const editor = kimiEditorAdapter.detectActiveEditor();
    expect(editor?.kind).toBe('textarea');

    const range = kimiEditorAdapter.getSelectionRange(editor!);
    expect(range).toEqual({ start: 3, end: 3 });

    const after = kimiEditorAdapter.replaceRange(editor!, { start: 0, end: 3 }, 'MD');
    expect(el.value).toBe('MD');
    expect(after).toEqual({ start: 2, end: 2 });
  });
});
