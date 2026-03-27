import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

import { chatgptTextareaEditorAdapter } from '../../src/services/integrations/item-mention/content/editor-chatgpt';

let dom: JSDOM | null = null;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><main><textarea></textarea></main></body></html>', {
    url: 'https://chatgpt.com/c/123',
    pretendToBeVisual: true,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: dom.window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLTextAreaElement', {
    configurable: true,
    value: (dom.window as any).HTMLTextAreaElement,
  });
});

afterEach(() => {
  dom = null;
  // @ts-expect-error cleanup
  delete (globalThis as any).window;
  // @ts-expect-error cleanup
  delete (globalThis as any).document;
});

describe('item-mention chatgpt textarea adapter', () => {
  it('replaces a range and moves caret to the end of inserted text', () => {
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'hello $ab world';
    ta.focus();
    ta.setSelectionRange(6, 9); // "$ab"

    const editor = chatgptTextareaEditorAdapter.detectActiveEditor();
    expect(editor).toBeTruthy();
    const range = chatgptTextareaEditorAdapter.getSelectionRange(editor!);
    expect(range).toEqual({ start: 6, end: 9 });

    const after = chatgptTextareaEditorAdapter.replaceRange(editor!, range, 'MARKDOWN');
    expect(ta.value).toBe('hello MARKDOWN world');
    expect(after).toEqual({ start: 6 + 'MARKDOWN'.length, end: 6 + 'MARKDOWN'.length });
  });
});
