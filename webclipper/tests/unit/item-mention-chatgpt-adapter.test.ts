import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

import { chatgptComposerEditorAdapter } from '../../src/services/integrations/item-mention/content/editor-chatgpt';

let dom: JSDOM | null = null;

beforeEach(() => {
  dom = new JSDOM(
    '<!doctype html><html><body><main><div id="prompt-textarea" contenteditable="true"></div></main></body></html>',
    {
      url: 'https://chatgpt.com/c/123',
      pretendToBeVisual: true,
    },
  );
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: dom.window.location });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
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

describe('item-mention chatgpt composer adapter', () => {
  it('replaces a range and moves caret to the end of inserted text', () => {
    const el = document.querySelector('#prompt-textarea') as HTMLElement;
    el.textContent = 'hello $ab world';
    // Make it "visible" for the adapter.
    (el as any).getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });
    (el as any).focus?.();

    const textNode = el.firstChild as Text;
    const sel = globalThis.getSelection?.();
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 9); // "$ab"
    sel?.removeAllRanges();
    sel?.addRange(range);

    const editor = chatgptComposerEditorAdapter.detectActiveEditor();
    expect(editor).toBeTruthy();
    const selectionRange = chatgptComposerEditorAdapter.getSelectionRange(editor!);
    expect(selectionRange).toEqual({ start: 6, end: 9 });

    const after = chatgptComposerEditorAdapter.replaceRange(editor!, selectionRange, 'MARKDOWN');
    expect(el.textContent).toBe('hello MARKDOWN world');
    expect(after).toEqual({ start: 6 + 'MARKDOWN'.length, end: 6 + 'MARKDOWN'.length });
  });
});
